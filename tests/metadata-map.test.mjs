import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createStore, exportStaticContent, validatePhoto } from '../server/storage.mjs';
import { extractPhotoMetadata, validCaptureTime } from '../server/photo-metadata.mjs';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { buildingLevels, buildingFloorText } from '../src/building-model.ts';

test('EXIF import preserves wall-clock time and publishes only selected camera parameters', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-exif-test-'));
  try {
    const map = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'public/data/campus.json'), JSON.stringify(map));
    await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
    const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#526a56' } }).jpeg()
      .withExif({ IFD0: { Make: 'Canon', Model: 'EOS R6' }, IFD2: { DateTimeOriginal: '2026:10:03 00:05:06', OffsetTimeOriginal: '+08:00',
        LensModel: 'RF 35mm F1.8 MACRO IS STM', FocalLength: '35/1', FocalLengthIn35mmFilm: '35', FNumber: '18/10', ExposureTime: '1/125',
        ISOSpeedRatings: '640', BodySerialNumber: 'PRIVATE-SERIAL', CameraOwnerName: 'PRIVATE-OWNER' }, IFD3: { GPSLatitude: '32/1 4/1 0/1', GPSLatitudeRef: 'N', GPSLongitude: '118/1 45/1 0/1', GPSLongitudeRef: 'E' } }).toBuffer();
    const store = createStore(root), draft = await store.importPhoto(bytes);
    assert.equal(draft.capturedAt, '2026-10-03T00:05:06');
    assert.equal(draft.metadata.recordedAt, '2026-10-03T00:05:06');
    assert.equal(draft.metadata.utcOffset, '+08:00');
    assert.equal(draft.metadata.focalLengthMm, 35);
    assert.equal(draft.metadata.focalLength35Mm, 35);
    assert.equal(draft.metadata.aperture, 1.8);
    assert.equal(draft.metadata.exposureSeconds, 1 / 125);
    assert.equal(draft.metadata.iso, 640);
    assert.equal(draft.metadata.cameraModel, 'EOS R6');
    assert.equal(draft.metadata.lensModel, 'RF 35mm F1.8 MACRO IS STM');
    assert.equal(JSON.stringify(draft.metadata).includes('PRIVATE'), false);
    assert.equal(Object.keys(draft.metadata).some(key => key.toLowerCase().includes('gps')), false);
    await store.updateDraft(draft.id, { ...draft, placed: true, capturedAt: '2026-10-04T12:30', metadata: { iso: 99 } });
    const saved = await store.publish(draft.id, 0);
    assert.equal(saved.capturedAt, '2026-10-04T12:30');
    assert.equal(saved.metadata.iso, 640); // Manual date correction leaves the source EXIF intact.
    assert.throws(() => validatePhoto({ ...saved, capturedAt: '2026-02-30T25:00' }, saved, map), /日期或时间/);
    await exportStaticContent(root, path.join(root, 'out'));
    const exported = JSON.parse(await fs.readFile(path.join(root, 'out/data/site.json')));
    assert.equal(exported.photos[0].metadata.iso, 640);
    assert.equal((await sharp(path.join(root, 'out', saved.files.download)).metadata()).exif, undefined);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('missing EXIF and malformed dates do not invent capture metadata', async () => {
  const bare = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).png().toBuffer();
  assert.deepEqual(await extractPhotoMetadata(bare), {});
  assert.deepEqual(await extractPhotoMetadata(Buffer.from('not a photo')), {});
  assert.equal(validCaptureTime('2024-02-29'), true);
  assert.equal(validCaptureTime('2026-02-29'), false);
  assert.equal(validCaptureTime('2026-10-03T00:05:06'), true);
  assert.equal(validCaptureTime('2026-10-03T24:00'), false);
});
test('all six sketch corrections survive regeneration without changing owner overrides', async () => {
  const map = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
  const original = JSON.stringify(site);
  const regenerated = applyCampusCorrections(map, corrections), repeated = applyCampusCorrections(regenerated, corrections);
  assert.deepEqual(repeated, regenerated);
  assert.equal(JSON.stringify(site), original);
  assert.equal(new Set(regenerated.buildings.map(b => b.id)).size, regenerated.buildings.length);
  const find = id => regenerated.buildings.find(b => b.id === id);
  assert.equal(find('way/855459409').name, '看台');
  assert.equal(find('local/stand-office').name, '办公室');
  assert.equal(find('local/gymnasium').name, '体育馆');
  assert.equal(find('local/theatre').name, '剧场');
  assert.equal(find('way/855459411').name, '实验楼');
  assert.equal(find('way/1233313438'), undefined);
  assert.ok(find('way/1233313436').sourceBuildingIds.includes('way/1233313438'));
  assert.equal(regenerated.buildingAliases['way/1233313438'], 'way/1233313436');
  const tunnel = regenerated.features.find(f => f.type === 'tunnel'), entrances = regenerated.features.filter(f => f.type === 'tunnelEntrance');
  assert.ok(tunnel.height < 0);
  assert.ok(entrances.every(e => tunnel.points.some(p => p[0] === e.points[0][0] && p[1] === e.points[0][1])));
  assert.ok(regenerated.features.find(f => f.type === 'bridge').height > 0);
});

test('teaching building keeps a five-floor body and a six-floor wing with an unchanged footprint', async () => {
  const map = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  const building = applyCampusCorrections(map, corrections).buildings.find(b => b.id === 'way/855459420');
  const override = { name: '主教学楼', floors: 5, floorHeight: 3.6, height: null };
  const before = JSON.stringify(override), info = buildingLevels(building, override);
  assert.equal(JSON.stringify(override), before);
  assert.equal(info.baseFloors, 5);
  assert.equal(info.floors, 6);
  assert.equal(buildingFloorText(info), '主楼 5 层 · 副楼 6 层');
  assert.deepEqual(info.sections.map(p => p.floors), [5, 6]);
  assert.equal(info.sections[0].height, 18);
  assert.ok(Math.abs(info.sections[1].height - 21.6) < 1e-9);
  const area = ring => Math.abs(ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
  assert.ok(Math.abs(info.sections.reduce((sum, p) => sum + area(p.outer), 0) - area(building.outer)) < 1e-8);
  assert.deepEqual(info.sections[0].outer[0], info.sections[1].outer.at(-2));
  assert.deepEqual(info.sections[0].outer.at(-2), info.sections[1].outer[0]);
  const link = map.features.find(f => f.id === 'way/1233313441');
  assert.deepEqual([info.sections[0].outer[0], info.sections[0].outer.at(-2)], link.points, 'The main and secondary building meet along the existing straight passage');
  const single = buildingLevels({ ...building, parts: undefined }, { ...override, floors: 4 });
  assert.equal(single.floors, 4);
  assert.equal(single.height, 14.4);
});

test('specimen forest stays in its marked campus area and leaves buildings and roads clear', async () => {
  const map = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  const forest = applyCampusCorrections(map, corrections).features.find(f => f.id === 'local/specimen-forest');
  assert.equal(forest.type, 'forest');
  assert.equal(forest.name, '标本林');
  assert.ok(forest.trees.length >= 20);
  const inside = ([x, z], ring) => {
    let result = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) result = !result;
    }
    return result;
  };
  const distance = (p, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
  };
  assert.ok(forest.outer.every(p => inside(p, map.boundary)), 'Forest remains within the campus boundary');
  for (const tree of forest.trees) {
    assert.ok(inside(tree.position, forest.outer));
    for (const building of map.buildings) {
      assert.equal(inside(tree.position, building.outer), false);
      assert.ok(building.outer.slice(1).every((p, i) => distance(tree.position, building.outer[i], p) > tree.radius));
    }
    for (const road of map.features.filter(f => f.type === 'path' && !f.representedBy)) assert.ok(road.points.slice(1).every((p, i) => distance(tree.position, road.points[i], p) > tree.radius + (road.width || 3) / 2));
  }
});

test('all building heights follow floor counts and floor height even when legacy totals exist', async () => {
  const map = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const gym = map.buildings.find(b => b.id === 'local/gymnasium');
  const legacyGym = { ...gym, height: 8 };
  const info = buildingLevels(legacyGym, { name: '体育馆', floors: 3, floorHeight: 4.2, height: 99 });
  assert.ok(Math.abs(info.height - 12.6) < 1e-9);
  assert.equal(info.baseHeight, info.sections[0].height);
  assert.equal(buildingLevels({ ...legacyGym, floors: null }).height, 10.8);
  const teaching = map.buildings.find(b => b.id === 'way/855459420');
  const split = buildingLevels({ ...teaching, height: 120 }, { name: '主教学楼', floors: 5, floorHeight: 3.8, height: 9 });
  assert.equal(split.sections[0].height, 19);
  assert.ok(Math.abs(split.sections[1].height - 22.8) < 1e-9);
  assert.ok(map.buildings.every(b => !Object.hasOwn(b, 'height')), 'Regenerated buildings store floors instead of total heights');
});

test('underground court and corridor connect to the tunnel on the same level; new building survives refresh', async () => {
  const map = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  const regenerated = applyCampusCorrections(map, corrections);
  const find = id => regenerated.features.find(f => f.id === id);
  const tunnel = find('local/underpass'), exit = find('local/underpass-exit');
  const corridor = find('local/underground-corridor'), court = find('local/underground-badminton');
  assert.equal(exit.type, 'tunnelJunction');
  assert.equal(exit.height, tunnel.height);
  assert.equal(corridor.height, exit.height);
  assert.equal(court.height, corridor.height);
  assert.ok(court.height + court.wallHeight < 0);
  assert.deepEqual(tunnel.points.at(-1), exit.points[0]);
  assert.deepEqual(corridor.points[0], exit.points.at(-1));
  assert.deepEqual(court.outer[1], corridor.outer[0]);
  assert.deepEqual(court.outer[2], corridor.outer[3]);
  for (const feature of [exit, corridor, court]) for (const id of feature.connectedTo) assert.ok(find(id), id);
  assert.equal(regenerated.features.filter(f => f.type === 'tunnelEntrance').length, 1);
  const unknown = regenerated.buildings.find(b => b.id === 'local/unknown-west-corner');
  assert.equal(unknown.name, '未知建筑');
  assert.equal(unknown.osmId, null);
  assert.equal(unknown.floors, null);
  assert.deepEqual(applyCampusCorrections(regenerated, corrections), regenerated);
});

test('underground layout is orthogonal to the stand and shares its right edge', async () => {
  const map = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  const campus = applyCampusCorrections(map, corrections);
  const stand = campus.buildings.find(b => b.id === 'way/855459409');
  const origin = stand.outer[3], end = stand.outer[2], length = Math.hypot(end[0] - origin[0], end[1] - origin[1]);
  const axis = [(end[0] - origin[0]) / length, (end[1] - origin[1]) / length];
  const across = p => (p[0] - origin[0]) * axis[1] - (p[1] - origin[1]) * axis[0];
  const room = campus.features.find(f => f.id === 'local/underground-badminton');
  const corridor = campus.features.find(f => f.id === 'local/underground-corridor');
  const exit = campus.features.find(f => f.id === 'local/underpass-exit');
  for (const shape of [room, corridor]) {
    assert.ok(Math.abs(across(shape.outer[0])) < 1e-9);
    assert.ok(Math.abs(across(shape.outer[1])) < 1e-9);
  }
  assert.ok(Math.abs(across(room.outer[2]) - across(corridor.outer[2])) < 1e-9);
  for (const chain of [room.outer, corridor.outer, ...corridor.holes, corridor.points, ...corridor.branches, exit.points]) {
    for (let i = 1; i < chain.length; i++) {
      const dx = chain[i][0] - chain[i - 1][0], dz = chain[i][1] - chain[i - 1][1];
      const along = dx * axis[0] + dz * axis[1], perpendicular = dx * axis[1] - dz * axis[0];
      assert.ok(Math.min(Math.abs(along), Math.abs(perpendicular)) < 1e-9, 'Every segment follows a stand axis');
      if (i < chain.length - 1) {
        const nx = chain[i + 1][0] - chain[i][0], nz = chain[i + 1][1] - chain[i][1];
        assert.ok(Math.abs(dx * nx + dz * nz) < 1e-8, 'Every turn is a right angle');
      }
    }
  }
  assert.notDeepEqual(corridor.points[0], corridor.points.at(-1));
  assert.equal(corridor.holes.length, 0);
  const area = ring => Math.abs(ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
  assert.ok(Math.abs(area(corridor.outer) - 914.5480794312368) < 1e-8, 'The shifted road-side corridor retains three connected sides');
  const point = (along, across) => [origin[0] + axis[0] * along + axis[1] * across, origin[1] + axis[1] * along - axis[0] * across];
  const inside = ([x, z]) => {
    let contained = false;
    for (let i = 0, j = corridor.outer.length - 1; i < corridor.outer.length; j = i++) {
      const [xi, zi] = corridor.outer[i], [xj, zj] = corridor.outer[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) contained = !contained;
    }
    return contained;
  };
  assert.equal(inside(point(95.5, 43.7)), false, 'The marked cross passage beside the badminton court is absent');
  assert.equal(inside(point(130.6, 43.7)), false, 'The previous long edge no longer cuts across the running track');
  assert.equal(inside(point(143.2548079431237, 43.7)), true, 'The long edge moves to the marked photo side without rotating');
  assert.equal(inside(point(110, 2.5)), true);
  assert.equal(inside(point(110, 84.9)), true);
  const runway = campus.features.find(f => f.id === 'local/sheltered-runway');
  assert.equal(runway.type, 'undergroundTrack', 'The cross connection is a separate sports runway, not another corridor');
  assert.equal(runway.name, '风雨跑道');
  assert.equal(runway.height, corridor.height);
  assert.ok(runway.points.every(inside), 'Both runway ends meet the side corridors');
  const runwayAxis = runway.points[1].map((n, i) => n - runway.points[0][i]);
  assert.ok(Math.abs(runwayAxis[0] * axis[0] + runwayAxis[1] * axis[1]) < 1e-8, 'Runway follows the broad edge of the underground layout');
  const along = p => (p[0] - origin[0]) * axis[0] + (p[1] - origin[1]) * axis[1];
  assert.ok(along(runway.points[0]) - runway.width / 2 > Math.max(...room.outer.map(along)), 'Runway remains between the side corridors without overlapping the badminton court');
});

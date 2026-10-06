import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import polygonClipping from 'polygon-clipping';
import { basketballSurfaces } from '../src/basketball-geometry.ts';
import { photoMapHeight, assignPhotoLocation, campusLocations, photoLocationId, photoLocationText, photosAtLocation } from '../src/locations.ts';
import { createStore, exportStaticContent, validatePhoto } from '../server/storage.mjs';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { bridgeSurfaceHeight } from '../src/structure-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const ringArea = ring => Math.abs(ring.slice(1).reduce((sum, point, i) => sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0) / 2);
const area = geometry => geometry.reduce((sum, polygon) => sum + ringArea(polygon[0]) - polygon.slice(1).reduce((n, ring) => n + ringArea(ring), 0), 0);

test('four separate basketball courts fit the marked area, with complete lines and no overlapping colored faces', async () => {
  const feature = campus.features.find(item => item.id === 'way/855459417');
  const before = JSON.stringify(feature), { courts, surround } = basketballSurfaces(feature);
  assert.equal(feature.type, 'basketballCourts');
  assert.equal(courts.length, 4);
  const polygons = [...courts.map(court => court.surface), ...surround].map(shape => [shape.outer, ...shape.holes]);
  for (const court of courts) {
    assert.ok(Math.abs(ringArea(court.surface.outer) - 28 * 15) < 1e-7);
    assert.equal(court.marks.length, 13, 'Each court has boundaries, midline, center circle, two keys, free-throw arcs, three-point arcs and basket marks');
    for (const mark of court.marks) for (const point of mark.points) {
      const dx = point[0] - court.center[0], dz = point[1] - court.center[1];
      assert.ok(Math.abs(dx * feature.courts.axis[1] - dz * feature.courts.axis[0]) <= feature.courts.width / 2 + 1e-7);
      assert.ok(Math.abs(dx * feature.courts.axis[0] + dz * feature.courts.axis[1]) <= feature.courts.length / 2 + 1e-7, 'The marks stay on the court');
    }
    assert.ok(area(polygonClipping.difference([court.surface.outer], [feature.outer])) < 1e-7);
    for (const building of campus.buildings) assert.ok(area(polygonClipping.intersection([court.surface.outer], [building.outer, ...building.holes])) < 1e-7);
  }
  for (let i = 0; i < polygons.length; i++) for (let j = i + 1; j < polygons.length; j++) assert.ok(area(polygonClipping.intersection(polygons[i], polygons[j])) < 1e-7, 'Each colored surface occupies a different area');
  const union = polygonClipping.union(polygons[0], ...polygons.slice(1));
  assert.ok(area(polygonClipping.difference([feature.outer], union)) < 1e-7, 'The original sports area remains completely covered');
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus, 'The four courts survive refreshing OSM');
  assert.equal(JSON.stringify(feature), before);
});

const photo = { id: '00000000-0000-0000-0000-000000000001', title: '校园影像', description: '原来的描述', capturedAt: '2026-10-03T15:00:00',
  buildingId: '', floor: 0, position: { x: 10, z: 20, height: 1.6 }, heading: 70, pitch: -5, placed: true,
  width: 80, height: 40, downloadBytes: 1000, files: { thumbnail: 'old-thumb', display: 'old-display', download: 'old-download' } };

test('every named map feature is a selectable location; building and underground photo records retain their meanings', () => {
  const before = JSON.stringify([campus, site, photo]), locations = campusLocations(campus, site);
  assert.equal(new Set(locations.map(location => location.id)).size, locations.length);
  for (const feature of campus.features.filter(item => item.name?.trim())) {
    const location = locations.find(item => item.id === feature.id);
    assert.ok(location, feature.name + ' is listed');
    const assigned = assignPhotoLocation(photo, feature.id, campus, site);
    assert.equal(assigned.buildingId, ''); assert.equal(assigned.floor, 0);
    assert.equal(assigned.position.x, photo.position.x); assert.equal(assigned.position.z, photo.position.z);
    assert.equal(assigned.heading, photo.heading); assert.deepEqual(assigned.files, photo.files);
    assert.equal(assigned.description, photo.description); assert.equal(assigned.capturedAt, photo.capturedAt);
    const surfaceHeight = feature.type === 'bridge'
      ? bridgeSurfaceHeight(feature, location.surfaceHeight, [photo.position.x, photo.position.z]) : location.surfaceHeight;
    assert.equal(photoMapHeight(assigned, campus, site), surfaceHeight + 1.6);
    assert.equal(photoLocationText(assigned, campus, site), feature.name);
    assert.deepEqual(photosAtLocation([photo, assigned], feature.id), [assigned]);
    assert.equal(validatePhoto(assigned, photo, campus).locationId, feature.id);
    assert.throws(() => validatePhoto({ ...assigned, floor: 1 }, photo, campus), /楼层/);
  }
  const underground = assignPhotoLocation(photo, 'local/underground-badminton', campus, site);
  assert.ok(photoMapHeight(underground, campus, site) < 0);
  const bridge = campus.features.find(feature => feature.type === 'bridge');
  const adjustedSite = { ...site, buildingOverrides: { ...site.buildingOverrides, [bridge.levelAnchor.buildingId]: { name: '体育馆', floors: 2, floorHeight: 4.2 } } };
  assert.ok(Math.abs(photoMapHeight(assignPhotoLocation(photo, bridge.id, campus, adjustedSite), campus, adjustedSite) - 7.42) < 1e-7);
  const building = campus.buildings[0], legacy = { ...photo, buildingId: building.id, floor: 2, position: { ...photo.position, height: 5.2 } };
  assert.equal(photoLocationId(legacy), building.id);
  assert.deepEqual(photosAtLocation([legacy, underground], building.id, 2), [legacy]);
  assert.equal(photoLocationText(legacy, campus, site), locations.find(location => location.id === building.id).name + ' · 2 楼');
  assert.equal(validatePhoto(legacy, legacy, campus).position.height, undefined);
  const unnamed = campus.features.find(feature => !feature.name);
  for (const id of [unnamed.id, 'unknown/place']) assert.throws(() => validatePhoto({ ...photo, locationId: id }, photo, campus), /地点/);
  assert.throws(() => validatePhoto({ ...photo, locationId: building.id }, photo, campus), /地点与建筑/);
  assert.equal(JSON.stringify([campus, site, photo]), before);
});

test('named ground locations derive height from their surface through save, restore and static export', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-locations-'));
  try {
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'public/data/campus.json'), JSON.stringify(campus));
    await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
    const store = createStore(root);
    const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#47694e' } }).jpeg().toBuffer();
    const draft = await store.importPhoto(bytes), state = await store.state();
    for (const feature of campus.features.filter(item => item.name?.trim())) {
      const assigned = assignPhotoLocation({ ...draft, title: feature.name, placed: true }, feature.id, campus, state.site);
      const saved = await store.updateDraft(draft.id, assigned);
      assert.equal(saved.locationId, feature.id); assert.equal(saved.floor, 0); assert.equal(saved.buildingId, '');
      assert.equal((await store.state()).drafts[0].locationId, feature.id);
    }
    const assigned = assignPhotoLocation({ ...draft, title: '地下影像', placed: true }, 'local/underpass', campus, state.site);
    assigned.position.height = -2.1;
    await store.updateDraft(draft.id, assigned);
    const published = await store.publish(draft.id, 0);
    assert.equal(published.locationId, 'local/underpass'); assert.equal(published.position.height, undefined); assert.equal(photoMapHeight(published, campus, state.site), -1.4);
    const next = assignPhotoLocation(published, 'local/footbridge', campus, (await store.state()).site);
    next.position.height = 6.7;
    await store.updatePhoto(draft.id, next, 1);
    await store.removePhoto(draft.id, 2);
    await store.restorePhoto(draft.id, 3);
    const saved = (await store.state()).site.photos[0];
    assert.equal(saved.locationId, 'local/footbridge'); assert.equal(saved.position.height, undefined); assert.ok(Math.abs(photoMapHeight(saved, campus, (await store.state()).site) - 7.12) < 1e-7);
    const destination = path.join(root, 'dist');
    await exportStaticContent(root, destination);
    const exported = JSON.parse(await fs.readFile(path.join(destination, 'data/site.json')));
    assert.deepEqual(exported.photos[0], saved);
    assert.equal(photoLocationText(saved, campus, exported), '天桥');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { photoFieldOfView, directionVector, viewSectorRays } from '../src/photo-view.ts';
import { bridgeHeight, curvedStairPoint, curvedStairTreads, stadiumRing, straightStairTreads, trackWorldPoint } from '../src/structure-geometry.ts';
import { createStore, exportStaticContent, validatePhoto } from '../server/storage.mjs';

const close = (actual, expected, epsilon = 1e-8) => assert.ok(Math.abs(actual - expected) < epsilon, `${actual} ≈ ${expected}`);
const inside = ([x, z], ring) => {
  let contained = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) contained = !contained;
  }
  return contained;
};
const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const find = id => campus.features.find(f => f.id === id);

test('view angle uses equivalent focal length, respects portrait orientation, and distinguishes assumptions', () => {
  const photo = { width: 6000, height: 4000, metadata: { focalLengthMm: 23, focalLength35Mm: 35 } };
  const view = photoFieldOfView(photo);
  close(view.horizontal, 2 * Math.atan(36 / 70) * 180 / Math.PI);
  close(view.vertical, 2 * Math.atan(24 / 70) * 180 / Math.PI);
  assert.equal(view.source, 'exifEquivalent');
  const portrait = photoFieldOfView({ ...photo, width: 4000, height: 6000 });
  close(portrait.horizontal, view.vertical);
  close(portrait.vertical, view.horizontal);
  const aps = photoFieldOfView({ ...photo, metadata: { focalLengthMm: 35 }, view: { cropFactor: 1.6 } });
  assert.equal(aps.source, 'sensorFormat');
  close(aps.focalLength35Mm, 56);
  assert.ok(aps.horizontal < view.horizontal);
  const assumed = photoFieldOfView({ ...photo, metadata: { focalLengthMm: 35 } });
  assert.equal(assumed.source, 'assumedFullFrame');
  const manual = photoFieldOfView({ ...photo, view: { focalLength35Mm: 85, cropFactor: 2 } });
  assert.equal(manual.source, 'manual');
  assert.equal(manual.focalLength35Mm, 85);
  assert.equal(photoFieldOfView({ width: 6000, height: 4000 }), null);
  assert.equal(photoFieldOfView({ ...photo, width: 0 }), null);
  assert.equal(photoFieldOfView({ ...photo, metadata: { focalLengthMm: NaN, focalLength35Mm: -4 } }), null);
});

test('sector opening matches the horizontal view angle and follows heading and pitch in three dimensions', () => {
  for (const heading of [0, 90, 225, 359]) for (const pitch of [-90, -35, 0, 60, 90]) {
    const rays = viewSectorRays(heading, pitch, 60), forward = directionVector(heading, pitch);
    for (const ray of rays) close(Math.hypot(...ray), 22);
    rays[24].forEach((n, i) => close(n, forward[i] * 22));
    close(rays[0].reduce((dot, n, i) => dot + n * rays.at(-1)[i], 0) / 22 ** 2, Math.cos(Math.PI / 3));
  }
  close(directionVector(0, 0)[2], -1);
  close(directionVector(90, 0)[0], 1);
  close(directionVector(0, 90)[1], 1);
  const wide = viewSectorRays(0, 0, 100), narrow = viewSectorRays(0, 0, 20);
  assert.ok(Math.abs(wide[0][0]) > Math.abs(narrow[0][0]));
});

test('view calibration survives save, export, and restore without replacing source EXIF', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-view-test-'));
  try {
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'public/data/campus.json'), JSON.stringify(campus));
    await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
    const bytes = await sharp({ create: { width: 90, height: 60, channels: 3, background: '#59704f' } }).jpeg().withExif({ IFD2: { FocalLength: '35/1' } }).toBuffer();
    const store = createStore(root), draft = await store.importPhoto(bytes);
    await store.updateDraft(draft.id, { ...draft, placed: true, view: { cropFactor: 1.6 }, metadata: { focalLengthMm: 1 } });
    const published = await store.publish(draft.id, 0);
    assert.equal(published.metadata.focalLengthMm, 35);
    close(photoFieldOfView(published).focalLength35Mm, 56);
    assert.throws(() => validatePhoto({ ...published, view: { focalLength35Mm: -1 } }, published, campus), /焦距/);
    assert.throws(() => validatePhoto({ ...published, view: { cropFactor: Infinity } }, published, campus), /画幅/);
    await store.updatePhoto(published.id, { ...published, view: { focalLength35Mm: 85 } }, 1);
    const out = path.join(root, 'out');
    await exportStaticContent(root, out);
    const exported = JSON.parse(await fs.readFile(path.join(out, 'data/site.json'))).photos[0];
    assert.equal(photoFieldOfView(exported).focalLength35Mm, 85);
    assert.equal(exported.metadata.focalLengthMm, 35);
    await store.removePhoto(published.id, 2);
    await store.restorePhoto(published.id, 3);
    assert.equal((await store.state()).site.photos[0].view.focalLength35Mm, 85);
    const cleared = await store.updatePhoto(published.id, { ...exported, view: {} }, 4);
    assert.equal(photoFieldOfView(cleared).source, 'assumedFullFrame');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('curved underground stairs descend monotonically and meet the existing tunnel floor', () => {
  const entrance = find('local/underpass-entrance'), tunnel = find('local/underpass'), stair = entrance.curvedStair;
  const top = curvedStairPoint(stair, 0), bottom = curvedStairPoint(stair, 1);
  close(top[0], entrance.points[1][0]); close(top[2], entrance.points[1][1]);
  close(top[1], .12); close(bottom[1], tunnel.height);
  close(bottom[0], tunnel.points[0][0]); close(bottom[2], tunnel.points[0][1]);
  const treads = curvedStairTreads(stair);
  close(treads.at(-1).height, tunnel.height);
  treads.forEach((tread, i) => {
    assert.deepEqual(tread.ring[0], tread.ring.at(-1));
    if (i) assert.ok(tread.height < treads[i - 1].height);
    assert.ok(tread.ring.every(p => p.every(Number.isFinite)));
  });
  const a = curvedStairPoint(stair, .25), b = curvedStairPoint(stair, .75);
  assert.ok(Math.abs((a[0] - top[0]) * (b[2] - top[2]) - (b[0] - top[0]) * (a[2] - top[2])) > 1, 'Stairs visibly turn instead of following a straight line');
  assert.equal(find('local/underpass-exit').type, 'tunnelJunction');
  assert.ok(stair.sweep > 0, 'Entrance turns in the corrected direction');
  const straight = tunnel.points.at(-1).map((n, i) => n - tunnel.points[0][i]);
  for (const point of tunnel.points.slice(1)) close((point[0] - tunnel.points[0][0]) * straight[1] - (point[1] - tunnel.points[0][1]) * straight[0], 0);
  const endAngle = stair.startAngle + stair.sweep;
  const tangent = [-Math.sin(endAngle), Math.cos(endAngle)];
  const entryRun = tunnel.points[1].map((n, i) => n - tunnel.points[0][i]);
  close(tangent[0] * entryRun[1] - tangent[1] * entryRun[0], 0);
  assert.ok(tangent[0] * entryRun[0] + tangent[1] * entryRun[1] > 0, 'Stair tangent continues directly into the relocated entrance passage');
});

test('bridge follows the OSM route at global third-floor height, joining gym second floor and raised playground', () => {
  const bridge = find('local/footbridge');
  const gym = bridge.connections.find(c => c.buildingId === 'local/gymnasium');
  const stairs = bridge.connections.find(c => c.id === 'playground-stairs'), upper = bridge.connections.find(c => c.id === 'upper-road-stairs');
  const source = find('way/855459412'), gymSource = find('way/855459413'), road = find('way/855459414');
  const approach = find('local/bridge-upper-approach');
  assert.deepEqual(bridge.points, source.points.slice(1, 3));
  assert.deepEqual(upper.points[0], source.points[2]);
  assert.deepEqual(approach.points[0], upper.points.at(-1));
  assert.deepEqual(approach.points.at(-1), source.points.at(-1));
  assert.ok(road.points.some(p => p.every((n, i) => n === approach.points.at(-1)[i])), 'Shortened upper stairs meet the existing road through a ground approach');
  assert.deepEqual(gym.points[0], gymSource.points[0]);
  for (const id of bridge.sourcePathIds) assert.equal(find(id).representedBy, bridge.id, 'The source footway is rendered as the bridge, without a second road underneath');
  assert.equal(gym.floor, 1.5, 'The bridge meets the raised gym half-floor platform');
  assert.deepEqual(gym.points[0], bridge.points[0]);
  assert.deepEqual(stairs.points[0], bridge.points[0]);
  const height = bridgeHeight(bridge, campus.buildings, { 'local/gymnasium': { floorHeight: 3.6 } });
  close(height, 5.52);
  close(bridgeHeight(bridge, campus.buildings, { 'local/gymnasium': { floorHeight: 4.2 } }), 5.82);
  const treads = straightStairTreads(stairs.points[0], stairs.points.at(-1), height, stairs.groundHeight);
  close(treads.at(-1).height, 3.72);
  assert.deepEqual(treads.at(-1).to, stairs.points.at(-1));
  assert.ok(treads.every((step, i) => step.height < (i ? treads[i - 1].height : height)), 'Playground stairs descend only as far as the raised field');
  const wallDistance = (point, building) => Math.min(...building.outer.slice(1).map((to, i) => {
    const from = building.outer[i], dx = to[0] - from[0], dz = to[1] - from[1];
    return Math.abs((point[0] - from[0]) * dz - (point[1] - from[1]) * dx) / Math.hypot(dx, dz);
  }));
  close(wallDistance(gym.points.at(-1), campus.buildings.find(b => b.id === 'local/gymnasium')), 0);
  const gymBuilding = campus.buildings.find(b => b.id === 'local/gymnasium'), entry = gym.points.at(-1);
  const wall = gymBuilding.outer[3].map((n, i) => n - gymBuilding.outer[0][i]);
  const projection = entry.reduce((sum, n, i) => sum + (n - gymBuilding.outer[0][i]) * wall[i], 0) / wall.reduce((sum, n) => sum + n * n, 0);
  assert.ok(projection > 0 && projection < 1, 'Entry falls within the gym facade, not its extended line');
  const [a, b] = bridge.points, c = upper.points.at(-1);
  assert.ok((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) < -20, 'Upper turn faces the existing road');
  const corridor = find('local/underground-corridor'), broadEdge = corridor.points[1].map((n, i) => n - corridor.points[0][i]);
  const descent = stairs.points.at(-1).map((n, i) => n - stairs.points[0][i]);
  close(descent[0] * broadEdge[1] - descent[1] * broadEdge[0], 0);
  assert.ok(Math.hypot(...descent) > 5 && Math.hypot(...descent) < 16, 'Playground stairs stop at the marked cut instead of extending across the entire old branch');
  const upperLength = Math.hypot(...upper.points.at(-1).map((n, i) => n - upper.points[0][i]));
  assert.ok(upperLength > 5 && upperLength < 16, 'Upper stairs are a short flight with a ground approach');
  const mainAxis = campus.buildings.find(b => b.id === 'way/855459409');
  const standAxis = mainAxis.outer[2].map((n, i) => n - mainAxis.outer[3][i]);
  const axisLength = Math.hypot(...standAxis), side = [standAxis[1] / axisLength, -standAxis[0] / axisLength];
  const across = p => p[0] * side[0] + p[1] * side[1];
  const gap = Math.min(...gymBuilding.outer.map(across)) - Math.max(...find('way/855459407').outer.map(across));
  assert.ok(gap > 2 && gap < 10, 'Gym stays close to the running track with a clear gap and no overlap');
  assert.ok(Math.hypot(...wall) > 60, 'Gym extends farther along its long side');
  const upperTreads = straightStairTreads(upper.points[0], upper.points.at(-1), height, upper.groundHeight);
  close(upperTreads.at(-1).height, .12);
});

test('oval running track fits the OSM sports ground and surrounds the grass pitch', () => {
  const feature = find('way/855459407'), track = feature.track;
  assert.equal(feature.type, 'runningTrack');
  close(Math.hypot(...track.axis), 1);
  for (let lane = 0; lane <= track.lanes; lane++) {
    const ring = stadiumRing(track.halfStraight, track.innerRadius + lane * track.laneWidth);
    assert.deepEqual(ring[0], ring.at(-1));
    assert.ok(ring.every(p => inside(trackWorldPoint(track, p), feature.outer)), 'Lanes stay inside the existing sports-ground footprint');
  }
  const infield = stadiumRing(track.halfStraight, track.innerRadius);
  for (const across of [-1, 1]) for (const along of [-1, 1]) assert.ok(inside([across * track.pitchWidth / 2, along * track.pitchLength / 2], infield));
  assert.ok(campus.features.some(f => f.id === 'way/855459417' && f.type === 'basketballCourts'), 'The separate basketball area is retained');
});

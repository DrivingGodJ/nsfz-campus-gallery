import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import clip from 'polygon-clipping';
import sharp from 'sharp';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { createStore, exportStaticContent, validatePhoto } from '../server/storage.mjs';
import { buildingLevels } from '../src/building-model.ts';
import { campusLocations, photoLocationId, photoLocationText, photosAtLocation } from '../src/locations.ts';

const ids = ['way/1233313432', 'way/1233313433', 'way/1233313434'];
const canonical = ids[2];
const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));

test('three dormitories become one continuous footprint and one selectable location after regeneration', async () => {
  const campus = await read('public/data/campus.json'), corrections = await read('data/campus-corrections.json');
  const site = await read('public/data/site.json'), source = await read('data/osm-source.json');
  const regenerated = applyCampusCorrections(campus, corrections);
  assert.deepEqual(applyCampusCorrections(regenerated, corrections), regenerated);
  const merged = regenerated.buildings.find(b => b.id === canonical);
  assert.deepEqual(merged.sourceBuildingIds, ids);
  assert.equal(merged.name, '宿舍');
  assert.ok(ids.slice(0, 2).every(id => !regenerated.buildings.some(b => b.id === id)));
  const project = p => [(p.lon - campus.origin.lon) * Math.PI / 180 * 6378137 * Math.cos(campus.origin.lat * Math.PI / 180), -(p.lat - campus.origin.lat) * Math.PI / 180 * 6378137];
  const originals = ids.map(id => [source.elements.find(e => 'way/' + e.id === id).geometry.map(project)]);
  const expected = clip.union(...originals), actual = [merged.outer, ...merged.holes];
  assert.deepEqual(clip.difference(actual, expected), [], 'The merged building adds no footprint outside the original dormitories');
  assert.deepEqual(clip.difference(expected, actual), [], 'All original dormitory areas remain');
  assert.equal(buildingLevels(merged, { floors: 6, floorHeight: 3.6 }).height, 6 * 3.6);
  assert.equal(buildingLevels(merged, { floors: 7, floorHeight: 4 }).height, 28);
  const locations = campusLocations(regenerated, site);
  assert.equal(locations.filter(p => p.name === '宿舍').length, 1);
  assert.ok(!locations.some(p => p.name === '宿舍1' || p.name === '宿舍2'));
  assert.equal(locations.find(p => p.id === 'way/1233313435').name, '原少航宿舍');
  assert.ok(!Object.hasOwn(site.buildingOverrides, ids[0]) && !Object.hasOwn(site.buildingOverrides, ids[1]));
});

test('legacy and browser-cached dormitory photos retain position, height and floor when their location resolves', async () => {
  const campus = await read('public/data/campus.json'), site = await read('public/data/site.json');
  const photos = ids.map((id, i) => ({ id: 'sample-' + i, title: '宿舍照片', description: '原描述', capturedAt: '2026-10-03T12:34',
    buildingId: id, ...(i === 1 ? { locationId: id } : {}), floor: i + 2,
    position: { x: -40 + i, z: 145, height: 8.8 + i }, heading: 120, pitch: 10, placed: true, metadata: { focalLengthMm: 35 } }));
  for (const photo of photos) {
    const before = structuredClone(photo);
    assert.equal(photoLocationId(photo, campus), canonical);
    assert.equal(photoLocationText(photo, campus, site), '宿舍 · ' + photo.floor + ' 楼');
    const saved = validatePhoto(photo, photo, campus);
    assert.equal(saved.locationId, canonical); assert.equal(saved.buildingId, canonical);
    for (const key of ['floor', 'heading', 'pitch', 'capturedAt', 'description', 'metadata']) assert.deepEqual(saved[key], photo[key]);
    assert.deepEqual(saved.position, { x: photo.position.x, z: photo.position.z });
    assert.deepEqual(photo, before);
  }
  assert.deepEqual(photosAtLocation(photos, canonical, 0, campus), photos);
  assert.deepEqual(photosAtLocation(photos, ids[0], 3, campus), [photos[1]]);
  assert.equal(validatePhoto({ ...photos[0], locationId: canonical }, photos[0], campus).buildingId, canonical);
  assert.throws(() => validatePhoto({ ...photos[0], locationId: '' }, photos[0], campus), /地点与建筑不一致/);
  assert.throws(() => validatePhoto({ ...photos[0], locationId: 'way/1233313435' }, photos[0], campus), /地点与建筑不一致/);
});

test('old dormitory associations save, restore and export under the single merged location', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-dormitory-merge-'));
  try {
    const campus = await read('public/data/campus.json');
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'public/data/campus.json'), JSON.stringify(campus));
    await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
    const store = createStore(root);
    const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: '#a8b39d' } }).jpeg().toBuffer();
    const positions = [];
    for (const [i, id] of ids.entries()) {
      const draft = await store.importPhoto(bytes), position = { x: -40 + i, z: 145 };
      positions.push(position);
      const edited = await store.updateDraft(draft.id, { ...draft, buildingId: id, locationId: id, floor: 3, position, placed: true });
      assert.equal(edited.locationId, canonical); assert.deepEqual(edited.position, position);
      await store.publish(draft.id, i);
    }
    const state = await store.state();
    // Saved and removed records can predate the building merge.
    const legacy = { ...state.site.photos[0], locationId: ids[0], buildingId: ids[0] };
    await fs.writeFile(path.join(root, 'public/data/site.json'), JSON.stringify({ ...state.site, photos: [legacy, ...state.site.photos.slice(1)] }));
    const destination = path.join(root, 'export');
    await exportStaticContent(root, destination);
    const exported = JSON.parse(await fs.readFile(path.join(destination, 'data/site.json')));
    assert.ok(exported.photos.every(p => p.locationId === canonical && p.buildingId === canonical));
    assert.deepEqual(exported.photos.map(p => p.position), positions);
    await store.removePhoto(legacy.id, 3);
    await store.restorePhoto(legacy.id, 4);
    const restored = (await store.state()).site.photos.find(p => p.id === legacy.id);
    assert.equal(restored.buildingId, canonical); assert.equal(restored.locationId, canonical);
    assert.deepEqual(restored.position, legacy.position);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

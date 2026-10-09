import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { assignPhotoLocation, photoCameraHeightRange, photoMapHeight } from '../src/locations.ts';
import { photoAnnotation } from '../src/submissions-api.ts';
import { createStore, exportStaticContent, validatePhoto } from '../server/storage.mjs';
import { createPhotoPackage, packageAnnotation, readPhotoPackage } from '../server/photo-package.mjs';
import { importPhotoPackage } from '../server/package-import.mjs';
import { validateAnnotation } from '../worker/src/submissions.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = { buildingOverrides: {} };
const photo = { id: '00000000-0000-0000-0000-000000000001', title: '走廊视角', description: '', capturedAt: '', buildingId: '', floor: 0,
  captureType: 'ground', position: { x: 0, z: 0, height: 999 }, heading: 0, pitch: 0, placed: true };

test('ground camera height stays within its floor, respects aliases and adds to bridge and stair surfaces', () => {
  const building = { ...campus.buildings[0], baseElevation: .7 };
  const map = { ...campus, buildings: [building], buildingAliases: { legacy: building.id } };
  const adjusted = { buildingOverrides: { [building.id]: { floorHeight: 3.2 } } };
  const p = { ...photo, buildingId: 'legacy', floor: 3 };
  const base = .7 + 2 * 3.2;
  assert.deepEqual(photoCameraHeightRange(p, map, adjusted), { min: .1, max: 3.1 });
  assert.equal(photoMapHeight(p, map, adjusted), base + 1.6, 'Legacy absolute position height is still ignored');
  for (const [input, height] of [[0, .1], [.1, .1], [2.4, 2.4], [3.1, 3.1], [11.9, 3.1], [NaN, 1.6]]) {
    assert.equal(photoMapHeight({ ...p, cameraHeight: input }, map, adjusted), base + height);
  }
  assert.equal(photoMapHeight({ ...p, captureType: 'aerial', altitude: { reference: 'takeoff', meters: 80 }, cameraHeight: 3 }, map, adjusted), 80);
  assert.deepEqual(photoCameraHeightRange(photo, campus, site), { min: .1, max: 3.5 });
  const bridge = campus.features.find(feature => feature.type === 'bridge');
  const stairs = campus.features.find(feature => feature.type === 'tunnelEntrance' && feature.curvedStair);
  for (const feature of [bridge, stairs]) {
    const ground = assignPhotoLocation(photo, feature.id, campus, site);
    assert.ok(Math.abs(photoMapHeight({ ...ground, cameraHeight: 2.4 }, campus, site) - photoMapHeight(ground, campus, site) - .8) < 1e-9);
  }
  assert.equal(assignPhotoLocation({ ...p, cameraHeight: 3 }, building.id, map, adjusted).cameraHeight, undefined);
});

test('local, package and cloud boundaries validate and retain the optional height', () => {
  const manifest = { locationIds: [], buildingIds: [], bounds: [-100, 100, -100, 100] };
  assert.equal(Object.hasOwn(validatePhoto(photo, photo, campus), 'cameraHeight'), false);
  assert.equal(Object.hasOwn(packageAnnotation(photo), 'cameraHeight'), false);
  assert.equal(Object.hasOwn(validateAnnotation(photo, manifest), 'cameraHeight'), false);
  for (const height of [.1, 2.4, 11.9]) {
    const p = { ...photo, cameraHeight: height };
    assert.equal(validatePhoto(p, photo, campus).cameraHeight, height);
    assert.equal(packageAnnotation(p).cameraHeight, height);
    assert.equal(photoAnnotation(p).cameraHeight, height);
    assert.equal(validateAnnotation(photoAnnotation(p), manifest).cameraHeight, height);
    assert.equal(validatePhoto({ ...p, cameraHeight: undefined }, p, campus).cameraHeight, undefined, 'Resetting height removes the old value');
  }
  for (const cameraHeight of [0, -.1, 12, NaN, Infinity, null, '2']) {
    const p = { ...photo, cameraHeight };
    assert.throws(() => validatePhoto(p, photo, campus), /拍摄高度/);
    assert.throws(() => packageAnnotation(p), /拍摄高度/);
    assert.throws(() => validateAnnotation(p, manifest), /拍摄高度/);
  }
});

test('camera height survives photo package import, saving, restoration and static export', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-camera-height-'));
  try {
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'public/data/campus.json'), JSON.stringify(campus));
    await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
    const bytes = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#778877' } }).jpeg().toBuffer();
    const annotation = { ...photo, buildingId: campus.buildings[0].id, floor: 2, cameraHeight: 2.4 };
    const pack = await createPhotoPackage(new File([bytes], '走廊.jpg', { type: 'image/jpeg' }), annotation);
    assert.equal((await readPhotoPackage(pack.bytes)).annotation.cameraHeight, 2.4);
    const files = unzipSync(pack.bytes), manifest = JSON.parse(strFromU8(files['manifest.json']));
    manifest.annotation.cameraHeight = 12;
    await assert.rejects(readPhotoPackage(zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify(manifest)) }, { level: 0 })), /拍摄高度/);
    const store = createStore(root), imported = await importPhotoPackage(store, pack.bytes);
    assert.equal(imported.photo.cameraHeight, 2.4);
    const saved = await store.publish(imported.photo.id, 0);
    assert.equal(saved.cameraHeight, 2.4);
    await store.removePhoto(saved.id, 1);
    await store.restorePhoto(saved.id, 2);
    await exportStaticContent(root, path.join(root, 'export'));
    const exported = JSON.parse(await fs.readFile(path.join(root, 'export/data/site.json')));
    assert.equal(exported.photos[0].cameraHeight, 2.4);
    assert.equal(exported.photos[0].position.height, undefined);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

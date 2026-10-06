import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { DoubleSide, Mesh, MeshBasicMaterial, Ray, Raycaster, Shape, ShapeGeometry, Vector2, Vector3 } from 'three';
import { assignPhotoLocation, photoMapHeight, photosAtLocation } from '../src/locations.ts';
import { curvedStairPoint, curvedStairTreads } from '../src/structure-geometry.ts';
import { photoPlacementPoint } from '../src/photo-placement.ts';
import { mapLocationTarget } from '../src/location-geometry.ts';
import { photoPointPosition, permanentPhotoSpots } from '../src/photo-clusters.ts';
import { createStore, exportStaticContent, validatePhoto } from '../server/storage.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const entrance = campus.features.find(feature => feature.id === 'local/underpass-entrance');
const photo = { id: '00000000-0000-0000-0000-000000000001', title: '入口台阶', description: '', capturedAt: '', buildingId: '', floor: 0,
  locationId: entrance.id, position: { x: 0, z: 0 }, heading: 70, pitch: -5, placed: true, width: 80, height: 40,
  downloadBytes: 1000, files: { thumbnail: 'old-thumb', display: 'old-display', download: 'old-download' } };

test('entrance photos follow individual flat treads, including either winding direction across the angle seam', () => {
  for (const stair of [entrance.curvedStair, { ...entrance.curvedStair, startAngle: 3, sweep: 1.25 }, { ...entrance.curvedStair, startAngle: -3, sweep: -1.25 }]) {
    const map = { ...campus, features: [{ ...entrance, curvedStair: stair }] };
    for (const i of [0, 7, stair.steps - 1]) {
      const [x, , z] = curvedStairPoint(stair, (i + .5) / stair.steps);
      const record = { ...photo, position: { x, z, height: 99 } };
      const expected = stair.topHeight + (stair.bottomHeight - stair.topHeight) * (i + 1) / stair.steps + 1.6;
      assert.ok(Math.abs(photoMapHeight(record, map, site) - expected) < 1e-8);
      assert.equal(validatePhoto(record, record, map).position.height, undefined, 'A stale/manual height cannot override the tread');
    }
  }
  const focus = mapLocationTarget(campus, site, entrance.id);
  const middle = curvedStairPoint(entrance.curvedStair, .5);
  assert.deepEqual(focus.target, middle, 'Selecting the entrance centers the actual stair, including its underground depth');
  assert.equal(focus.bounds.min[1], entrance.curvedStair.bottomHeight);
  assert.equal(entrance.hideLabel, false);
});

test('oblique annotation clicks hit the rendered tread rather than the transparent ground or photo eye plane', () => {
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const meshes = curvedStairTreads(entrance.curvedStair).map(tread => {
    const mesh = new Mesh(new ShapeGeometry(new Shape(tread.ring.map(([x, z]) => new Vector2(x, -z)))), material);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = tread.height; mesh.updateMatrixWorld();
    return mesh;
  });
  try {
    for (const i of [1, 8, 16]) {
      const [x, , z] = curvedStairPoint(entrance.curvedStair, (i + .5) / entrance.curvedStair.steps);
      const target = new Vector3(x, meshes[i].position.y, z);
      for (const offset of [new Vector3(4, 20, -5), new Vector3(-3, 15, 4)]) {
        const origin = target.clone().add(offset), direction = target.clone().sub(origin).normalize();
        const visibleHit = new Raycaster(origin, direction).intersectObjects(meshes)[0];
        assert.ok(visibleHit, 'The real stair mesh can be clicked');
        const placed = photoPlacementPoint(new Ray(origin, direction), photo, campus, site);
        assert.ok(placed);
        assert.ok(Math.hypot(placed.x - visibleHit.point.x, placed.z - visibleHit.point.z) < 1e-7);
        assert.ok(Math.abs(photoMapHeight({ ...photo, position: placed }, campus, site) - visibleHit.point.y - 1.6) < 1e-7);
      }
    }
    assert.equal(photoPlacementPoint(new Ray(new Vector3(100, 20, 100), new Vector3(0, -1, 0)), photo, campus, site), null, 'Clicks outside the stairs keep annotation active');
    assert.equal(photoPlacementPoint(new Ray(new Vector3(0, 20, 0), new Vector3(0, 1, 0)), photo, campus, site), null, 'Surfaces behind the click ray cannot be selected');
  } finally { for (const mesh of meshes) mesh.geometry.dispose(); material.dispose(); }
});

test('other locations and aerial annotation retain their existing placement planes', () => {
  const ray = new Ray(new Vector3(100, 30, 100), new Vector3(0, -1, 0));
  const tunnel = assignPhotoLocation(photo, 'local/underpass', campus, site);
  assert.deepEqual(photoPlacementPoint(ray, tunnel, campus, site), { x: 100, z: 100 });
  const aerial = { ...photo, captureType: 'aerial', altitude: { meters: 20, reference: 'takeoff' } };
  assert.deepEqual(photoPlacementPoint(ray, aerial, campus, site), { x: 100, z: 100 });
  assert.equal(photoMapHeight(aerial, campus, site), 20);
});

test('a stair point can sit on its tread while camera focus and photo grouping keep the shooting eye height', () => {
  const [x, , z] = curvedStairPoint(entrance.curvedStair, 14.5 / entrance.curvedStair.steps);
  const height = photoMapHeight({ ...photo, position: { x, z } }, campus, site);
  const rendered = { ...photo, position: { x, z, height }, pointHeight: height - 1.6 + .08 };
  assert.deepEqual(photoPointPosition(rendered).toArray(), [x, height - 1.52, z]);
  assert.deepEqual(permanentPhotoSpots([rendered])[0].position.toArray(), [x, height, z]);
  assert.deepEqual(photoPointPosition({ ...rendered, pointHeight: undefined }).toArray(), [x, height + .4, z], 'Existing ground and aerial points retain their offset');
});

test('stair annotation retains its height and filter association after review, restore and static export', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-stair-photo-'));
  try {
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'public/data/campus.json'), JSON.stringify(campus));
    await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
    const store = createStore(root), bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#47694e' } }).jpeg().toBuffer();
    const draft = await store.importPhoto(bytes), state = await store.state();
    const [x, , z] = curvedStairPoint(entrance.curvedStair, 14.5 / entrance.curvedStair.steps);
    const assigned = assignPhotoLocation({ ...draft, placed: true, position: { x, z } }, entrance.id, campus, state.site);
    const height = photoMapHeight(assigned, campus, state.site);
    await store.updateDraft(draft.id, assigned);
    const published = await store.publish(draft.id, 0);
    assert.deepEqual(published.position, { x, z });
    assert.equal(photoMapHeight(published, campus, state.site), height);
    assert.deepEqual(photosAtLocation([published], entrance.id, 0, campus), [published]);
    await store.removePhoto(draft.id, 1); await store.restorePhoto(draft.id, 2);
    await exportStaticContent(root, path.join(root, 'dist'));
    const exported = JSON.parse(await fs.readFile(path.join(root, 'dist/data/site.json')));
    assert.equal(photoMapHeight(exported.photos[0], campus, exported), height);
    assert.deepEqual(exported.photos[0].position, { x, z });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

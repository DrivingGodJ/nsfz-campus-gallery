import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { regionPhotoClusters } from '../src/photo-clusters.ts';
import { markerOccluders } from '../src/photo-marker-occlusion.ts';

const size = { width: 900, height: 600 };
const rectangle = (x, z, width, depth) => ({ outer: [[x, z], [x + width, z], [x + width, z + depth], [x, z + depth], [x, z]], holes: [] });
const building = (id = 'teaching') => ({ id, name: id, floors: 4, center: [0, 0], ...rectangle(-10, -10, 20, 20) });
const options = (buildings = [building()], features = []) => ({ campus: { buildings, features }, site: { buildingOverrides: {}, photos: [] } });
const shot = (id, x = 0, z = 0, height = 1.6, locationId = '') => ({ id, capturedAt: '2025-04-18', position: { x, z, height }, locationId, floor: locationId ? 1 : 0 });
const cameraAt = (z = 40, x = 0, y = 1.6, target = [0, y, 0]) => {
  const camera = new THREE.PerspectiveCamera(70, size.width / size.height, .08, 2000);
  camera.position.set(x, y, z); camera.lookAt(...target); camera.updateMatrixWorld(); return camera;
};
const wall = (scene, id = 'teaching', z = 5, x = 0, y = 6, width = 20, height = 12) => {
  const group = new THREE.Group(); group.userData = { photoOccluder: true, buildingId: id }; scene.add(group);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, .3), new THREE.MeshBasicMaterial());
  mesh.position.set(x, y, z); group.add(mesh); return mesh;
};
const ids = clusters => clusters.flatMap(cluster => cluster.photos.map(photo => photo.id)).sort();
const dispose = scene => scene.traverse(object => {
  if (!(object instanceof THREE.Mesh)) return;
  object.geometry.dispose(); object.material.dispose();
});

test('blocked exterior photographs leave no cards, collection entries or preload IDs', () => {
  const scene = new THREE.Scene(); wall(scene, 'teaching', 5, 0, 6, 12);
  const config = options(undefined, [{ id: 'garden', name: '花园', type: 'forest', ...rectangle(-4, -20, 8, 10) }]);
  const hidden = [shot('outside', 0, -15), shot('garden', 1, -15, 1.6, 'garden')];
  const before = JSON.stringify(hidden), blockers = markerOccluders(scene);
  for (const camera of [cameraAt(), cameraAt(200)]) {
    assert.deepEqual(regionPhotoClusters(hidden, camera, size, blockers, config), []);
    const clusters = regionPhotoClusters([...hidden, shot('visible-outside', 20, -15)], camera, size, blockers, config);
    assert.deepEqual(ids(clusters), ['visible-outside']);
    assert.deepEqual(clusters.flatMap(cluster => cluster.spots.map(spot => spot.id)), ['visible-outside']);
    assert.ok(clusters.every(cluster => cluster.opacity === 1 && !cluster.overflow));
  }
  assert.equal(JSON.stringify(hidden), before);
  dispose(scene);
});

test('a location label cannot exempt an exterior, courtyard-hole or aerial point from its building', () => {
  const scene = new THREE.Scene(); wall(scene);
  const teaching = { ...building(), holes: [rectangle(-2, -2, 4, 4).outer] }, config = options([teaching]);
  const photos = [shot('outside', 0, -15, 1.6, 'teaching'), shot('courtyard', 0, 0, 1.6, 'teaching'),
    { ...shot('aerial', 0, -5, 1.6, 'teaching'), captureType: 'aerial' }, shot('indoor', 5, 0, 1.6, 'teaching')];
  for (const selectedId of [undefined, 'outside', 'courtyard', 'aerial']) {
    const clusters = regionPhotoClusters(photos, cameraAt(), size, markerOccluders(scene), { ...config, selectedId });
    assert.deepEqual(ids(clusters), ['indoor']);
    assert.ok(clusters[0].opacity > 0 && clusters[0].opacity < 1);
  }
  dispose(scene);
});

test('an expanded indoor point fades through its own building while its distant collection stays opaque', () => {
  const scene = new THREE.Scene(); wall(scene);
  const photos = [shot('indoor-a', -2, 0, 1.6, 'teaching'), shot('indoor-b', 2, 0, 1.6, 'teaching')], config = options();
  const blockers = markerOccluders(scene);
  const close = regionPhotoClusters(photos, cameraAt(), size, blockers, config);
  assert.deepEqual(ids(close), ['indoor-a', 'indoor-b']);
  assert.ok(close.every(cluster => !cluster.collapsed && cluster.occlusionLayers === 1 && cluster.opacity > 0 && cluster.opacity < 1));
  const far = regionPhotoClusters(photos, cameraAt(200), size, blockers, config);
  assert.equal(far.length, 1); assert.equal(far[0].collapsed, true);
  assert.equal(far[0].opacity, 1); assert.equal(far[0].occlusionLayers, 0);
  assert.deepEqual(ids(far), ['indoor-a', 'indoor-b']);
  dispose(scene);
});

test('indoor exemption never makes a second building transparent at either collection distance', () => {
  const scene = new THREE.Scene(); wall(scene); wall(scene, 'other', 15);
  const config = options([building(), { ...building('other'), ...rectangle(-10, 10, 20, 10) }]);
  const photos = [shot('indoor', 0, 0, 1.6, 'teaching')], blockers = markerOccluders(scene);
  for (const camera of [cameraAt(), cameraAt(200)]) {
    assert.deepEqual(regionPhotoClusters(photos, camera, size, blockers, config), []);
  }
  dispose(scene);
});

test('aliases and raised bases use each wing height instead of the tallest building bounding box', () => {
  const scene = new THREE.Scene(); wall(scene, 'teaching', 10, -5, 30, 10, 36);
  const teaching = { ...building(), baseElevation: 12, floors: 5, parts: [
    { id: 'main', ...rectangle(-10, -10, 10, 20) }, { id: 'annex', floors: 1, ...rectangle(0, -10, 10, 20) }] };
  const config = options([teaching]); config.campus.buildingAliases = { oldTeaching: 'teaching' };
  config.site.buildingOverrides.teaching = { floorHeight: 4 };
  const photos = [shot('main', -5, 0, 13.6, 'oldTeaching'), shot('annex', 5, 0, 13.6, 'oldTeaching'),
    shot('below-base', -5, 0, 10, 'oldTeaching'), shot('above-annex-roof', 5, 0, 17.2, 'oldTeaching')];
  const clusters = regionPhotoClusters(photos, cameraAt(40, -20, 20, [0, 16, 0]), size, markerOccluders(scene), config);
  assert.deepEqual(ids(clusters), ['annex', 'main']);
  assert.ok(clusters.every(cluster => cluster.regionId === 'teaching' && cluster.opacity > 0 && cluster.opacity < 1));
  dispose(scene);
});

test('overlapping inside and outside photographs in one destination retain separate appearance policies', () => {
  const teaching = { ...building(), ...rectangle(0, -10, 20, 20) }, config = options([teaching]);
  const photos = [shot('inside', .05, 0, 1.6, 'teaching'), shot('outside', -.05, 0, 1.6, 'teaching')];
  const clusters = regionPhotoClusters(photos, cameraAt(), size, [], config);
  assert.equal(clusters.length, 2);
  assert.ok(clusters.every(cluster => cluster.photos.length === 1 && !cluster.collapsed && cluster.opacity === 1));
  assert.deepEqual(ids(clusters), ['inside', 'outside']);
  for (const cluster of clusters) {
    const photo = cluster.photos[0];
    assert.deepEqual(cluster.position.toArray(), [photo.position.x, photo.position.height, photo.position.z]);
  }
});

test('offscreen cards avoid hard rays while distant collections keep their members and edited points invalidate membership', () => {
  const scene = new THREE.Scene(), mesh = wall(scene, 'other', 5, 0, 6, 2200), config = options();
  let rays = 0; mesh.raycast = () => { rays++; };
  const indoor = shot('inside', 0, 0, 1.6, 'teaching'), offscreen = shot('offscreen', 1000, 0, 1.6, 'teaching');
  const photos = [indoor, offscreen], blockers = markerOccluders(scene);
  let clusters = regionPhotoClusters(photos, cameraAt(), size, blockers, config);
  assert.deepEqual(ids(clusters), ['inside']); assert.equal(rays, 1, 'A fully offscreen card needs no hard visibility query');
  rays = 0;
  clusters = regionPhotoClusters(photos, cameraAt(200), size, blockers, config);
  assert.equal(clusters[0].collapsed, true); assert.deepEqual(ids(clusters), ['inside', 'offscreen']);
  assert.equal(rays, 2, 'Collapsed collection membership still checks offscreen members for exterior blockers');
  indoor.position.x = 20;
  clusters = regionPhotoClusters(photos, cameraAt(), size, blockers, config);
  assert.equal(clusters[0].opacity, 1, 'Editing the same photo object from indoor to outdoor invalidates the cached membership');
  indoor.position.x = 0; indoor.captureType = 'aerial';
  clusters = regionPhotoClusters(photos, cameraAt(), size, blockers, config);
  assert.equal(clusters[0].opacity, 1, 'A capture-type edit cannot reuse the indoor exemption');
  dispose(scene);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { acceleratePhotoOccluder } from '../src/photo-occlusion.ts';
import { cameraPhotoClusters, permanentPhotoSpots, photoOccluders, photoPointPosition, photoPointVisible, visiblePhotoPoints } from '../src/photo-clusters.ts';

test('accelerated photo visibility preserves triangle masks and sees opaque walls behind nonblocking corridor slabs', () => {
  const slab = new THREE.PlaneGeometry(10, 10), wall = new THREE.PlaneGeometry(10, 10);
  slab.translate(0, 3.4, 5); wall.translate(0, 3.4, 0);
  const geometry = mergeGeometries([slab, wall]);
  geometry.userData.photoOcclusionMask = [0, 0, 1, 1];
  const originalIndex = Array.from(geometry.index.array), mask = [...geometry.userData.photoOcclusionMask];
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material), group = new THREE.Group(), scene = new THREE.Scene();
  group.userData.photoOccluder = true; group.add(mesh); scene.add(group);
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
  camera.position.set(0, 3.4, 20); camera.lookAt(0, 3.4, 0); camera.updateMatrixWorld();
  const size = { width: 900, height: 600 }, anchor = new THREE.Vector3(0, 1.6, -5);
  assert.equal(photoPointVisible(anchor, camera, size, [mesh]), false);
  const occluders = photoOccluders(scene), tree = geometry.boundsTree;
  assert.ok(tree); assert.equal(tree.indirect, true);
  assert.deepEqual(Array.from(geometry.index.array), originalIndex);
  assert.deepEqual(geometry.userData.photoOcclusionMask, mask);
  assert.equal(photoPointVisible(anchor, camera, size, occluders), false, 'A nonblocking nearest hit must not conceal a wall behind it');
  const ray = new THREE.Raycaster();
  for (let x = -.3; x <= .3; x += .1) {
    ray.setFromCamera(new THREE.Vector2(x, 0), camera);
    const expected = [], actual = [];
    THREE.Mesh.prototype.raycast.call(mesh, ray, expected); mesh.raycast(ray, actual);
    expected.sort((a,b) => a.distance-b.distance); actual.sort((a,b) => a.distance-b.distance);
    assert.deepEqual(actual.map(hit => hit.faceIndex), expected.map(hit => hit.faceIndex), 'Pointer selection also keeps original face indices');
  }
  geometry.userData.photoOcclusionMask.fill(0);
  assert.equal(photoPointVisible(anchor, camera, size, occluders), true);
  assert.equal(photoOccluders(scene)[0].geometry.boundsTree, tree, 'Reuse the index across camera movement');
  geometry.dispose(); assert.equal(geometry.boundsTree, undefined);
  slab.dispose(); wall.dispose(); material.dispose();
});

test('glass, hidden groups and deliberately non-interactive details retain their visibility and picking rules', () => {
  const scene = new THREE.Scene(), group = new THREE.Group(); group.userData.photoOccluder = true; scene.add(group);
  const material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); group.add(mesh);
  const custom = () => null; mesh.raycast = custom;
  acceleratePhotoOccluder(mesh); assert.equal(mesh.raycast, custom); assert.equal(mesh.geometry.boundsTree, undefined);
  material.transparent = true; material.depthWrite = false; assert.deepEqual(photoOccluders(scene), []);
  material.transparent = false; material.depthWrite = true; group.visible = false; assert.deepEqual(photoOccluders(scene), []);
  group.visible = true; assert.deepEqual(photoOccluders(scene), [mesh]);
  mesh.geometry.dispose(); material.dispose();
});

test('interior photo points and thumbnails ignore their own building shell while other buildings still block them', () => {
  const scene = new THREE.Scene(), building = new THREE.Group(), nested = new THREE.Group();
  building.userData = { photoOccluder: true, buildingId: 'own-building' };
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.BoxGeometry(6, 12, 6), material);
  body.position.y = 6; nested.add(body); building.add(nested); scene.add(building);
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000), size = { width: 900, height: 600 };
  const shot = id => ({ id, position: { x: 0, z: 0, height: 1.6 } });
  const photos = [
    { ...shot('interior-legacy'), buildingId: 'own-building' },
    { ...shot('interior-location'), locationId: 'own-building', buildingId: 'old-building' },
    { ...shot('another-building'), locationId: 'another-building' },
    { ...shot('outside-unassigned') },
    { ...shot('aerial'), buildingId: 'own-building', captureType: 'aerial' }
  ];
  const before = JSON.stringify(photos), spots = permanentPhotoSpots(photos);
  assert.ok(spots.some(spot => spot.photos.some(photo => photo.id === 'another-building') && spot.photos.some(photo => photo.id === 'interior-legacy')));
  for (const z of [20, -20]) {
    camera.position.set(0, 3.4, z); camera.lookAt(0, 3.4, 0); camera.updateMatrixWorld();
    const occluders = photoOccluders(scene), ray = new THREE.Raycaster();
    ray.set(camera.position, photoPointPosition(photos[0]).sub(camera.position).normalize());
    assert.ok(ray.intersectObjects(occluders, false).length, 'The actual opaque building mesh lies between camera and interior point');
    assert.equal(photoPointVisible(new THREE.Vector3(0, 1.6, 0), camera, size, occluders), false, 'The building still occludes without an ownership exemption');
    assert.deepEqual(visiblePhotoPoints(photos, camera, size, occluders).map(photo => photo.id), ['interior-legacy', 'interior-location']);
    assert.deepEqual(cameraPhotoClusters(spots, camera, size, occluders).flatMap(cluster => cluster.photos.map(photo => photo.id)).sort(), ['interior-legacy', 'interior-location']);
  }
  camera.position.set(0, 3.4, 20); camera.lookAt(0, 3.4, 0); camera.updateMatrixWorld();
  const otherBuilding = new THREE.Group(), otherBody = new THREE.Mesh(new THREE.BoxGeometry(6, 12, 2), material);
  otherBuilding.userData = { photoOccluder: true, buildingId: 'other-building' };
  otherBody.position.set(0, 6, 10); otherBuilding.add(otherBody); scene.add(otherBuilding);
  assert.deepEqual(visiblePhotoPoints(photos, camera, size, photoOccluders(scene)), [], 'An intervening different building continues to hide interior points');
  assert.deepEqual(cameraPhotoClusters(spots, camera, size, photoOccluders(scene)), [], 'Own-shell exemptions cannot bypass another building for thumbnails');
  otherBuilding.visible = false;
  assert.deepEqual(visiblePhotoPoints(photos, camera, size, photoOccluders(scene)).map(photo => photo.id), ['interior-legacy', 'interior-location']);
  assert.equal(JSON.stringify(photos), before, 'Visibility never rewrites persisted location or coordinates');
  body.geometry.dispose(); otherBody.geometry.dispose(); material.dispose();
});

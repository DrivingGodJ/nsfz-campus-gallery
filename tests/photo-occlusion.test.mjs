import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { acceleratePhotoOccluder } from '../src/photo-occlusion.ts';
import { photoOccluders, photoPointVisible } from '../src/photo-clusters.ts';

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

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { ghostSurfaceModel } from '../src/map-model-layer.ts';
import { isPhotoOccluder } from '../src/photo-occlusion.ts';
import { markerOccluders, markerOcclusionLayers } from '../src/photo-marker-occlusion.ts';
import { regionPhotoClusters } from '../src/photo-clusters.ts';

const cameraAt = (y = -2, z = 20) => {
  const camera = new THREE.PerspectiveCamera(70, 1.5, .08, 2000);
  camera.position.set(0, y, z); camera.lookAt(0, -2, 0); camera.updateMatrixWorld(); return camera;
};
const box = (parent, dimensions, position, material = new THREE.MeshBasicMaterial()) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
  mesh.position.set(...position); parent.add(mesh); return mesh;
};
const dispose = scene => scene.traverse(object => {
  if (object instanceof THREE.Mesh) { object.geometry.dispose(); object.material.dispose(); }
});

test('ghost roofs and glazing contribute no layers while real underground walls remain physical', () => {
  const scene = new THREE.Scene(), surface = new THREE.Group(); surface.userData.photoOccluder = true; scene.add(surface);
  const roof = box(surface, [60, .3, 60], [0, 0, 0]);
  const glass = box(surface, [12, 8, .3], [0, 4, 15], new THREE.MeshBasicMaterial({ transparent: true, opacity: .4, depthWrite: false }));
  const underground = box(scene, [12, 6, .3], [0, -2.5, 4]); underground.userData.markerOccluder = true;
  const camera = cameraAt(4), anchor = new THREE.Vector3(0, -3, 0);
  const before = markerOccluders(scene);
  assert.deepEqual(before, [roof, glass, underground]);
  assert.equal(markerOcclusionLayers(anchor, camera, before), 3);
  const restore = ghostSurfaceModel(surface);
  try {
    assert.equal(surface.userData.markerOccluder, false);
    // Child props may briefly commit an opaque material before layout cleanup.
    roof.material.transparent = false; roof.material.depthWrite = true;
    assert.equal(isPhotoOccluder(roof), false);
    const ghost = markerOccluders(scene);
    assert.deepEqual(ghost, [underground]);
    assert.equal(markerOcclusionLayers(anchor, camera, ghost), 1);
  } finally { restore(); }
  const returned = markerOccluders(scene);
  assert.deepEqual(returned, [roof, glass, underground]);
  assert.equal(markerOcclusionLayers(anchor, camera, returned), 3);
  assert.equal(Object.hasOwn(surface.userData, 'markerOccluder'), false);
  dispose(scene);
});

test('ghost partitions stop separating photo cards, but an actual underground partition still separates them', () => {
  const scene = new THREE.Scene(), surface = new THREE.Group();
  surface.userData = { photoOccluder: true, buildingId: 'teaching' }; scene.add(surface);
  box(surface, [12, 10, .3], [0, -2, 0]);
  const options = { campus: { features: [], buildings: [{ id: 'teaching', name: '教学楼', floors: 4, baseElevation: -6,
    outer: [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]], holes: [] }] }, site: { buildingOverrides: {}, photos: [] } };
  const photos = [1, -1].map((z, index) => ({ id: String(index), locationId: 'teaching', floor: 1, position: { x: 0, z, height: -2 } }));
  const camera = cameraAt(), size = { width: 900, height: 600 };
  const clusters = () => regionPhotoClusters(photos, camera, size, markerOccluders(scene), options);
  assert.equal(clusters().length, 2);
  const restore = ghostSurfaceModel(surface);
  try {
    const merged = clusters();
    assert.equal(merged.length, 1); assert.equal(merged[0].photos.length, 2);
    assert.equal(merged[0].opacity, 1); assert.equal(merged[0].occlusionLayers, 0);
    const physical = new THREE.Group(); physical.userData = { photoOccluder: true, buildingId: 'teaching' }; scene.add(physical);
    box(physical, [12, 10, .3], [0, -2, 0]);
    const separate = clusters();
    assert.equal(separate.length, 2);
    assert.ok(separate.some(cluster => cluster.opacity === 1));
    assert.ok(separate.some(cluster => cluster.opacity > 0 && cluster.opacity < 1));
  } finally { restore(); }
  assert.equal(markerOccluders(scene).length, 2);
  assert.equal(clusters().length, 2);
  dispose(scene);
});

test('returning from ghost mode restores an existing occluder flag and preserves other metadata', () => {
  for (const original of [true, false, undefined]) {
    const group = new THREE.Group(); group.userData = { markerOccluder: original, buildingId: 'teaching' };
    const restore = ghostSurfaceModel(group);
    assert.equal(group.userData.markerOccluder, false);
    restore();
    assert.equal(group.userData.markerOccluder, original);
    assert.equal(Object.hasOwn(group.userData, 'markerOccluder'), true);
    assert.equal(group.userData.buildingId, 'teaching');
  }
});

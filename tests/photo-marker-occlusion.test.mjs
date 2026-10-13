import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { markerOccluders, markerOcclusionLayers, markerMergeAllowed } from '../src/photo-marker-occlusion.ts';

const cameraAt = (x = 0, y = 1.6, z = 20) => {
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
  camera.position.set(x, y, z); camera.lookAt(x, y, 0); camera.updateMatrixWorld(); return camera;
};
const wall = (scene, z, thickness = .3) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(12, 10, thickness), new THREE.MeshBasicMaterial());
  mesh.position.set(0, 1.6, z); scene.add(mesh); return mesh;
};
const disposeScene = scene => scene.traverse(object => {
  if (!(object instanceof THREE.Mesh)) return;
  object.geometry.dispose(); for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
});

test('physical collection includes untagged and transparent entities while preserving pointer exclusions and excluding helpers', () => {
  const scene = new THREE.Scene(), solid = wall(scene, 5), glass = wall(scene, 10);
  const noPicking = () => null; solid.raycast = noPicking;
  glass.material.transparent = true; glass.material.opacity = .16; glass.material.depthWrite = false; glass.raycast = noPicking;
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1.6, 7), 2); scene.add(arrow);
  const sky = wall(scene, 15); sky.name = 'campus-sky-dome';
  const helper = wall(scene, 12); helper.material.depthTest = false;
  const hidden = wall(scene, 11); hidden.visible = false;
  const excluded = new THREE.Group(); excluded.userData.markerOccluder = false; scene.add(excluded); excluded.add(wall(scene, 8));
  const occluders = markerOccluders(scene), tree = solid.geometry.boundsTree;
  assert.deepEqual(occluders, [solid, glass]); assert.ok(tree);
  assert.equal(markerOcclusionLayers(new THREE.Vector3(0, 1.6, 0), cameraAt(), occluders), 2);
  assert.equal(solid.raycast, noPicking); assert.equal(glass.raycast, noPicking);
  assert.deepEqual(new THREE.Raycaster(new THREE.Vector3(0, 1.6, 20), new THREE.Vector3(0, 0, -1)).intersectObject(solid), []);
  assert.equal(markerOccluders(scene)[0].geometry.boundsTree, tree, 'A collection reuses the existing index');
  helper.userData.markerOccluder = true;
  assert.ok(markerOccluders(scene).includes(helper), 'Real underground entities may explicitly keep their physical meaning');
  disposeScene(scene); arrow.dispose(); assert.equal(solid.geometry.boundsTree, undefined);
});

test('a wall counts once regardless of thickness or grazing angle, and duplicate render faces do not add layers', () => {
  const scene = new THREE.Scene(), material = new THREE.MeshBasicMaterial();
  const slab = new THREE.Mesh(new THREE.BoxGeometry(100, 1, 100), material); scene.add(slab);
  const camera = cameraAt(0, .8, 30), anchor = new THREE.Vector3(0, -.8, -30);
  camera.lookAt(anchor); camera.updateMatrixWorld();
  assert.equal(markerOcclusionLayers(anchor, camera, markerOccluders(scene)), 1);
  const duplicate = slab.clone(); scene.add(duplicate);
  assert.equal(markerOcclusionLayers(anchor, camera, markerOccluders(scene)), 1);
  disposeScene(scene);
});

test('every intermediate floor remains a layer, including corridor visibility exemptions and non-interactive ground', () => {
  const scene = new THREE.Scene(), camera = cameraAt(.7, 20, .3), anchor = new THREE.Vector3(.7, -2, .3);
  camera.lookAt(anchor); camera.updateMatrixWorld();
  for (const y of [9, 6, 3]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(10, .25, 10), new THREE.MeshBasicMaterial());
    slab.position.y = y; slab.geometry.userData.photoOcclusionMask = new Uint8Array(12); slab.raycast = () => null; scene.add(slab);
  }
  assert.equal(markerOcclusionLayers(anchor, camera, markerOccluders(scene)), 3);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial());
  ground.rotation.x = -Math.PI / 2; ground.raycast = () => null; scene.add(ground);
  assert.equal(markerOcclusionLayers(anchor, camera, markerOccluders(scene)), 4);
  disposeScene(scene);
});

test('photos behind the same wall can merge, but different actual barriers with equal camera layer counts cannot', () => {
  const scene = new THREE.Scene(), camera = cameraAt(), a = new THREE.Vector3(-2, 1.6, -5), b = new THREE.Vector3(2, 1.6, -5);
  wall(scene, 3);
  let occluders = markerOccluders(scene);
  assert.equal(markerOcclusionLayers(a, camera, occluders), 1); assert.equal(markerOcclusionLayers(b, camera, occluders), 1);
  assert.equal(markerMergeAllowed(a, b, camera, occluders), true);
  const partition = new THREE.Mesh(new THREE.BoxGeometry(.3, 10, 6), new THREE.MeshBasicMaterial());
  partition.position.set(0, 1.6, -5); partition.raycast = () => null; scene.add(partition);
  occluders = markerOccluders(scene);
  assert.equal(markerOcclusionLayers(a, camera, occluders), 1); assert.equal(markerOcclusionLayers(b, camera, occluders), 1);
  assert.equal(markerMergeAllowed(a, b, camera, occluders), false, 'The segment crosses a partition despite equal camera occlusion');
  disposeScene(scene);
});

test('disjoint coplanar walls in one merged model retain separate barrier identities', () => {
  const scene = new THREE.Scene(), left = new THREE.BoxGeometry(2, 6, .3), right = left.clone();
  left.translate(-3, 1.6, 5); right.translate(3, 1.6, 5);
  const body = new THREE.Mesh(mergeGeometries([left, right]), new THREE.MeshBasicMaterial()); scene.add(body);
  const camera = cameraAt(), a = new THREE.Vector3(-4, 1.6, 0), b = new THREE.Vector3(4, 1.6, 0), occluders = markerOccluders(scene);
  assert.equal(markerOcclusionLayers(a, camera, occluders), 1); assert.equal(markerOcclusionLayers(b, camera, occluders), 1);
  assert.equal(markerMergeAllowed(a, b, camera, occluders), false, 'Equal counts and a shared render mesh are insufficient');
  left.dispose(); right.dispose(); disposeScene(scene);
});

test('separate floors cannot merge even when neither camera ray is blocked', () => {
  const scene = new THREE.Scene(), camera = cameraAt(20, 2, 0);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(10, .3, 10), new THREE.MeshBasicMaterial()); slab.position.y = 3.6; scene.add(slab);
  const a = new THREE.Vector3(0, 1.6, 0), b = new THREE.Vector3(0, 5.2, 0), occluders = markerOccluders(scene);
  assert.equal(markerMergeAllowed(a, b, camera, occluders), false);
  disposeScene(scene);
});

test('back faces and instanced opaque entities remain physical without altering their picking handlers', () => {
  const scene = new THREE.Scene(), plane = new THREE.Mesh(new THREE.PlaneGeometry(12, 10), new THREE.MeshBasicMaterial());
  plane.rotation.y = Math.PI; plane.position.set(0, 1.6, 9); plane.raycast = () => null; scene.add(plane);
  const instances = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 10, .3), new THREE.MeshBasicMaterial(), 2);
  instances.raycast = () => null;
  instances.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 1.6, 3)); instances.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0, 1.6, 6)); scene.add(instances);
  const camera = cameraAt(), occluders = markerOccluders(scene), pointer = instances.raycast;
  assert.equal(markerOcclusionLayers(new THREE.Vector3(0, 1.6, 0), camera, occluders), 3);
  assert.equal(instances.raycast, pointer);
  assert.equal(markerOcclusionLayers(new THREE.Vector3(0, 1.6, 7), camera, occluders), 1, 'Camera results cache each exact anchor independently');
  camera.position.z = 8; camera.updateMatrixWorld();
  assert.equal(markerOcclusionLayers(new THREE.Vector3(0, 1.6, 0), camera, occluders), 2, 'Moving the camera invalidates its layer cache');
  disposeScene(scene);
});

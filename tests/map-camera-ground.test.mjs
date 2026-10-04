import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { keepMapCameraAboveGround, MAP_CAMERA_GROUND_HEIGHT } from '../src/map-camera-ground.ts';
import { panMapView, travelAlongView } from '../src/map-travel-controls.ts';

test('downward pan and travel stop at eye level, while off-campus movement remains free', () => {
  const camera = new PerspectiveCamera(43, 1.5, .5, 4000), target = new Vector3(2000, 0, -30);
  camera.position.set(2000, 3, 10); camera.lookAt(target); camera.updateMatrixWorld();
  const orientation = camera.quaternion.clone(), offset = camera.position.clone().sub(target);
  panMapView(camera, target, 200, -100000, 600);
  assert.equal(camera.position.y, MAP_CAMERA_GROUND_HEIGHT);
  assert.ok(camera.position.clone().sub(target).distanceTo(offset) < 1e-8);
  travelAlongView(camera, target, 100000);
  assert.equal(camera.position.y, MAP_CAMERA_GROUND_HEIGHT);
  assert.ok(Math.abs(camera.position.z) > 10000);
  assert.ok(camera.quaternion.angleTo(orientation) < 1e-7);
});

test('unexpected underground map camera recovers without changing its gaze, but previews and their animations are exempt', () => {
  const camera = new PerspectiveCamera(), target = new Vector3(14, -8, -15);
  camera.position.set(10, -3, 0); camera.lookAt(target); camera.updateMatrixWorld();
  const before = camera.position.clone(), direction = camera.getWorldDirection(new Vector3());
  assert.equal(keepMapCameraAboveGround(camera, target, true), false);
  assert.deepEqual(camera.position.toArray(), before.toArray());
  assert.equal(keepMapCameraAboveGround(camera, target), true);
  assert.equal(camera.position.y, MAP_CAMERA_GROUND_HEIGHT);
  assert.equal(camera.position.x, 10); assert.equal(camera.position.z, 0);
  assert.ok(camera.getWorldDirection(new Vector3()).distanceTo(direction) < 1e-8);
  assert.equal(keepMapCameraAboveGround(camera, target), false);
});

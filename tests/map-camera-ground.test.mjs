import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { keepMapCameraAboveGround, shiftMapCameraGround, MAP_CAMERA_GROUND_HEIGHT } from '../src/map-camera-ground.ts';
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

test('underground pan and travel use the basement eye level without rising to the surface', () => {
  const ground = -3.8, camera = new PerspectiveCamera(43, 1.5, .5, 4000), target = new Vector3(20, ground, -30);
  camera.position.set(10, ground + 3, 10); camera.lookAt(target); camera.updateMatrixWorld();
  const orientation = camera.quaternion.clone(), offset = camera.position.clone().sub(target);
  panMapView(camera, target, 200, -100000, 600, ground);
  assert.equal(camera.position.y, ground + MAP_CAMERA_GROUND_HEIGHT);
  travelAlongView(camera, target, 100000, ground);
  assert.equal(camera.position.y, ground + MAP_CAMERA_GROUND_HEIGHT);
  assert.ok(camera.position.y < 0 && Math.abs(camera.position.z) > 10000);
  assert.ok(camera.position.clone().sub(target).distanceTo(offset) < 1e-8);
  assert.ok(camera.quaternion.angleTo(orientation) < 1e-7);
});

test('changing reference ground is reversible and fixed photo perspectives remain exact', () => {
  const camera = new PerspectiveCamera(43, 1.5, .08, 4000), target = new Vector3(14, 0, -15);
  camera.position.set(10, 1.6, 0); camera.lookAt(target); camera.updateMatrixWorld();
  const position = camera.position.clone(), gaze = camera.quaternion.clone(), originalTarget = target.clone();
  assert.equal(shiftMapCameraGround(camera, target, 0, -3.8), true);
  assert.equal(camera.position.y, -3.8 + 1.6);
  assert.ok(target.distanceTo(originalTarget.clone().add(new Vector3(0, -3.8, 0))) < 1e-8);
  assert.equal(shiftMapCameraGround(camera, target, -3.8, 0), true);
  assert.ok(camera.position.distanceTo(position) < 1e-8 && target.distanceTo(originalTarget) < 1e-8);
  assert.ok(camera.quaternion.angleTo(gaze) < 1e-7 && camera.fov === 43 && camera.near === .08);
  assert.equal(shiftMapCameraGround(camera, target, 0, -3.8, true), false);
  assert.ok(camera.position.distanceTo(position) < 1e-8);
  camera.position.y = -8;
  assert.equal(keepMapCameraAboveGround(camera, target, true, -3.8), false);
  assert.equal(camera.position.y, -8);
});

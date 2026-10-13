import test from 'node:test';
import assert from 'node:assert/strict';
import { Camera, Euler, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { FULL_MAP_VIEWPORT, mapObjectApproach, mapObjectFocusPose, photoMapFocusPose } from '../src/map-card-viewport.ts';
import { MAP_CAMERA_GROUND_HEIGHT } from '../src/map-camera-ground.ts';

const center = bounds => new Vector3(...bounds.min).add(new Vector3(...bounds.max)).multiplyScalar(.5);
const corners = bounds => [bounds.min[0], bounds.max[0]].flatMap(x =>
  [bounds.min[1], bounds.max[1]].flatMap(y => [bounds.min[2], bounds.max[2]].map(z => new Vector3(x, y, z))));
const poseAt = (yaw, fov = 43) => ({ position: new Vector3(100, 200, 300), target: new Vector3(),
  quaternion: new Quaternion().setFromEuler(new Euler(-.2, yaw, 0, 'YXZ')), fov, near: .5 });
const cameraAt = (pose, aspect) => {
  const camera = new PerspectiveCamera(pose.fov, aspect, pose.near, 4000);
  camera.position.copy(pose.position); camera.quaternion.copy(pose.quaternion); camera.updateMatrixWorld();
  return camera;
};
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is close to ${expected}`);

test('whole buildings and flat destinations fit the exposed frame across phone sheets, desktop cards and every yaw', () => {
  const frames = [
    { aspect: 1.5, viewport: FULL_MAP_VIEWPORT },
    { aspect: 1.5, viewport: { left: .36, top: .04, width: .64, height: .92 } },
    { aspect: 390 / 844, viewport: FULL_MAP_VIEWPORT },
    { aspect: 390 / 844, viewport: { left: 0, top: .07, width: 1, height: .38 } }
  ];
  const destinations = [
    { bounds: { min: [-22, 3.6, -35], max: [22, 25.2, 35] }, ground: 0 },
    { bounds: { min: [0, 0, 0], max: [4, 10, 3] }, ground: 0 },
    { bounds: { min: [-110, 0, -3], max: [110, 18, 3] }, ground: 0 },
    { bounds: { min: [-75, 3.6, -60], max: [75, 3.6, 60] }, ground: 0 },
    { bounds: { min: [-45, -14, -6], max: [45, -7, 6] }, ground: -14 }
  ];
  for (const { aspect, viewport } of frames) for (const { bounds, ground } of destinations) for (const yaw of [-Math.PI, -Math.PI / 2, .4, Math.PI / 2]) {
    const original = poseAt(yaw), focused = mapObjectFocusPose(original, new Vector3(...bounds.min), bounds, aspect, viewport, ground);
    const camera = cameraAt(focused, aspect), orientation = new Euler().setFromQuaternion(focused.quaternion, 'YXZ');
    close(orientation.x, -Math.PI / 4); close(orientation.z, 0); close(camera.fov, original.fov);
    assert.ok(camera.position.y >= ground + MAP_CAMERA_GROUND_HEIGHT - 1e-7, 'The focused camera clears its ground floor');
    for (const corner of corners(bounds)) {
      const projected = corner.project(camera), x = (projected.x + 1) / 2, y = (1 - projected.y) / 2;
      assert.ok(x >= viewport.left + viewport.width * .08 - 1e-7 && x <= viewport.left + viewport.width * .92 + 1e-7, 'Every side fits beside the card');
      assert.ok(y >= viewport.top + viewport.height * .08 - 1e-7 && y <= viewport.top + viewport.height * .92 + 1e-7, 'Every roof and base fits above the sheet');
      assert.ok(projected.z >= -1 - 1e-7 && projected.z <= 1 + 1e-7, 'No corner crosses the near/far clipping planes');
    }
    const projectedCenter = center(bounds).project(camera);
    close((projectedCenter.x + 1) / 2, viewport.left + viewport.width / 2);
    close((1 - projectedCenter.y) / 2, viewport.top + viewport.height / 2);
    const approach = mapObjectApproach(camera, bounds, viewport);
    assert.equal(approach.expanded, true, 'Selecting the fitted object also expands that destination');
    close(approach.alignment, 0, 3e-8);
  }
});

test('manual approach uses fitted object size, FOV and exposed space, with only a small boundary tolerance', () => {
  const bounds = { min: [-30, 0, -10], max: [30, 20, 10] };
  for (const aspect of [1.5, .46]) for (const fov of [30, 43, 60]) for (const viewport of [FULL_MAP_VIEWPORT, { left: .3, top: .05, width: .7, height: .5 }]) {
    const pose = mapObjectFocusPose(poseAt(.7, fov), center(bounds), bounds, aspect, viewport), camera = cameraAt(pose, aspect);
    const radius = camera.position.distanceTo(center(bounds)), direction = camera.position.clone().sub(center(bounds)).normalize();
    for (const [factor, expanded] of [[1, true], [1.03, true], [1.05, false], [.7, true]]) {
      camera.position.copy(center(bounds)).addScaledVector(direction, radius * factor);
      const approach = mapObjectApproach(camera, bounds, viewport);
      close(approach.distance, radius * factor); assert.equal(approach.expanded, expanded);
    }
  }
  const distance = (bounds, fov = 43, viewport = FULL_MAP_VIEWPORT) => mapObjectFocusPose(poseAt(0, fov), center(bounds), bounds, 1.5, viewport).position.distanceTo(center(bounds));
  assert.ok(distance({ min: [-60, 0, -20], max: [60, 40, 20] }) > distance(bounds) * 1.9, 'A large building expands from proportionally farther away');
  assert.ok(distance(bounds, 30) > distance(bounds, 60), 'A narrower lens needs a farther approach');
  assert.ok(distance(bounds, 43, { left: 0, top: 0, width: .45, height: 1 }) > distance(bounds), 'A covering panel changes the fitting distance');
});

test('the visible centre ray ranks facing destinations before closer side neighbours and rejects the rear', () => {
  const camera = new PerspectiveCamera(43, 1.5, .5, 4000);
  camera.position.set(0, 12, 50); camera.lookAt(0, 12, 0); camera.updateMatrixWorld();
  const forward = { min: [-10, 0, -10], max: [10, 24, 10] }, side = { min: [15, 0, 15], max: [35, 24, 35] };
  const facing = mapObjectApproach(camera, forward), nearer = mapObjectApproach(camera, side);
  assert.ok(facing.distance > nearer.distance); assert.ok(facing.alignment < nearer.alignment);
  const viewport = { left: .8, top: 0, width: .2, height: 1 };
  assert.ok(mapObjectApproach(camera, side, viewport).alignment < mapObjectApproach(camera, forward, viewport).alignment, 'A side card shifts the real viewing centre');
  camera.lookAt(0, 12, 100); camera.updateMatrixWorld();
  assert.equal(mapObjectApproach(camera, forward).expanded, false);
  const generic = new Camera(); generic.position.copy(camera.position); generic.quaternion.copy(camera.quaternion);
  assert.ok(Number.isFinite(mapObjectApproach(generic, forward).distance));
  assert.ok(Number.isFinite(mapObjectApproach(generic, forward).alignment));
  assert.equal(mapObjectApproach(generic, forward).expanded, false);
});

test('photo selection retains its fixed 40 metre approach while object focus uses the actual extent', () => {
  const pose = poseAt(.4), point = new Vector3(0, 10, 0);
  close(photoMapFocusPose(pose, point, 1.5, FULL_MAP_VIEWPORT).position.distanceTo(point), 40);
  const focused = mapObjectFocusPose(pose, point, { min: [-60, 0, -20], max: [60, 20, 20] }, 1.5);
  assert.ok(focused.position.distanceTo(point) > 100);
});

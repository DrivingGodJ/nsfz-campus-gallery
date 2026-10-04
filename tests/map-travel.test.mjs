import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bindMapTravelControls, mapGroundViewDistance, mapTravelStep, travelAlongView } from '../src/map-travel-controls.ts';

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ~= ${b}`);
const fixture = () => {
  const camera = new THREE.PerspectiveCamera(43, 1.5, .5, 4000), target = new THREE.Vector3();
  camera.position.set(-240, 340, -380); camera.lookAt(target); camera.updateMatrixWorld();
  return { camera, target };
};

test('forward travel crosses the original target, stays unbounded and preserves the orbit offset, direction and lens', () => {
  const { camera, target } = fixture(), start = camera.position.clone(), direction = camera.getWorldDirection(new THREE.Vector3());
  const offset = camera.position.clone().sub(target), quaternion = camera.quaternion.clone();
  let travelled = 0;
  for (let n = 0; n < 180; n++) {
    const distance = mapTravelStep(camera);
    assert.ok(distance >= 2, 'Travel must never slow to a stop at the ground');
    travelled += distance; travelAlongView(camera, target, distance);
  }
  assert.ok(travelled > 1400, 'Travel is not restricted by the old maximum orbit radius');
  assert.ok(camera.position.clone().sub(start).dot(direction) > offset.length(), 'Camera passes its former focal point');
  close(camera.position.clone().sub(target).distanceTo(offset), 0);
  close(camera.quaternion.angleTo(quaternion), 0, 1e-7); assert.equal(camera.fov, 43);
  travelAlongView(camera, target, -travelled);
  close(camera.position.distanceTo(start), 0); close(target.length(), 0);
});

test('forward travel follows a new heading and near-ground markers use actual view distance instead of orbit radius', () => {
  const { camera, target } = fixture();
  assert.ok(mapGroundViewDistance(camera) > 360);
  travelAlongView(camera, target, 400);
  assert.ok(mapGroundViewDistance(camera) < 360);
  camera.position.set(0, 0, 0); target.set(1, 0, 0); camera.lookAt(target);
  assert.equal(mapTravelStep(camera), 2);
  travelAlongView(camera, target, 10);
  close(camera.position.distanceTo(new THREE.Vector3(10, 0, 0)), 0);
  close(target.distanceTo(new THREE.Vector3(11, 0, 0)), 0);
  const before = camera.position.clone();
  for (const value of [NaN, Infinity, -Infinity, 0]) travelAlongView(camera, target, value);
  close(camera.position.distanceTo(before), 0);
});

const canvasFixture = () => {
  const canvas = new EventTarget(), captures = new Set();
  Object.assign(canvas, { clientHeight: 600, setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) });
  return canvas;
};
const dispatch = (canvas, type, values) => {
  const event = new Event(type, { cancelable: true }); Object.assign(event, values); canvas.dispatchEvent(event); return event;
};
const pointer = (canvas, type, values = {}) => dispatch(canvas, type, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100, ...values });

test('wheel uses continuous deltas across mouse, trackpad and line/page units, and bindings respect fixed photo views', () => {
  const canvas = canvasFixture(), steps = [];
  let enabled = true;
  const dispose = bindMapTravelControls(canvas, { enabled: () => enabled, travel: value => steps.push(value) });
  for (const [deltaY, deltaMode, expected] of [[-100, 0, 1], [8, 0, -.08], [-1, 1, .16], [1, 2, -6]]) {
    assert.equal(dispatch(canvas, 'wheel', { deltaY, deltaMode }).defaultPrevented, true);
    close(steps.at(-1), expected);
  }
  dispatch(canvas, 'wheel', { deltaY: -20, deltaMode: 0, ctrlKey: true }); close(steps.at(-1), .2);
  enabled = false;
  assert.equal(dispatch(canvas, 'wheel', { deltaY: -100, deltaMode: 0 }).defaultPrevented, false);
  assert.equal(steps.length, 5);
  enabled = true; dispose();
  dispatch(canvas, 'wheel', { deltaY: -100, deltaMode: 0 }); assert.equal(steps.length, 5, 'Unmount removes wheel listeners');
});

test('touch pinch and middle drag advance immediately, single-finger rotation is untouched, and cancellation resets gesture state', () => {
  const canvas = canvasFixture(), steps = [];
  let enabled = true;
  const dispose = bindMapTravelControls(canvas, { enabled: () => enabled, travel: value => steps.push(value) });
  pointer(canvas, 'pointerdown');
  assert.equal(pointer(canvas, 'pointermove', { clientX: 90 }).defaultPrevented, false);
  assert.equal(steps.length, 0);
  pointer(canvas, 'pointerdown', { pointerId: 2, clientX: 190 });
  assert.equal(pointer(canvas, 'pointermove', { pointerId: 2, clientX: 210 }).defaultPrevented, true);
  close(steps[0], 5 * Math.log(1.2));
  enabled = false;
  pointer(canvas, 'pointermove', { pointerId: 2, clientX: 230 }); assert.equal(steps.length, 1);
  pointer(canvas, 'pointercancel', { pointerId: 2 }); pointer(canvas, 'pointerup');
  enabled = true;
  pointer(canvas, 'pointerdown', { pointerType: 'mouse', button: 1 });
  pointer(canvas, 'pointermove', { pointerType: 'mouse', clientY: 160 }); close(steps[1], .6);
  pointer(canvas, 'pointerup', { pointerType: 'mouse' }); assert.equal(canvas.hasPointerCapture(1), false);
  pointer(canvas, 'pointerdown', { pointerId: 3 }); pointer(canvas, 'pointerdown', { pointerId: 4, clientX: 190 });
  dispose(); assert.equal(canvas.hasPointerCapture(3), false); assert.equal(canvas.hasPointerCapture(4), false);
  pointer(canvas, 'pointermove', { pointerId: 4, clientX: 300 }); assert.equal(steps.length, 2, 'Unmount removes touch listeners');
});

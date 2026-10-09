import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bindMapTravelControls, mapGroundViewDistance, mapTravelStep, panMapView, retargetMapPan, travelAlongView } from '../src/map-travel-controls.ts';
import { OrbitControls } from 'three-stdlib';

const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ~= ${b}`);
const fixture = () => {
  const camera = new THREE.PerspectiveCamera(43, 1.5, .5, 4000), target = new THREE.Vector3();
  camera.position.set(-240, 340, -380); camera.lookAt(target); camera.updateMatrixWorld();
  return { camera, target };
};

test('forward travel slides above ground, stays unbounded and preserves direction, lens and orbit offset', () => {
  const { camera, target } = fixture(), start = camera.position.clone();
  const offset = camera.position.clone().sub(target), quaternion = camera.quaternion.clone();
  for (let n = 0; n < 180; n++) {
    const distance = mapTravelStep(camera);
    assert.ok(distance >= 2);
    travelAlongView(camera, target, distance);
    assert.ok(camera.position.y >= 1.6, 'Every forward step stays above the surface');
  }
  close(camera.position.y, 1.6);
  const grounded = camera.position.clone();
  travelAlongView(camera, target, 20000);
  assert.ok(Math.hypot(camera.position.x - grounded.x, camera.position.z - grounded.z) > 10000, 'Ground clearance does not introduce a horizontal distance limit');
  close(camera.position.y, 1.6);
  close(camera.position.clone().sub(target).distanceTo(offset), 0);
  close(camera.quaternion.angleTo(quaternion), 0, 1e-7); assert.equal(camera.fov, 43);
  travelAlongView(camera, target, -100);
  assert.ok(camera.position.y > 1.6, 'Backward travel can leave the ground');
  assert.ok(camera.position.distanceTo(start) > 10000);
});

test('forward travel follows a new heading and near-ground markers use actual view distance instead of orbit radius', () => {
  const { camera, target } = fixture();
  assert.ok(mapGroundViewDistance(camera) > 360);
  travelAlongView(camera, target, 400);
  assert.ok(mapGroundViewDistance(camera) < 360);
  camera.position.set(0, 1.6, 0); target.set(1, 1.6, 0); camera.lookAt(target);
  assert.equal(mapTravelStep(camera), 2);
  travelAlongView(camera, target, 10);
  close(camera.position.distanceTo(new THREE.Vector3(10, 1.6, 0)), 0);
  close(target.distanceTo(new THREE.Vector3(11, 1.6, 0)), 0);
  const before = camera.position.clone();
  for (const value of [NaN, Infinity, -Infinity, 0]) travelAlongView(camera, target, value);
  close(camera.position.distanceTo(before), 0);
});

test('basement travel and panning scales match the same view above ground', () => {
  const { camera, target } = fixture(), ground = -3.8;
  const step = mapTravelStep(camera), distance = mapGroundViewDistance(camera);
  const panDepth = retargetMapPan(camera, target), gaze = camera.quaternion.clone();
  camera.position.y += ground; target.y += ground; camera.updateMatrixWorld();
  close(mapTravelStep(camera, ground), step);
  close(mapGroundViewDistance(camera, ground), distance);
  close(retargetMapPan(camera, target, undefined, ground), panDepth);
  close(camera.quaternion.angleTo(gaze), 0, 1e-7);
  camera.position.set(0, ground + 1.6, 0); camera.lookAt(new THREE.Vector3(0, ground + 1.6, -100));
  const horizonDepth = retargetMapPan(camera, target, undefined, ground);
  close(horizonDepth, 16);
  assert.equal(mapTravelStep(camera, ground), 2);
});

test('pan speed is independent of a stale tiny or distant target and retargeting does not move the view', () => {
  for (const viewport of [{left:0,top:0,width:1,height:1},{left:.4,top:0,width:.6,height:1},{left:0,top:0,width:1,height:.35}]) {
    let expected;
    for (const oldDistance of [.0001,1,20,4000]) {
      const {camera,target} = fixture(), position = camera.position.clone(), orientation = camera.quaternion.clone();
      const controls = new OrbitControls(camera);
      controls.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()),oldDistance);
      const distance = retargetMapPan(camera,controls.target,viewport);
      assert.ok(distance>100,'The scene depth replaces the tiny synthetic orbit distance');
      close(camera.position.distanceTo(position),0);
      close(camera.quaternion.angleTo(orientation),0,1e-7);
      controls.update();
      close(camera.position.distanceTo(position),0);
      close(camera.quaternion.angleTo(orientation),0,1e-7);
      panMapView(camera,controls.target,30,0,600); controls.update();
      const movement = camera.position.clone().sub(position);
      assert.ok(movement.length()>10,'The first pan already moves at the scene scale');
      if (expected) close(movement.distanceTo(expected),0);
      else expected=movement;
      controls.dispose();
    }
  }
});

test('pan distance remains finite near the horizon or looking at the sky, including eye level', () => {
  for (const gaze of [[0,1.6,-100],[0,1.6-1e-5,-100],[0,50,-100]]) {
    const {camera,target} = fixture(); camera.position.set(0,1.6,0); camera.lookAt(new THREE.Vector3(...gaze));
    const orientation=camera.quaternion.clone(), distance=retargetMapPan(camera,target);
    assert.ok(distance>=2 && distance<=camera.far);
    assert.ok(target.toArray().every(Number.isFinite));
    close(camera.quaternion.angleTo(orientation),0,1e-7);
  }
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

test('right-button and modified-left pan refresh their distance before the native controls handle a drag', () => {
  const canvas=canvasFixture(); let starts=0, enabled=true;
  const dispose=bindMapTravelControls(canvas,{enabled:()=>enabled,travel:()=>{},panStart:()=>starts++});
  for (const values of [{button:2},{button:0,shiftKey:true},{button:0,ctrlKey:true},{button:0,metaKey:true}]) {
    pointer(canvas,'pointerdown',{pointerType:'mouse',...values});
  }
  assert.equal(starts,4);
  for (const values of [{button:0},{button:1},{button:2,shiftKey:true},{pointerType:'touch',button:2}]) {
    pointer(canvas,'pointerdown',{pointerType:'mouse',...values});
    pointer(canvas,'pointerup',{pointerType:'mouse'});
  }
  assert.equal(starts,4,'Rotation, travel and touch do not also start mouse panning');
  enabled=false; pointer(canvas,'pointerdown',{pointerType:'mouse',button:2}); assert.equal(starts,4);
  dispose(); enabled=true; pointer(canvas,'pointerdown',{pointerType:'mouse',button:2}); assert.equal(starts,4);
});

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

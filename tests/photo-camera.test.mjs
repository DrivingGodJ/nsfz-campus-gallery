import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { createRoot } from '@react-three/fiber';
import { photoCameraPose, PhotoCameraTransition, readCameraPose } from '../src/photo-camera.ts';
import { photoFrameSize, photoPerspectiveIssue } from '../src/photo-perspective.ts';
import { directionVector, photoFieldOfView } from '../src/photo-view.ts';
import { photoMapHeight } from '../src/locations.ts';
import { bindPhotoLookControls } from '../src/photo-look-controls.ts';
import { mapTravelStep } from '../src/map-travel-controls.ts';
import { mapGroundOrbitTarget } from '../src/map-orbit.ts';
import { mapLocationTarget } from '../src/location-geometry.ts';
import { FULL_MAP_VIEWPORT } from '../src/map-card-viewport.ts';

const photo = { id: 'preview-fixture', title: '校园视角', captureType: 'ground', floor: 1, buildingId: '', placed: true,
  position: { x: 10, z: -25 }, heading: 125, pitch: -18, width: 6000, height: 4000, metadata: { focalLength35Mm: 35 },
  files: { thumbnail: 'test.webp', display: 'test.webp', download: 'test.jpg' }, description: '', capturedAt: '', downloadBytes: 10 };
const close = (a, b, epsilon = 1e-8) => assert.ok(Math.abs(a - b) < epsilon, `${a} ~= ${b}`);
const vectorClose = (a, b) => a.toArray().forEach((n, i) => close(n, b.toArray()[i]));
const cameraAtPose = (pose, aspect = 1.5) => {
  const camera = new THREE.PerspectiveCamera(pose.fov, aspect, pose.near, 2000);
  camera.position.copy(pose.position); camera.quaternion.copy(pose.quaternion); camera.updateMatrixWorld();
  return camera;
};
const overview = () => {
  const camera = new THREE.PerspectiveCamera(43, 1.5, .5, 2000), target = new THREE.Vector3(15, 0, 30);
  camera.position.set(-240, 340, -380); camera.lookAt(target); camera.updateMatrixWorld();
  return { camera, target };
};
const finish = (motion, camera, target) => { for (let n = 0; n < 60; n++) motion.tick(camera, target, 1 / 60); };
const testCanvas = () => {
  const canvas = new EventTarget(), attributes = new Map(), captured = new Set();
  Object.assign(canvas, { width: 900, height: 600, clientWidth: 900, clientHeight: 600, style: {}, ownerDocument: new EventTarget(), tabIndex: -1,
    getAttribute: name => attributes.get(name) ?? null, setAttribute: (name, value) => attributes.set(name, value), removeAttribute: name => attributes.delete(name),
    focus() {}, setPointerCapture: id => captured.add(id), hasPointerCapture: id => captured.has(id), releasePointerCapture: id => captured.delete(id) });
  return canvas;
};
const pointerEvent = (canvas, type, values = {}) => {
  const event = new Event(type, { cancelable: true });
  Object.assign(event, { pointerId: 1, button: 0, isPrimary: true, clientX: 100, clientY: 100, pointerType: 'mouse', ...values });
  canvas.dispatchEvent(event); return event;
};
const wheelEvent = (canvas, deltaY) => {
  const event = new Event('wheel', { cancelable: true }); Object.assign(event, { deltaY, deltaMode: 0 }); canvas.dispatchEvent(event); return event;
};

test('photo camera centres its true shooting ray in the exposed canvas and restores projection smoothly', () => {
  for (const viewport of [{ left: 0, top: 0, width: 1, height: .35 }, { left: 0, top: 0, width: .55, height: 1 }]) {
    const { camera, target } = overview(), original = readCameraPose(camera, target), motion = new PhotoCameraTransition();
    const pose = photoCameraPose(photo, 9, camera.aspect, viewport);
    motion.enter(camera, target, pose);
    close(camera.fov, original.fov); assert.equal(camera.view?.enabled || false, false);
    motion.tick(camera, target, .05);
    assert.ok(camera.view.enabled && camera.view.offsetX / camera.view.fullWidth >= 0 && camera.view.offsetY / camera.view.fullHeight >= 0);
    finish(motion, camera, target);
    const rayPoint = new THREE.Vector3(...directionVector(photo.heading, photo.pitch)).multiplyScalar(20).add(camera.position).project(camera);
    close(rayPoint.x, 2 * (viewport.left + viewport.width / 2) - 1);
    close(rayPoint.y, 1 - 2 * (viewport.top + viewport.height / 2));
    motion.leave(camera, target); assert.equal(camera.view.enabled, true, 'The return starts from the current projection');
    finish(motion, camera, target);
    vectorClose(camera.position, original.position); close(camera.quaternion.angleTo(original.quaternion), 0, 1e-7);
    close(camera.fov, original.fov); assert.equal(camera.view.enabled, false);
  }
});

test('real map gestures anchor all ground, turn in place toward the sky, prefer visible selections and release offscreen selections', async () => {
  const environment = await testServer(), previousWindow = globalThis.window, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const canvas = testCanvas();
  const gl = { domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, shadowMap: {}, xr: { addEventListener() {}, removeEventListener() {} } };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    const { default: Rig } = await environment.server.ssrLoadModule('/src/MapCameraRig.tsx');
    globalThis.window = { devicePixelRatio: 1, navigator: globalThis.navigator, matchMedia: () => ({ matches: false }) };
    root = createRoot(canvas);
    await root.configure({ gl, size: { width: 900, height: 600, top: 0, left: 0 }, frameloop: 'never', camera: { position: [-240, 340, -380], fov: 43, near: .5, far: 2000 } });
    const props = { command: { type: 'initial', sequence: 0 }, selected: null, preview: null, onCompact() {}, onAzimuth() {}, onMoving() {} };
    let store;
    const render = async additions => { await act(async () => { store = root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, ...additions }))); }); };
    await render({});
    const state = store.getState(), camera = state.camera, control = state.controls;
    let timeline = 0;
    const advance = async () => { await act(async () => { for (let n = 0; n < 120; n++) state.advance(timeline += 1 / 60, false); }); };
    const down = () => pointerEvent(canvas, 'pointerdown', { pointerType: 'touch', pageX: 100, pageY: 100 });
    const move = (x = 140, y = 100) => {
      const values = { pointerType: 'touch', clientX: x, clientY: y, pageX: x, pageY: y };
      pointerEvent(canvas, 'pointermove', values); pointerEvent(canvas.ownerDocument, 'pointermove', values);
    };
    const up = () => { pointerEvent(canvas, 'pointerup', { pointerType: 'touch' }); pointerEvent(canvas.ownerDocument, 'pointerup', { pointerType: 'touch' }); };

    const panPose = readCameraPose(camera,control.target);
    let panMovement;
    for (const oldDistance of [.0001,1,4000]) {
      camera.position.copy(panPose.position); camera.quaternion.copy(panPose.quaternion);
      control.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()),oldDistance);
      const panPosition = camera.position.clone();
      pointerEvent(canvas,'pointerdown',{button:2,pageX:100,pageY:100});
      vectorClose(camera.position,panPosition); close(camera.quaternion.angleTo(panPose.quaternion),0,1e-7);
      const pan={button:2,clientX:160,clientY:100,pageX:160,pageY:100};
      pointerEvent(canvas,'pointermove',pan); pointerEvent(canvas.ownerDocument,'pointermove',pan);
      pointerEvent(canvas,'pointerup',{button:2}); pointerEvent(canvas.ownerDocument,'pointerup',{button:2});
      await advance();
      const movement=camera.position.clone().sub(panPosition);
      assert.ok(movement.length()>10,'A real right-button drag moves immediately even with a tiny stale target');
      if(panMovement) vectorClose(movement,panMovement); else panMovement=movement;
    }
    camera.position.copy(panPose.position); camera.quaternion.copy(panPose.quaternion); control.target.copy(panPose.target); control.update();
    wheelEvent(canvas, -100); wheelEvent(canvas, -100); wheelEvent(canvas, -100);
    let position = camera.position.clone(), quaternion = camera.quaternion.clone();
    const ground = mapGroundOrbitTarget(camera), radius = position.distanceTo(ground);
    assert.ok(control.target.distanceTo(ground) > 1, 'Forward travel has moved the old orbit target');
    down(); vectorClose(camera.position, position); close(camera.quaternion.angleTo(quaternion), 0, 1e-7);
    vectorClose(control.target, ground);
    move(); up(); await advance(); vectorClose(control.target, ground); close(camera.position.distanceTo(ground), radius);
    assert.ok(camera.position.distanceTo(position) > 1, 'Single-finger drag orbits the new ground point');

    camera.position.set(450, 60, 300); control.target.set(600, 0, 300); camera.lookAt(control.target); control.update();
    position = camera.position.clone(); quaternion = camera.quaternion.clone();
    const outsideGround=mapGroundOrbitTarget(camera), outsideRadius=position.distanceTo(outsideGround);
    down(); move(); up(); await advance();
    assert.ok(camera.position.distanceTo(position)>1,'Campus-exterior ground also supports orbit');
    close(camera.position.distanceTo(outsideGround),outsideRadius);

    camera.position.set(450,60,300); control.target.set(600,90,300); camera.lookAt(control.target); control.update();
    position=camera.position.clone(); quaternion=camera.quaternion.clone();
    assert.equal(mapGroundOrbitTarget(camera), null);
    down(); vectorClose(camera.position, position); close(camera.quaternion.angleTo(quaternion), 0, 1e-7);
    move(160, 220); vectorClose(camera.position, position);
    assert.ok(camera.quaternion.angleTo(quaternion) > .05, 'Look responds before a render frame');
    up(); await advance(); vectorClose(camera.position, position);

    const building = [25, 15, -20];
    await render({ selectedObjectTarget: building }); await advance();
    const pivot = new THREE.Vector3(...building), buildingRadius = camera.position.distanceTo(pivot);
    vectorClose(control.target, pivot); position = camera.position.clone(); quaternion = camera.quaternion.clone();
    down(); vectorClose(camera.position, position); close(camera.quaternion.angleTo(quaternion), 0, 1e-7);
    move(); up(); await advance(); close(camera.position.distanceTo(pivot), buildingRadius);
    assert.ok(camera.position.distanceTo(position) > 1, 'Visible building overrides the ground pivot');

    // The building remains selected, but is now behind a camera looking away.
    camera.position.set(0, 60, 100); control.target.set(0, 0, 200); camera.lookAt(control.target); control.update();
    const fallbackGround = mapGroundOrbitTarget(camera);
    down(); vectorClose(control.target, fallbackGround); move(); up(); await advance();
    vectorClose(control.target, fallbackGround);
    assert.ok(control.target.distanceTo(pivot) > 1, 'Offscreen selection does not capture the next orbit');

    const selected = { ...photo, position: { ...photo.position, height: 9 } };
    await render({ selected, selectedObjectTarget: building }); await advance();
    const photoPivot = new THREE.Vector3(10, 9, -25), photoRadius = camera.position.distanceTo(photoPivot);
    vectorClose(control.target, photoPivot);
    down(); move(); up(); await advance(); close(camera.position.distanceTo(photoPivot), photoRadius);
    assert.ok(Math.abs(control.target.y - 9) < 1e-7, 'Selected photo location overrides its building and the ground');
    camera.position.set(450, 60, 300); control.target.set(600, 0, 300); camera.lookAt(control.target); control.update();
    const offscreenGround=mapGroundOrbitTarget(camera), offscreenRadius=camera.position.distanceTo(offscreenGround);
    position = camera.position.clone(); down(); move(); up(); await advance();
    assert.ok(camera.position.distanceTo(position)>1); close(camera.position.distanceTo(offscreenGround),offscreenRadius);
    assert.equal(control.enableRotate, true, 'Ending an outside-ground gesture restores other gestures');
    await render({});
    assert.equal(canvas.hasPointerCapture(1), false);

    const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
    const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
    for (const id of ['way/855459420', 'way/855459418', 'way/855459407', 'way/855459417', 'local/specimen-forest', 'local/underground-corridor', 'local/underpass']) {
      const focus = mapLocationTarget(campus, site, id), yaw = camera.rotation.clone().reorder('YXZ').y, fov = camera.fov;
      position = camera.position.clone();
      await render({ selectedObjectTarget: focus.target, selectedObjectBounds: focus.bounds });
      vectorClose(camera.position, position); // Selection starts a journey rather than teleporting.
      await advance();
      vectorClose(control.target, new THREE.Vector3(...focus.target));
      close(camera.position.distanceTo(control.target), 40);
      close(camera.rotation.clone().reorder('YXZ').x, -Math.PI / 4);
      close(camera.rotation.clone().reorder('YXZ').y, yaw);
      const projected = new THREE.Vector3(...focus.target).project(camera);
      close(projected.x, 0); close(projected.y, 0); assert.equal(camera.fov, fov);
      down(); move(); up(); await advance();
      close(camera.position.distanceTo(new THREE.Vector3(...focus.target)), 40);
    }
  } finally {
    await act(async () => { root?.unmount(); });
    await environment.close(); globalThis.window = previousWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});

test('pointer and touch look controls respond immediately, capture one pointer, clamp pitch and clean up after cancel or exit', () => {
  const canvas = testCanvas(), commits = [];
  let angles = { heading: 2, pitch: 88 }, updates = 0;
  const dispose = bindPhotoLookControls(canvas, { angles: () => angles, degreesPerPixel: () => .1, start() {},
    look: next => { angles = next; updates++; }, commit: next => commits.push(next) });
  assert.equal(canvas.tabIndex, 0);
  pointerEvent(canvas, 'pointerdown', { pointerType: 'touch' });
  pointerEvent(canvas, 'pointerdown', { pointerId: 2, isPrimary: false, pointerType: 'touch' });
  pointerEvent(canvas, 'pointermove', { pointerId: 2, clientX: 150, clientY: 200 });
  assert.equal(updates, 0, 'A second touch cannot fight the active drag');
  assert.equal(pointerEvent(canvas, 'pointermove', { clientX: 150, clientY: 200, pointerType: 'touch' }).defaultPrevented, true);
  assert.deepEqual(angles, { heading: 357, pitch: 90 });
  assert.equal(updates, 1, 'The angles change in the pointer event without waiting for a timer or animation frame');
  assert.equal(commits.length, 0, 'Draft persistence stays outside the movement events');
  pointerEvent(canvas, 'pointercancel', { pointerType: 'touch' });
  assert.equal(canvas.hasPointerCapture(1), false); assert.equal(commits.length, 1);
  const key = new Event('keydown', { cancelable: true }); Object.assign(key, { key: 'ArrowRight', shiftKey: true }); canvas.dispatchEvent(key);
  assert.deepEqual(angles, { heading: 2, pitch: 90 }); assert.equal(commits.length, 2);
  dispose(); assert.equal(canvas.tabIndex, -1); assert.equal(canvas.getAttribute('aria-label'), null);
  pointerEvent(canvas, 'pointerdown'); pointerEvent(canvas, 'pointermove', { clientX: 400 });
  assert.deepEqual(angles, { heading: 2, pitch: 90 }, 'Exiting preview removes its drag listeners');
});

test('the first desktop drag takes over immediately after closing a photo or leaving its preview', async () => {
  const environment = await testServer(), previousWindow = globalThis.window, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const canvas = testCanvas();
  const gl = { domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, shadowMap: {}, xr: { addEventListener() {}, removeEventListener() {} } };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    const { default: Rig } = await environment.server.ssrLoadModule('/src/MapCameraRig.tsx');
    globalThis.window = { devicePixelRatio: 1, navigator: globalThis.navigator, matchMedia: () => ({ matches: false }) };
    root = createRoot(canvas);
    await root.configure({ gl, size: { width: 900, height: 600, top: 0, left: 0 }, frameloop: 'never', camera: { position: [-240, 340, -380], fov: 43, near: .5, far: 2000 } });
    const moves = [];
    const props = { command: { type: 'initial', sequence: 0 }, boundary: [[-500, -500], [500, -500], [500, 500], [-500, 500]], selected: null, preview: null, onCompact() {}, onAzimuth() {}, onMoving: value => moves.push(value) };
    let store, timeline = 0;
    const render = async additions => { await act(async () => { store = root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, ...additions }))); }); };
    await render({});
    const state = store.getState(), camera = state.camera, control = state.controls;
    const advance = async () => { await act(async () => { for (let n = 0; n < 120; n++) state.advance(timeline += 1 / 60, false); }); };
    const drag = () => {
      const before = camera.quaternion.clone();
      pointerEvent(canvas, 'pointerdown');
      assert.equal(control.enabled, true, 'The first pointerdown enables map gestures');
      pointerEvent(canvas, 'pointermove', { clientX: 170, clientY: 120 });
      assert.ok(camera.quaternion.angleTo(before) > .02, 'The first drag moves before another render frame');
      pointerEvent(canvas, 'pointerup'); pointerEvent(canvas.ownerDocument, 'pointerup');
    };
    const selected = { ...photo, position: { ...photo.position, height: 9 } };
    await render({ selected });
    assert.equal(control.enabled, false, 'Photo centering is still animating');
    await render({}); drag(); await advance();
    assert.equal(canvas.hasPointerCapture(1), false);

    await render({ selected }); await advance();
    const fov = camera.fov, near = camera.near;
    await render({ selected, preview: selected, visibleViewport: { left: 0, top: 0, width: .55, height: 1 } }); await advance();
    assert.equal(control.enabled, false); assert.equal(camera.view.enabled, true);
    await render({});
    assert.equal(control.enabled, false, 'The return animation has just started');
    drag();
    assert.equal(moves.at(-1), false, 'Map UI resumes with the gesture');
    const manualPosition = camera.position.clone(), manualOrientation = camera.quaternion.clone();
    await advance();
    vectorClose(camera.position, manualPosition); close(camera.quaternion.angleTo(manualOrientation), 0, 1e-7);
    close(camera.fov, fov); close(camera.near, near); assert.equal(camera.view.enabled, false, 'The map lens completes its restoration independently');
    assert.equal(control.enabled, true);
  } finally {
    await act(async () => { root?.unmount(); });
    await environment.close(); globalThis.window = previousWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
  }
});

test('interrupting a return preserves the current pose while the lens fades back, including rapid re-entry', () => {
  const { camera, target } = overview(), original = readCameraPose(camera, target), motion = new PhotoCameraTransition();
  const pose = photoCameraPose(photo, 9, camera.aspect, { left: 0, top: 0, width: .55, height: 1 });
  motion.enter(camera, target, pose); finish(motion, camera, target);
  assert.equal(motion.cancelReturn(camera, target), false, 'An active preview remains fixed');
  motion.leave(camera, target); motion.tick(camera, target, .1);
  const before = readCameraPose(camera, target);
  assert.equal(motion.cancelReturn(camera, target), true);
  assert.equal(motion.moving, false); assert.equal(motion.photoTransition, false);
  vectorClose(camera.position, before.position); close(camera.fov, before.fov);
  camera.position.add(new THREE.Vector3(3, 2, 1)); target.add(new THREE.Vector3(3, 2, 1));
  const moved = camera.position.clone();
  motion.tick(camera, target, .1); vectorClose(camera.position, moved);
  assert.ok(camera.fov !== before.fov && camera.fov !== original.fov, 'Projection restoration is gradual');
  motion.enter(camera, target, pose); finish(motion, camera, target);
  motion.leave(camera, target); finish(motion, camera, target);
  vectorClose(camera.position, moved); close(camera.fov, original.fov); close(camera.near, original.near);
  assert.equal(camera.view.enabled, false);
});

test('photo camera uses the exact shooting position and faces the saved compass heading and pitch, including vertical shots', () => {
  for (const heading of [0, 90, 180, 270, 359]) for (const pitch of [-90, -45, 0, 35, 90]) {
    const p = { ...photo, heading, pitch }, pose = photoCameraPose(p, 75, 1.5), camera = cameraAtPose(pose);
    vectorClose(camera.position, new THREE.Vector3(10, 75, -25));
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(...directionVector(heading, pitch)));
    close(camera.getWorldDirection(new THREE.Vector3()).length(), 1);
    assert.ok(camera.quaternion.toArray().every(Number.isFinite));
  }
});

test('composition stays identical within the photo frame on portrait, landscape and narrow map panels', () => {
  for (const imageAspect of [1.5, 2 / 3, 16 / 9]) for (const canvasAspect of [.4, .886, 1.5, 3]) {
    const p = { ...photo, width: 6000 * imageAspect, height: 6000 }, pose = photoCameraPose(p, 1.6, canvasAspect);
    const camera = cameraAtPose(pose, canvasAspect), view = photoFieldOfView(p), frame = photoFrameSize(imageAspect, canvasAspect);
    const edge = (x, y) => new THREE.Vector3(x, y, -1).normalize().applyQuaternion(pose.quaternion).multiplyScalar(100).add(pose.position).project(camera);
    const right = edge(Math.tan(view.horizontal * Math.PI / 360), 0), top = edge(0, Math.tan(view.vertical * Math.PI / 360));
    close(right.x, frame.width); close(top.y, frame.height);
    close(frame.width * canvasAspect / frame.height, imageAspect);
  }
});

test('preview derives ordinary floor and named surface height without requiring a saved ordinary altitude', async () => {
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url))), site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
  const building = campus.buildings.find(b => b.facade?.type === 'dormitory');
  const p = { ...photo, buildingId: building.id, floor: 3, position: { ...photo.position, height: 999 } };
  const floorHeight = site.buildingOverrides[building.id]?.floorHeight || building.floorHeight || 3.6;
  close(photoMapHeight(p, campus, site), 2 * floorHeight + 1.6);
  vectorClose(photoCameraPose(p, photoMapHeight(p, campus, site), 1.5).position, new THREE.Vector3(10, 2 * floorHeight + 1.6, -25));
  const bridge = campus.features.find(f => f.type === 'bridge' && !f.archRise && f.deckHeight > 0);
  assert.ok(bridge);
  const outside = { ...photo, locationId: bridge.id };
  close(photoMapHeight(outside, campus, site), bridge.deckHeight + 1.6);
  const aerial = { ...photo, captureType: 'aerial', altitude: { reference: 'takeoff', meters: 80 } };
  close(photoMapHeight(aerial, campus, site), 80);
});

test('missing locations or only sea-level altitude cannot open a misleading perspective; absent focal length still permits a clear default', () => {
  assert.equal(photoPerspectiveIssue(photo), '');
  assert.match(photoPerspectiveIssue({ ...photo, placed: false }), /标记拍摄位置/);
  assert.match(photoPerspectiveIssue({ ...photo, heading: NaN }), /镜头方向/);
  for (const altitude of [undefined, { reference: 'seaLevel', meters: 100 }, { reference: 'takeoff', meters: NaN }]) {
    assert.match(photoPerspectiveIssue({ ...photo, captureType: 'aerial', altitude }), /相对起飞点/);
  }
  assert.equal(photoPerspectiveIssue({ ...photo, captureType: 'aerial', altitude: { reference: 'takeoff', meters: 0 } }), '');
  const legacyAerial = { ...photo, captureType: undefined, metadata: { aerial: { absoluteAltitude: 100 } } };
  assert.match(photoPerspectiveIssue(legacyAerial), /海拔/);
  close(photoCameraPose({ ...photo, metadata: {} }, 1.6, 1.5).fov, 43);
});

test('camera enters and returns smoothly, restoring position, orientation, orbit target, focal angle and clipping plane', () => {
  const { camera, target } = overview(), original = readCameraPose(camera, target), motion = new PhotoCameraTransition(), pose = photoCameraPose(photo, 1.6, 1.5);
  motion.enter(camera, target, pose);
  assert.ok(motion.moving); vectorClose(camera.position, original.position);
  motion.tick(camera, target, .2);
  assert.ok(camera.position.distanceTo(pose.position) > 0); assert.ok(camera.position.distanceTo(original.position) > 0);
  close(camera.near, .08);
  finish(motion, camera, target); vectorClose(camera.position, pose.position); vectorClose(target, pose.target);
  close(camera.quaternion.angleTo(pose.quaternion), 0); close(camera.fov, pose.fov);
  assert.equal(motion.moving, false); assert.equal(motion.inPhotoView, true);
  motion.leave(camera, target); finish(motion, camera, target);
  vectorClose(camera.position, original.position); vectorClose(target, original.target);
  close(camera.quaternion.angleTo(original.quaternion), 0, 1e-7); close(camera.fov, original.fov); close(camera.near, original.near);
  assert.equal(motion.inPhotoView, false); assert.equal(motion.tick(camera, target, 1 / 60), false);
});

test('rapid entry, return and draft edits remain continuous and preserve the original map view', () => {
  const { camera, target } = overview(), original = readCameraPose(camera, target), motion = new PhotoCameraTransition();
  motion.enter(camera, target, photoCameraPose(photo, 1.6, 1.5)); motion.tick(camera, target, .3);
  motion.leave(camera, target); motion.tick(camera, target, .2);
  const before = camera.position.clone();
  const edited = { ...photo, position: { x: 15, z: 20 }, heading: 270, pitch: 50, view: { focalLength35Mm: 85 } };
  const source = JSON.stringify(edited);
  motion.enter(camera, target, photoCameraPose(edited, 10.6, .5)); vectorClose(camera.position, before);
  finish(motion, camera, target); vectorClose(camera.position, new THREE.Vector3(15, 10.6, 20));
  motion.leave(camera, target); finish(motion, camera, target);
  vectorClose(camera.position, original.position); vectorClose(target, original.target); close(camera.fov, original.fov);
  assert.equal(JSON.stringify(edited), source, 'Preview never persists display height or overwrites photo settings');
});

test('heading wrap follows the short rotation and reduced motion completes immediately in both directions', () => {
  const a = photoCameraPose({ ...photo, heading: 359, pitch: 0 }, 1.6, 1.5), camera = cameraAtPose(a), target = a.target.clone(), motion = new PhotoCameraTransition();
  const b = photoCameraPose({ ...photo, heading: 1, pitch: 0 }, 1.6, 1.5);
  motion.enter(camera, target, b); for (let n = 0; n < 19; n++) motion.tick(camera, target, .025);
  vectorClose(camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(0, 0, -1));
  motion.leave(camera, target, true);
  assert.equal(motion.moving, false); close(camera.quaternion.angleTo(a.quaternion), 0);
  motion.enter(camera, target, b, true); assert.equal(motion.moving, false); vectorClose(camera.position, b.position);
  motion.leave(camera, target, true); vectorClose(camera.position, a.position);
});

test('idle demand-render intervals cannot skip entry or return; interrupted resizes keep the camera continuous', () => {
  const { camera, target } = overview(), original = readCameraPose(camera, target), motion = new PhotoCameraTransition();
  const pose = photoCameraPose(photo, 1.6, 1.5);
  motion.enter(camera, target, pose); motion.tick(camera, target, 45);
  assert.equal(motion.moving, true); assert.ok(camera.position.distanceTo(original.position) < 5);
  for (let n = 0; n < 10; n++) motion.tick(camera, target, 1 / 60);
  const mid = camera.position.clone(), resized = photoCameraPose(photo, 1.6, .6);
  motion.enter(camera, target, resized); vectorClose(camera.position, mid);
  finish(motion, camera, target); vectorClose(camera.position, resized.position);
  motion.leave(camera, target); motion.tick(camera, target, 20);
  assert.equal(motion.moving, true); assert.ok(camera.position.distanceTo(resized.position) < 5);
  finish(motion, camera, target); vectorClose(camera.position, original.position);
});

test('resizing a preview changes framing without restarting its motion or cutting to the final position', () => {
  const first = overview(), second = overview(), motion = new PhotoCameraTransition(), reference = new PhotoCameraTransition();
  const pose = photoCameraPose(photo, 1.6, 1.5);
  motion.enter(first.camera, first.target, pose); reference.enter(second.camera, second.target, pose);
  for (let n = 0; n < 20; n++) { motion.tick(first.camera, first.target, 1 / 60); reference.tick(second.camera, second.target, 1 / 60); }
  const before = readCameraPose(first.camera, first.target), resized = photoCameraPose(photo, 1.6, .6);
  motion.reframe(first.camera, resized); vectorClose(first.camera.position, before.position); close(first.camera.fov, before.fov);
  assert.equal(motion.moving, true);
  for (let n = 0; n < 40; n++) {
    motion.tick(first.camera, first.target, 1 / 60); reference.tick(second.camera, second.target, 1 / 60);
    vectorClose(first.camera.position, second.camera.position);
  }
  assert.equal(motion.moving, false); close(first.camera.fov, resized.fov);
});

const testServer = async () => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-photo-camera-'));
  const server = await createServer({ root: fileURLToPath(new URL('../', import.meta.url)), cacheDir, configFile: false, appType: 'custom', optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null } });
  return { server, close: async () => { await server.close(); await fs.rm(cacheDir, { recursive: true, force: true }); } };
};

test('photo details, lightbox and draft preview expose enter/return actions, explain unavailable states and carry the transition overlay', async () => {
  const environment = await testServer();
  try {
    const { PhotoHalfOverlayButton, PhotoPerspectiveButton, PhotoPerspectiveOverlay } = await environment.server.ssrLoadModule('/src/PhotoPerspective.tsx');
    const { PhotoDetails, Lightbox } = await environment.server.ssrLoadModule('/src/components.tsx');
    const { default: PhotoComparison } = await environment.server.ssrLoadModule('/src/PhotoComparison.tsx');
    const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url))), site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
    const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
    const details = render(PhotoDetails, { photo, campus, site, onOpen() {}, onPhotoPerspective() {} });
    const renditions = { ...photo, files: { thumbnail:'small.webp', preview:'preview.webp', display:'large.webp', download:'full.jpg' } };
    for (const markup of [render(PhotoDetails,{photo:renditions,campus,site,onOpen(){}}),render(PhotoComparison,{photo:renditions,onOpen(){},children:'model'}),render(Lightbox,{photo:renditions,onClose(){}})]) {
      assert.match(markup, /src="[^"]*small\.webp"/);
      assert.doesNotMatch(markup, /src="[^"]*(large\.webp|preview\.webp|full\.jpg)[^"]*"|rel="preload"[^>]*full\.jpg/);
    }
    assert.match(render(Lightbox,{photo:renditions,onClose(){}}), /href="[^\"]*full\.jpg" download=/);
    assert.match(details, /进入照片视角/); assert.match(details, /aria-pressed="false"/);
    assert.match(render(Lightbox, { photo, onClose() {}, onPhotoPerspective() {} }), /进入照片视角/);
    assert.match(render(PhotoPerspectiveButton, { photo, active: false, editor: true, onClick() {} }), /照片视角 · 调整角度/);
    const unavailable = render(PhotoPerspectiveButton, { photo: { ...photo, placed: false }, active: false, editor: true, onClick() {} });
    assert.match(unavailable, /disabled=""/); assert.match(unavailable, /先在地图标记/);
    const active = render(PhotoPerspectiveButton, { photo, active: true, onClick() {} });
    assert.match(active, /返回地图视角/); assert.match(active, /aria-pressed="true"/);
    const preview = render(PhotoPerspectiveOverlay, { photo: { ...photo, metadata: {} } });
    assert.match(preview, /photo-perspective-frame/); assert.match(preview, /aria-hidden="true"/);
    assert.doesNotMatch(preview, /photo-perspective-bar|<button|返回地图/);
    const display = render(PhotoPerspectiveOverlay, { photo });
    assert.doesNotMatch(display, /photo-perspective-bar|<button|拖动|方向键/);
    assert.doesNotMatch(display, /<img/, 'the frame stays empty until the transition is loaded');
    const { default: PhotoOverlay } = await environment.server.ssrLoadModule('/src/PhotoOverlay.tsx');
    const overlay = render(PhotoOverlay, { photo: renditions, viewport: FULL_MAP_VIEWPORT, theme: 'light', mode: 'off', cameraReady: true });
    assert.doesNotMatch(overlay, /<button|role="switch"|<input|<select|調试|调试|转场设置|转场进度|深度图来源/);
    assert.doesNotMatch(overlay, /src=/, 'off does not fetch photo or depth assets');
    const half = render(PhotoHalfOverlayButton, { photo, active: false, onClick() {} });
    assert.match(half, /半透明照片叠加/); assert.match(half, /button secondary/);
    const comparison = render(PhotoComparison, { photo: renditions, onOpen() {}, openLabel: '沉浸看照片', openHelp: '沉浸式看照片中可下载原图', footerActions: React.createElement(PhotoHalfOverlayButton, {photo, active:false, onClick(){}}), children: 'model' });
    assert.ok(comparison.indexOf('comparison-overlay-actions') > comparison.indexOf('comparison-image'), 'controls follow the photo rather than covering it');
    assert.match(comparison, /沉浸式看照片中可下载原图/);
    assert.doesNotMatch(comparison, /全屏照片/);
    const withCanvas = render(PhotoPerspectiveOverlay, { photo: renditions, children: React.createElement('canvas', { className: 'depth-transition-layer' }) });
    assert.match(withCanvas, /photo-perspective-frame/); assert.match(withCanvas, /depth-transition-layer/);
    assert.doesNotMatch(render(PhotoPerspectiveButton, { photo, active: false, onClick() {} }), /拖动|环顾/);
  } finally { await environment.close(); }
});

test('real camera rig suspends orbit controls during photo transitions, responds to unsaved settings and restores map controls', async () => {
  const environment = await testServer(), previousWindow = globalThis.window, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const canvas = testCanvas(), committed = [];
  const gl = { domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, shadowMap: {}, xr: { addEventListener() {}, removeEventListener() {} } };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    const { default: Rig } = await environment.server.ssrLoadModule('/src/MapCameraRig.tsx');
    globalThis.window = { devicePixelRatio: 1, navigator: globalThis.navigator, matchMedia: () => ({ matches: false }) };
    root = createRoot(canvas);
    await root.configure({ gl, size: { width: 900, height: 600, top: 0, left: 0 }, frameloop: 'never', camera: { position: [-240, 340, -380], fov: 43, near: .5, far: 2000 } });
    const props = { command: { type: 'initial', sequence: 0 }, boundary: [[-300, -300], [300, -300], [300, 300], [-300, 300]], selected: null, preview: null, canAdjustPhotoView: true, onCompact() {}, onAzimuth() {}, onMoving() {}, onPhotoOrientation: orientation => committed.push(orientation) };
    let store;
    await act(async () => { store = root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, props))); });
    const state = store.getState(), camera = state.camera, control = state.controls;
    let timeline = 0;
    const advance = async (frames = 60) => { await act(async () => { for (let n = 0; n < frames; n++) state.advance(timeline += 1 / 60, false); }); };
    assert.ok(control); let original = readCameraPose(camera, control.target);
    const distance = camera.position.distanceTo(control.target);
    const direction = camera.getWorldDirection(new THREE.Vector3()), backward = mapTravelStep(camera);
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, command: { type: 'out', sequence: 1 } }))); });
    vectorClose(camera.position, original.position);
    assert.equal(control.enabled, false, 'Button travel begins an animation rather than teleporting');
    await advance(10);
    assert.ok(camera.position.distanceTo(original.position) > 0 && camera.position.distanceTo(original.position) < backward, 'The camera passes through intermediate positions');
    await advance();
    vectorClose(camera.position, original.position.clone().addScaledVector(direction, -backward));
    vectorClose(control.target, original.target.clone().addScaledVector(direction, -backward));
    close(camera.position.distanceTo(control.target), distance); assert.equal(control.enabled, true);
    const forward = mapTravelStep(camera);
    const beforeForward = camera.position.clone();
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, command: { type: 'in', sequence: 2 } }))); });
    vectorClose(camera.position, beforeForward); await advance();
    vectorClose(camera.position, original.position.clone().addScaledVector(direction, forward - backward)); assert.equal(control.enabled, true);
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, command: { type: 'in', sequence: 3 } }))); });
    await advance(6);
    const interrupted = camera.position.clone();
    const wheelStep = mapTravelStep(camera);
    wheelEvent(canvas, -100);
    vectorClose(camera.position, interrupted.clone().addScaledVector(direction, wheelStep));
    await advance();
    vectorClose(camera.position, interrupted.clone().addScaledVector(direction, wheelStep));
    assert.equal(control.enabled, true, 'A wheel gesture interrupts button travel without a residual jump');
    assert.equal(control.enableZoom, false, 'Orbit dolly cannot fight forward travel');
    assert.equal(control.maxDistance, Infinity);
    pointerEvent(canvas, 'pointerdown', { button: 2 });
    pointerEvent(canvas.ownerDocument, 'pointermove', { button: 2, clientX: 140 });
    pointerEvent(canvas.ownerDocument, 'pointerup', { button: 2, clientX: 140 });
    assert.ok(control.target.length() > 1, 'The map gesture has pending pan momentum');
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, command: { type: 'reset', sequence: 4 } }))); });
    await advance(); await advance();
    vectorClose(control.target, new THREE.Vector3()); close(camera.position.length(), distance);
    original = readCameraPose(camera, control.target);
    for (let n = 0; n < 180; n++) wheelEvent(canvas, -100);
    assert.ok(camera.position.y >= 1.6, 'Repeated real wheel input stays above ground');
    const grounded = camera.position.clone(); wheelEvent(canvas, -100000);
    assert.ok(Math.hypot(camera.position.x - grounded.x, camera.position.z - grounded.z) > 1000, 'Real wheel retains unlimited horizontal travel');
    close(camera.position.distanceTo(control.target), distance);
    original = readCameraPose(camera, control.target);
    const preview = { ...photo, position: { ...photo.position, height: 1.6 }, pitch: 60 };
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, preview }))); });
    assert.equal(control.enabled, false);
    assert.equal(wheelEvent(canvas, -100).defaultPrevented, false, 'Map travel is suspended during photo entry');
    assert.equal(store.getState().events.enabled, false, 'Photo dragging skips scene raycasting');
    pointerEvent(canvas, 'pointerdown');
    vectorClose(camera.position, new THREE.Vector3(10, 1.6, -25));
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(...directionVector(125, 60)));
    pointerEvent(canvas, 'pointerup');
    await advance(); vectorClose(camera.position, new THREE.Vector3(10, 1.6, -25));
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(...directionVector(125, 60)));
    assert.equal(control.enabled, false, 'The old orbital polar limit must not reset an upward or ground-level shot');
    const source = JSON.stringify(preview), sensitivity = 2 * Math.tan(camera.fov * Math.PI / 360) * 180 / Math.PI / 600;
    pointerEvent(canvas, 'pointerdown'); pointerEvent(canvas, 'pointermove', { clientX: 170, clientY: 80 });
    const dragged = { heading: 125 - 70 * sensitivity, pitch: 60 - 20 * sensitivity };
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(...directionVector(dragged.heading, dragged.pitch)));
    vectorClose(camera.position, new THREE.Vector3(10, 1.6, -25));
    assert.equal(committed.length, 0, 'The camera changes before a frame or draft update runs');
    pointerEvent(canvas, 'pointerup', { clientX: 170, clientY: 80 });
    close(committed[0].heading, dragged.heading); close(committed[0].pitch, dragged.pitch);
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, preview: { ...preview, ...committed[0] } }))); });
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), new THREE.Vector3(...directionVector(dragged.heading, dragged.pitch)));
    assert.equal(JSON.stringify(preview), source, 'Looking around never changes the saved photo record');
    const edited = { ...preview, position: { x: 20, z: -10, height: 9 }, heading: 270, pitch: -30, view: { focalLength35Mm: 85 } };
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, preview: edited }))); });
    await advance(); vectorClose(camera.position, new THREE.Vector3(20, 9, -10));
    close(camera.fov, photoCameraPose(edited, 9, 1.5).fov);
    const covered = { left: 0, top: .07, width: 1, height: .4 }, fullFov = camera.fov;
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, preview: edited, visibleViewport: covered, smoothPhotoFraming: true }))); });
    close(camera.fov, fullFov, 1e-6);
    const coveredFov = photoCameraPose(edited, 9, 1.5, covered).fov;
    await advance(15);
    assert.ok(camera.fov > Math.min(fullFov, coveredFov) && camera.fov < Math.max(fullFov, coveredFov), 'card framing crosses intermediate lens values');
    vectorClose(camera.position, new THREE.Vector3(20, 9, -10));
    await advance(); close(camera.fov, coveredFov);
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, preview: edited, smoothPhotoFraming: true }))); });
    close(camera.fov, coveredFov); await advance(); close(camera.fov, fullFov);
    pointerEvent(canvas, 'pointerdown', { pointerType: 'touch' }); pointerEvent(canvas, 'pointermove', { clientX: 140, clientY: 110, pointerType: 'touch' });
    pointerEvent(canvas, 'pointerup', { clientX: 140, clientY: 110, pointerType: 'touch' });
    const resizedDirection = camera.getWorldDirection(new THREE.Vector3());
    await act(async () => { state.setSize(360, 650); });
    await advance(); vectorClose(camera.position, new THREE.Vector3(20, 9, -10));
    close(camera.fov, photoCameraPose(edited, 9, 360 / 650).fov);
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), resizedDirection);

    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, preview: edited, canAdjustPhotoView: false }))); });
    const fixedDirection = new THREE.Vector3(...directionVector(edited.heading, edited.pitch)), commitCount = committed.length;
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), fixedDirection);
    assert.equal(canvas.tabIndex, -1, 'The display mode removes editor drag and keyboard bindings');
    const attemptAdjustment = () => {
      wheelEvent(canvas, -100);
      pointerEvent(canvas, 'pointerdown', { pointerType: 'touch' });
      pointerEvent(canvas, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 200 });
      pointerEvent(canvas, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 300 });
      pointerEvent(canvas, 'pointerup', { pointerId: 2, pointerType: 'touch' });
      pointerEvent(canvas, 'pointerup', { pointerType: 'touch' });
      for (const pointerType of ['mouse', 'touch']) {
        pointerEvent(canvas, 'pointerdown', { pointerType });
        pointerEvent(canvas, 'pointermove', { pointerType, clientX: 200, clientY: 250 });
        pointerEvent(canvas, 'pointerup', { pointerType, clientX: 200, clientY: 250 });
      }
      const key = new Event('keydown', { cancelable: true }); Object.assign(key, { key: 'ArrowRight' }); canvas.dispatchEvent(key);
      assert.equal(committed.length, commitCount, 'Display interactions never update photo angles');
    };
    attemptAdjustment();
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), fixedDirection);
    vectorClose(camera.position, new THREE.Vector3(20, 9, -10));

    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, props))); });
    assert.equal(control.enabled, false); await advance();
    vectorClose(camera.position, original.position); vectorClose(control.target, original.target); close(camera.fov, 43); close(camera.near, .5);
    await advance(); assert.equal(control.enabled, true);
    assert.equal(store.getState().events.enabled, true, 'Returning restores map selection');
    assert.equal(canvas.tabIndex, -1, 'The map regains its original keyboard behavior');

    const { canAdjustPhotoView, ...viewerProps } = props;
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...viewerProps, preview: edited }))); });
    const entering = readCameraPose(camera, control.target);
    attemptAdjustment();
    vectorClose(camera.position, entering.position);
    close(camera.quaternion.angleTo(entering.quaternion), 0, 1e-7);
    await advance();
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), fixedDirection);
    attemptAdjustment(); await advance();
    vectorClose(camera.getWorldDirection(new THREE.Vector3()), fixedDirection);
    vectorClose(camera.position, new THREE.Vector3(20, 9, -10));
    assert.equal(control.enabled, false, 'Saved photo display keeps the camera fixed throughout');
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...viewerProps, preview: { ...edited, position: { ...edited.position, height: -5 } } }))); });
    await advance(); vectorClose(camera.position, new THREE.Vector3(20, -5, -10));
    await advance(); vectorClose(camera.position, new THREE.Vector3(20, -5, -10));
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, viewerProps))); });
    await act(async () => { state.advance(timeline += .01, false); });
    assert.ok(camera.position.y < 0, 'The return animation may pass below the ground without teleporting');
    await advance(); await advance(); vectorClose(camera.position, original.position);
    camera.position.y = -4; control.target.y -= 10;
    await act(async () => { state.advance(timeline += 1 / 60, false); });
    close(camera.position.y, 1.6);

  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.window = previousWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
    await environment.close();
  }
});

test('overlay cards leave the map lens unchanged and keep selected objects centred in the exposed area', async () => {
  const environment = await testServer(), previousWindow = globalThis.window, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const canvas = testCanvas();
  const gl = { domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, shadowMap: {}, xr: { addEventListener() {}, removeEventListener() {} } };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    const { default: Rig } = await environment.server.ssrLoadModule('/src/MapCameraRig.tsx');
    globalThis.window = { devicePixelRatio: 1, navigator: globalThis.navigator, matchMedia: () => ({ matches: false }) };
    root = createRoot(canvas);
    await root.configure({ gl, size: { width: 900, height: 600, top: 0, left: 0 }, frameloop: 'never', camera: { position: [-240, 340, -380], fov: 43, near: .5, far: 2000 } });
    const props = { command: { type: 'initial', sequence: 0 }, boundary: [[-300,-300],[300,-300],[300,300],[-300,300]], selected: null, preview: null, onCompact() {}, onAzimuth() {}, onMoving() {} };
    let store, timeline = 0;
    const render = async changes => { await act(async () => { store = root.render(React.createElement(Rig, { ...props, ...changes })); }); };
    await render({});
    const state = store.getState(), camera = state.camera, control = state.controls;
    const advance = async (frames = 65) => { await act(async () => { for(let n=0;n<frames;n++) state.advance(timeline += 1/60,false); }); };
    const before = readCameraPose(camera,control.target);
    await render({ visibleViewport: { left: .4, top: 0, width: .6, height: 1 } }); await advance();
    vectorClose(camera.position,before.position); close(camera.quaternion.angleTo(before.quaternion),0,1e-7); close(camera.fov,before.fov);
    const selected = { ...photo, position: { ...photo.position, height: 1.6 } };
    const point = new THREE.Vector3(selected.position.x,selected.position.height,selected.position.z);
    const bottomCard = { left: 0, top: 0, width: 1, height: .35 };
    await render({selected,visibleViewport:bottomCard}); await advance();
    const focused = camera.quaternion.clone(), distance = camera.position.distanceTo(point);
    let projected = point.clone().project(camera); close(projected.x,0); close(projected.y,.65); close(camera.fov,before.fov);
    const sideCard = { left: 0, top: 0, width: .55, height: 1 };
    await render({selected,visibleViewport:sideCard}); await advance();
    close(camera.quaternion.angleTo(focused),0,1e-7); close(camera.position.distanceTo(point),distance);
    projected = point.clone().project(camera); close(projected.x,-.45); close(projected.y,0); close(camera.fov,before.fov);
    const preview = {...selected,pitch:-20};
    await render({selected,preview,visibleViewport:sideCard}); await advance();
    const next = {...selected,id:'next-photo',position:{x:40,z:20,height:9}};
    await render({selected:next,visibleViewport:bottomCard}); await advance(140);
    projected = new THREE.Vector3(40,9,20).project(camera); close(projected.x,0); close(projected.y,.65);
    close(camera.fov,before.fov); assert.equal(camera.view.enabled,false,'Leaving preview clears the optical projection offset');
    const last = readCameraPose(camera,control.target);
    await render({visibleViewport:FULL_MAP_VIEWPORT}); await advance();
    vectorClose(camera.position,last.position); close(camera.quaternion.angleTo(last.quaternion),0,1e-7); close(camera.fov,last.fov);
  } finally {
    if(root)await act(async()=>root.unmount());
    globalThis.window=previousWindow;globalThis.IS_REACT_ACT_ENVIRONMENT=previousAct;
    await environment.close();
  }
});

test('exposed-area gestures stay anchored and deselection waits for centring and photo transitions', async () => {
  const environment = await testServer(), previousWindow = globalThis.window, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const canvas = testCanvas();
  const gl = { domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, shadowMap: {}, xr: { addEventListener() {}, removeEventListener() {} } };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    const { default: Rig } = await environment.server.ssrLoadModule('/src/MapCameraRig.tsx');
    globalThis.window = { devicePixelRatio: 1, navigator: globalThis.navigator, matchMedia: () => ({ matches: false }) };
    root = createRoot(canvas);
    await root.configure({ gl, size: { width: 900, height: 600, top: 0, left: 0 }, frameloop: 'never', camera: { position: [-240, 340, -380], fov: 43, near: .5, far: 2000 } });
    let dismissed = 0, store, timeline = 0;
    const props = { command: { type: 'initial', sequence: 0 }, boundary: [[-2000,-2000],[2000,-2000],[2000,2000],[-2000,2000]], selected: null, preview: null, onCompact() {}, onAzimuth() {}, onMoving() {}, onSelectionOutOfView: () => dismissed++ };
    const render = async changes => { await act(async () => { store = root.render(React.createElement(Rig, { ...props, ...changes })); }); };
    await render({});
    const state = store.getState(), camera = state.camera, control = state.controls;
    const advance = async (frames = 65) => { await act(async () => { for(let n=0;n<frames;n++) state.advance(timeline += 1/60,false); }); };
    for (const viewport of [{left:0,top:0,width:1,height:.35},{left:.4,top:0,width:.6,height:1}]) {
      await render({visibleViewport:viewport}); await advance();
      const pivot = mapGroundOrbitTarget(camera,viewport), before = readCameraPose(camera,control.target);
      assert.ok(pivot);
      const projection = pivot.clone().project(camera), radius = pivot.distanceTo(camera.position);
      pointerEvent(canvas,'pointerdown',{pointerType:'touch',pageX:100,pageY:100});
      vectorClose(camera.position,before.position); close(camera.quaternion.angleTo(before.quaternion),0,1e-7);
      const move = {pointerType:'touch',pageX:135,pageY:115,clientX:135,clientY:115};
      pointerEvent(canvas,'pointermove',move); pointerEvent(canvas.ownerDocument,'pointermove',move);
      assert.ok(camera.position.distanceTo(before.position)>1,'Dragging orbits the exposed ground point');
      vectorClose(pivot.clone().project(camera),projection); close(pivot.distanceTo(camera.position),radius);
      pointerEvent(canvas,'pointerup',move); pointerEvent(canvas.ownerDocument,'pointerup',move);
      await advance(); vectorClose(pivot.clone().project(camera),projection);
    }
    const viewport = {left:0,top:0,width:1,height:.35}, selected = {...photo,position:{...photo.position,height:1.6}};
    await render({selected,visibleViewport:viewport}); await advance(8);
    assert.equal(dismissed,0,'A selection is not cancelled while its centring animation runs');
    await advance();
    const point = new THREE.Vector3(selected.position.x,selected.position.height,selected.position.z);
    close(point.clone().project(camera).y,.65); assert.equal(dismissed,0);
    const preview = {...selected,heading:0,pitch:60};
    await render({selected,preview,visibleViewport:viewport}); await advance(8);
    assert.equal(dismissed,0); await advance(); assert.equal(dismissed,0,'Looking away from the selected photo in preview is allowed');
    await render({selected,visibleViewport:viewport}); await advance(8); assert.equal(dismissed,0);
    await advance(140); assert.equal(dismissed,0,'Returning restores the selected object before checking its visibility');
    camera.lookAt(point); camera.updateMatrixWorld();
    control.target.copy(point); control.update();
    close(point.clone().project(camera).y,0);
    await advance(1); assert.equal(dismissed,1,'A photo under the card is outside the exposed view even though it remains on the canvas');
    await advance(); assert.equal(dismissed,1,'The dismissal is emitted once until selection changes');
    await render({visibleViewport:{left:.4,top:0,width:.6,height:1}});
    camera.position.set(0,100,0); control.target.set(0,0,0); camera.lookAt(control.target); control.update();
    const verticalPhoto = {...selected,id:'vertical-photo',position:{x:10,z:20,height:1.6}};
    await render({selected:verticalPhoto,visibleViewport:{left:.4,top:0,width:.6,height:1}}); await advance();
    const verticalProjection = new THREE.Vector3(10,1.6,20).project(camera);
    close(verticalProjection.x,.4); close(verticalProjection.y,0);
    assert.equal(dismissed,1,'Selecting from a near-vertical view centres correctly and does not dismiss the new photo');
  } finally {
    if(root)await act(async()=>root.unmount());
    globalThis.window=previousWindow;globalThis.IS_REACT_ACT_ENVIRONMENT=previousAct;
    await environment.close();
  }
});

test('photo, building and area approaches and card resizes stay continuous at both camera poles', async () => {
  const environment = await testServer(), previousWindow = globalThis.window, previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT;
  const canvas = testCanvas();
  const gl = { domElement: canvas, render() {}, setSize() {}, setPixelRatio() {}, shadowMap: {}, xr: { addEventListener() {}, removeEventListener() {} } };
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root;
  try {
    const { default: Rig } = await environment.server.ssrLoadModule('/src/MapCameraRig.tsx');
    globalThis.window = { devicePixelRatio: 1, navigator: globalThis.navigator, matchMedia: () => ({ matches: false }) };
    root = createRoot(canvas);
    await root.configure({ gl, size: { width: 390, height: 844, top: 0, left: 0 }, frameloop: 'never', camera: { position: [-240, 340, -380], fov: 43, near: .5, far: 2000 } });
    const props = { command: { type: 'initial', sequence: 0 }, boundary: [[-2000,-2000],[2000,-2000],[2000,2000],[-2000,2000]], selected: null, preview: null, onCompact() {}, onAzimuth() {}, onMoving() {} };
    let store, timeline = 0, sequence = 0;
    const render = async changes => { await act(async () => { store = root.render(React.createElement(Rig, { ...props, ...changes })); }); };
    await render({});
    const state = store.getState(), camera = state.camera, control = state.controls;
    const advance = async (message, frames = 75) => {
      await act(async () => {
        for (let n = 0; n < frames; n++) {
          const before = camera.quaternion.clone();
          state.advance(timeline += 1 / 60, false);
          assert.ok(before.angleTo(camera.quaternion) < .2, `${message}: abrupt rotation on frame ${n}`);
          assert.ok(camera.position.toArray().every(Number.isFinite));
          assert.ok(camera.position.y >= 1.6 - 1e-8);
        }
      });
      const settled = readCameraPose(camera, control.target);
      await act(async () => { for (let n = 0; n < 20; n++) state.advance(timeline += 1 / 60, false); });
      close(camera.quaternion.angleTo(settled.quaternion), 0, 1e-7);
      vectorClose(camera.position, settled.position);
      assert.ok(new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).y > 0, `${message}: camera must stay upright`);
    };
    const frame = (point, viewport) => {
      const projected = point.clone().project(camera);
      close(projected.x, 2 * (viewport.left + viewport.width / 2) - 1, 1e-7);
      close(projected.y, 1 - 2 * (viewport.top + viewport.height / 2), 1e-7);
      close(camera.fov, 43); assert.equal(camera.view?.enabled || false, false);
    };
    for (const pitch of [-89.4, -85, -70, 0, 70, 89.4]) for (const viewport of [
      FULL_MAP_VIEWPORT, { left: 0, top: 0, width: 1, height: .35 },
      { left: .4, top: 0, width: .6, height: 1 }, { left: 0, top: .65, width: .6, height: .35 }
    ]) {
      await render({ visibleViewport: viewport });
      const object = new THREE.Vector3(10, pitch > 0 ? 200 : 10, -25);
      camera.position.set(0, 350, 100);
      camera.quaternion.setFromEuler(new THREE.Euler(pitch * Math.PI / 180, .8, 0, 'YXZ'));
      control.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 100);
      const initialOrientation = camera.quaternion.clone(); control.update();
      close(camera.quaternion.angleTo(initialOrientation), 0, 1e-7);
      await render({ command: { type: 'cluster', sequence: ++sequence, target: object.toArray(), distance: 40 }, visibleViewport: viewport });
      await advance(`cluster at ${pitch} degrees, viewport ${JSON.stringify(viewport)}`);
      frame(object, viewport); close(camera.position.distanceTo(object), 40, 1e-7);
      close(camera.rotation.clone().reorder('YXZ').x, -Math.PI / 4);
    }
    // Real building and area selections use the same fixed approach from
    // either camera pole, including when a card covers part of the canvas.
    const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
    const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
    for (const id of ['way/855459420', 'way/855459418', 'local/underground-corridor']) for (const pitch of [-89.4, 89.4]) for (const viewport of [
      FULL_MAP_VIEWPORT, { left: .4, top: 0, width: .6, height: 1 }, { left: 0, top: 0, width: 1, height: .35 }
    ]) {
      await render({ visibleViewport: viewport });
      camera.position.set(0, 100, 0);
      camera.quaternion.setFromEuler(new THREE.Euler(pitch * Math.PI / 180, .8, 0, 'YXZ'));
      control.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 100);
      control.update();
      const focus = mapLocationTarget(campus, site, id), point = new THREE.Vector3(...focus.target), start = readCameraPose(camera, control.target);
      await render({ selectedObjectTarget: focus.target, selectedObjectBounds: focus.bounds, visibleViewport: viewport });
      vectorClose(camera.position, start.position);
      await advance(`focusing ${id} at ${pitch} degrees`); frame(point, viewport);
      close(camera.rotation.clone().reorder('YXZ').x, -Math.PI / 4);
      close(camera.rotation.clone().reorder('YXZ').y, .8);
      close(camera.position.distanceTo(point), 40, 1e-7);
      // A card resize keeps the same framing policy and animates the movement.
      const nextViewport = viewport.height === 1 ? { left: 0, top: 0, width: 1, height: .35 } : FULL_MAP_VIEWPORT;
      const beforeResize = camera.position.clone();
      await render({ selectedObjectTarget: focus.target, selectedObjectBounds: focus.bounds, visibleViewport: nextViewport });
      vectorClose(camera.position, beforeResize);
      await advance(`resizing a card around ${id}`); frame(point, nextViewport);
      close(camera.position.distanceTo(point), 40, 1e-7);
      close(camera.rotation.clone().reorder('YXZ').x, -Math.PI / 4);
    }
    // Switching between desktop and mobile keeps the fixed approach and
    // recentres smoothly instead of briefly scaling back to the overview.
    const resizeFocus = mapLocationTarget(campus, site, 'way/855459418'), resizePoint = new THREE.Vector3(...resizeFocus.target);
    const resizeViewport = { left: .4, top: 0, width: .6, height: 1 };
    await render({ selectedObjectTarget: resizeFocus.target, selectedObjectBounds: resizeFocus.bounds, visibleViewport: resizeViewport });
    await advance('selecting an area before viewport resizing');
    for (const [width, height] of [[900, 600], [390, 844]]) {
      const beforeResize = readCameraPose(camera, control.target);
      await act(async () => state.setSize(width, height));
      vectorClose(camera.position, beforeResize.position);
      await advance('resizing the screen with an area selected'); frame(resizePoint, resizeViewport);
      close(camera.position.distanceTo(resizePoint), 40, 1e-7);
      close(camera.rotation.clone().reorder('YXZ').x, -Math.PI / 4);
    }
    // Card movement preserves the selected photo's fixed tilt and distance.
    const side = { left: .4, top: 0, width: .6, height: 1 }, bottom = { left: 0, top: 0, width: 1, height: .35 };
    await render({ visibleViewport: side });
    camera.position.set(0, 100, 0);
    camera.quaternion.setFromEuler(new THREE.Euler(-89.4 * Math.PI / 180, .8, 0, 'YXZ'));
    control.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 100);
    control.update();
    const selected = { ...photo, position: { ...photo.position, height: 1.6 } }, point = new THREE.Vector3(10, 1.6, -25);
    await render({ selected, visibleViewport: side }); await advance('selecting a single photo near the pole'); frame(point, side);
    const distance = camera.position.distanceTo(point);
    await render({ selected, visibleViewport: bottom }); await advance('resizing a selected photo card near the pole'); frame(point, bottom);
    close(camera.position.distanceTo(point), distance, 1e-7);
    close(distance, 40, 1e-7); close(camera.rotation.clone().reorder('YXZ').x, -Math.PI / 4);
    // Close, elevated photos used to pull an upward-looking camera underneath
    // the photo. Ground, upper floors, aerial and underground photos all use
    // the same focus, even when another photo occupies the same shooting point.
    for (const height of [-6.4, 1.6, 15, 75]) for (const viewport of [FULL_MAP_VIEWPORT, side, bottom]) {
      await render({ visibleViewport: viewport });
      camera.position.set(0, 1.6, 0);
      camera.quaternion.setFromEuler(new THREE.Euler(Math.PI / 3, .8, 0, 'YXZ'));
      control.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 8);
      control.update();
      const selected = { ...photo, id: `close-photo-${height}-${viewport.width}`, position: { x: 5, z: -8, height } };
      const point = new THREE.Vector3(5, height, -8), start = readCameraPose(camera, control.target);
      await render({ selected, visibleViewport: viewport });
      vectorClose(camera.position, start.position);
      await advance('focusing a close photo from below'); frame(point, viewport);
      close(camera.rotation.clone().reorder('YXZ').x, -Math.PI / 4);
      close(camera.rotation.clone().reorder('YXZ').y, .8);
      close(camera.position.distanceTo(point), 40, 1e-7);
      assert.ok(camera.position.y > height, 'The focused camera is above the photograph');
      const next = { ...selected, id: selected.id + '-same-point' };
      camera.quaternion.setFromEuler(new THREE.Euler(.3, .8, 0, 'YXZ'));
      control.target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()), 20); control.update();
      await render({ selected: next, visibleViewport: viewport }); await advance('selecting another photo at the same point');
      frame(point, viewport); close(camera.rotation.clone().reorder('YXZ').x, -Math.PI / 4);
      close(camera.position.distanceTo(point), 40, 1e-7);
    }
  } finally {
    if (root) await act(async () => root.unmount());
    globalThis.window = previousWindow; globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct;
    await environment.close();
  }
});

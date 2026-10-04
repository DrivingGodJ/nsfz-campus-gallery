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

test('real map gestures anchor the ground, turn in place outside campus, prefer visible selections and release offscreen selections', async () => {
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
    const props = { command: { type: 'initial', sequence: 0 }, boundary: [[-300, -300], [300, -300], [300, 300], [-300, 300]], selected: null, preview: null, onCompact() {}, onAzimuth() {}, onMoving() {} };
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
    wheelEvent(canvas, -100); wheelEvent(canvas, -100); wheelEvent(canvas, -100);
    let position = camera.position.clone(), quaternion = camera.quaternion.clone();
    const ground = mapGroundOrbitTarget(camera, props.boundary), radius = position.distanceTo(ground);
    assert.ok(control.target.distanceTo(ground) > 1, 'Forward travel has moved the old orbit target');
    down(); vectorClose(camera.position, position); close(camera.quaternion.angleTo(quaternion), 0, 1e-7);
    vectorClose(control.target, ground);
    move(); up(); await advance(); vectorClose(control.target, ground); close(camera.position.distanceTo(ground), radius);
    assert.ok(camera.position.distanceTo(position) > 1, 'Single-finger drag orbits the new ground point');

    camera.position.set(450, 60, 300); control.target.set(600, 0, 300); camera.lookAt(control.target); control.update();
    position = camera.position.clone(); quaternion = camera.quaternion.clone();
    assert.equal(mapGroundOrbitTarget(camera, props.boundary), null);
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
    const fallbackGround = mapGroundOrbitTarget(camera, props.boundary);
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
    position = camera.position.clone(); down(); move(); up(); await advance();
    vectorClose(camera.position, position); assert.equal(control.enableRotate, true, 'Ending an in-place gesture restores other gestures');
    await render({});
    assert.equal(canvas.hasPointerCapture(1), false);

    const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
    const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
    for (const id of ['way/855459418', 'way/855459407', 'way/855459417', 'local/specimen-forest', 'local/underground-corridor', 'local/underpass']) {
      const focus = mapLocationTarget(campus, site, id), offset = camera.position.clone().sub(control.target), fov = camera.fov;
      position = camera.position.clone();
      await render({ selectedObjectTarget: focus.target, selectedObjectBounds: focus.bounds });
      vectorClose(camera.position, position); // Selection starts a journey rather than teleporting.
      await advance();
      vectorClose(control.target, new THREE.Vector3(...focus.target));
      vectorClose(camera.position.clone().sub(control.target), offset);
      const projected = new THREE.Vector3(...focus.target).project(camera);
      close(projected.x, 0); close(projected.y, 0); assert.equal(camera.fov, fov);
      down(); move(); up(); await advance();
      close(camera.position.distanceTo(new THREE.Vector3(...focus.target)), offset.length());
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

test('photo details, lightbox and draft preview expose enter/return actions and explain unavailable states', async () => {
  const environment = await testServer();
  try {
    const { PhotoPerspectiveButton, PhotoPerspectiveOverlay } = await environment.server.ssrLoadModule('/src/PhotoPerspective.tsx');
    const { PhotoDetails, Lightbox } = await environment.server.ssrLoadModule('/src/components.tsx');
    const { default: PhotoComparison } = await environment.server.ssrLoadModule('/src/PhotoComparison.tsx');
    const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url))), site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
    const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
    const details = render(PhotoDetails, { photo, campus, site, onOpen() {}, onPhotoPerspective() {} });
    const renditions = { ...photo, files: { thumbnail:'small.webp', preview:'preview.webp', display:'large.webp', download:'full.jpg' } };
    for (const markup of [render(PhotoDetails,{photo:renditions,campus,site,onOpen(){}}),render(PhotoComparison,{photo:renditions,onOpen(){},children:'model'})]) {
      assert.match(markup, /src="[^"]*preview\.webp"/);
      assert.doesNotMatch(markup, /src="[^"]*(large\.webp|full\.jpg)"|rel="preload"[^>]*full\.jpg/);
    }
    assert.match(render(Lightbox,{photo:renditions,onClose(){}}),/src="[^"]*full\.jpg"/);
    assert.match(details, /进入照片视角/); assert.match(details, /aria-pressed="false"/);
    assert.match(render(Lightbox, { photo, onClose() {}, onPhotoPerspective() {} }), /进入照片视角/);
    assert.match(render(PhotoPerspectiveButton, { photo, active: false, editor: true, onClick() {} }), /体验拍摄视角/);
    const unavailable = render(PhotoPerspectiveButton, { photo: { ...photo, placed: false }, active: false, editor: true, onClick() {} });
    assert.match(unavailable, /disabled=""/); assert.match(unavailable, /先在地图标记/);
    const active = render(PhotoPerspectiveButton, { photo, active: true, onClick() {} });
    assert.match(active, /返回地图视角/); assert.match(active, /aria-pressed="true"/);
    const preview = render(PhotoPerspectiveOverlay, { photo: { ...photo, metadata: {} } });
    assert.match(preview, /photo-perspective-frame/); assert.match(preview, /aria-hidden="true"/);
    assert.doesNotMatch(preview, /photo-perspective-bar|<button|返回地图/);
    const display = render(PhotoPerspectiveOverlay, { photo });
    assert.doesNotMatch(display, /photo-perspective-bar|<button|拖动|方向键/);
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
    const advance = async () => { await act(async () => { for (let n = 0; n < 60; n++) state.advance(timeline += 1 / 60, false); }); };
    assert.ok(control); let original = readCameraPose(camera, control.target);
    const distance = camera.position.distanceTo(control.target);
    const direction = camera.getWorldDirection(new THREE.Vector3()), backward = mapTravelStep(camera);
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, command: { type: 'out', sequence: 1 } }))); });
    vectorClose(camera.position, original.position.clone().addScaledVector(direction, -backward));
    vectorClose(control.target, original.target.clone().addScaledVector(direction, -backward));
    close(camera.position.distanceTo(control.target), distance); assert.equal(control.enabled, true);
    const forward = mapTravelStep(camera);
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, command: { type: 'in', sequence: 2 } }))); });
    vectorClose(camera.position, original.position.clone().addScaledVector(direction, forward - backward)); assert.equal(control.enabled, true);
    assert.equal(control.enableZoom, false, 'Orbit dolly cannot fight forward travel');
    assert.equal(control.maxDistance, Infinity);
    pointerEvent(canvas, 'pointerdown', { button: 2 });
    pointerEvent(canvas.ownerDocument, 'pointermove', { button: 2, clientX: 140 });
    pointerEvent(canvas.ownerDocument, 'pointerup', { button: 2, clientX: 140 });
    assert.ok(control.target.length() > 1, 'The map gesture has pending pan momentum');
    await act(async () => { root.render(React.createElement(React.StrictMode, null, React.createElement(Rig, { ...props, command: { type: 'reset', sequence: 3 } }))); });
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
    assert.equal(control.enabled, false); wheelEvent(canvas, -100); await advance();
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

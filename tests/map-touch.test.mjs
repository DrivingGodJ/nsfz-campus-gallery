import test from 'node:test';
import assert from 'node:assert/strict';
import { bindMapTouchControls } from '../src/map-touch-controls.ts';
import { bindMapTravelControls, panMapView } from '../src/map-travel-controls.ts';
import { PerspectiveCamera, Vector3 } from 'three';

const fixture = () => {
  const document = new EventTarget(), window = new EventTarget(), surface = new EventTarget();
  const canvas = new EventTarget(), photo = new EventTarget(), location = new EventTarget(), image = new EventTarget(), button = new EventTarget(), outside = new EventTarget(), captures = new Set();
  const mapNodes = new Set([canvas, photo, location, image, button]);
  for (const label of [photo, location]) Object.assign(label, { closest: selector => selector.includes('.map-photo') ? label : null });
  Object.assign(image, { closest: selector => selector.includes('.map-photo') ? photo : null });
  Object.assign(surface, { contains: node => mapNodes.has(node) });
  Object.assign(document, { defaultView: window });
  Object.assign(canvas, { ownerDocument: document, closest: () => surface, clientHeight: 600,
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) });
  const send = (target, type, values = {}, receiver = document) => {
    const event = new Event(type, { cancelable: true });
    Object.defineProperty(event, 'target', { value: target });
    Object.assign(event, values); receiver.dispatchEvent(event); return event;
  };
  const pointer = (target, type, id, x = 100, y = 100) => send(target, type, { pointerType: 'touch', pointerId: id, clientX: x, clientY: y });
  const calls = { travel: [], pan: [], lock: [], start: [], move: [], finish: 0 };
  let enabled = true;
  const dispose = bindMapTouchControls(canvas, { enabled: () => enabled,
    travel: value => calls.travel.push(value), pan: (dx, dy) => calls.pan.push([dx, dy]), multiTouch: active => calls.lock.push(active),
    single: { start: event => calls.start.push(event.pointerId), move: event => calls.move.push(event.pointerId), finish: () => calls.finish++ } });
  return { document, window, surface, canvas, photo, location, image, button, outside, captures, calls, send, pointer, dispose, enable: value => { enabled = value; } };
};

test('photo and location labels drag the map while taps and slight finger jitter still select the label', () => {
  for (const name of ['photo','location','image']) {
    const f = fixture(), label = f[name];
    f.pointer(label,'pointerdown',1);
    assert.deepEqual(f.calls.start,[1]); assert.equal(f.captures.size,0,'Keep a tap targeted at the label');
    f.pointer(label,'pointermove',1,102,102);
    assert.deepEqual(f.calls.move,[]);
    f.pointer(label,'pointerup',1,102,102);
    assert.equal(f.send(label,'click',{detail:1}).defaultPrevented,false);
    f.pointer(label,'pointerdown',2);
    assert.equal(f.pointer(label,'pointermove',2,110,105).defaultPrevented,true);
    assert.deepEqual(f.calls.move,[2]); assert.deepEqual([...f.captures],[2]);
    f.pointer(label,'lostpointercapture',2,110,105);
    f.pointer(f.canvas,'pointermove',2,125,110);
    assert.deepEqual(f.calls.move,[2,2],'Moving capture to the canvas does not interrupt rotation');
    f.pointer(f.canvas,'pointerup',2,125,110);
    assert.equal(f.captures.size,0);
    assert.equal(f.send(label,'click',{detail:1}).defaultPrevented,true,'A drag must not also open a photo or choose a location');
    f.pointer(label,'pointerdown',3); f.pointer(label,'pointerup',3);
    assert.equal(f.send(label,'click',{detail:1}).defaultPrevented,false,'The next tap is usable');
    f.dispose();
  }
});

test('pinches spanning the canvas, photos, controls and page boundary travel without single-finger rotation in either touch order', () => {
  for (const names of [['canvas', 'photo'], ['photo', 'canvas'], ['photo', 'button'], ['outside', 'canvas'], ['canvas', 'outside']]) {
    const f = fixture(), first = f[names[0]], second = f[names[1]];
    assert.equal(f.pointer(first, 'pointerdown', 1).defaultPrevented, false);
    assert.equal(f.pointer(second, 'pointerdown', 2, 200).defaultPrevented, true);
    assert.deepEqual([...f.captures], [1, 2]); assert.deepEqual(f.calls.lock, [true]);
    assert.equal(f.pointer(second, 'pointermove', 2, 240, 120).defaultPrevented, true);
    assert.ok(f.calls.travel[0] > 0); assert.deepEqual(f.calls.pan, [[20, 10]]);
    assert.deepEqual(f.calls.move, [], 'Neither contact starts a one-finger orbit once the pair is active');
    f.pointer(second, 'pointerup', 2, 240, 120);
    assert.equal(f.pointer(first, 'pointermove', 1, 150).defaultPrevented, true);
    assert.equal(f.calls.travel.length, 1); assert.deepEqual(f.calls.move, []);
    assert.deepEqual(f.calls.lock, [true], 'Keep orbit paused while the remaining finger is down');
    f.pointer(first, 'pointerup', 1, 150);
    assert.deepEqual(f.calls.lock, [true, false]); assert.equal(f.captures.size, 0);
    assert.equal(f.send(second, 'click', { detail: 1 }).defaultPrevented, true, 'A pinch must not open a photo or trigger a map button');
    assert.equal(f.send(second, 'click', { detail: 0 }).defaultPrevented, false, 'Keyboard activation remains usable');
    f.pointer(f.photo, 'pointerdown', 3); f.pointer(f.photo, 'pointerup', 3);
    assert.equal(f.send(f.photo, 'click', { detail: 1 }).defaultPrevented, false, 'The next deliberate tap can select a photo');
    f.dispose();
  }
});

test('single taps, ordinary map drags and UI scrolling keep their original behavior; page-only touches do not move the map', () => {
  const f = fixture();
  f.pointer(f.canvas, 'pointerdown', 1); f.pointer(f.canvas, 'pointermove', 1, 120); f.pointer(f.canvas, 'pointerup', 1);
  assert.deepEqual(f.calls.start, [1]); assert.deepEqual(f.calls.move, [1]);
  assert.equal(f.send(f.button, 'click', { detail: 1 }).defaultPrevented, false);
  f.pointer(f.outside, 'pointerdown', 2); f.pointer(f.outside, 'pointermove', 2, 120);
  assert.equal(f.send(f.outside, 'touchmove', { touches: [{ target: f.outside }] }).defaultPrevented, false);
  f.pointer(f.outside, 'pointerdown', 3, 200); f.pointer(f.outside, 'pointermove', 3, 240);
  assert.equal(f.send(f.outside, 'touchmove', { touches: [{ target: f.outside }, { target: f.outside }] }).defaultPrevented, false);
  assert.equal(f.calls.travel.length, 0); assert.equal(f.calls.pan.length, 0); assert.equal(f.captures.size, 0);
  f.dispose();
});

test('browser pinch and WebKit gestures are reserved for map gestures, including fixed photo perspectives', () => {
  const f = fixture(); f.enable(false);
  f.pointer(f.photo, 'pointerdown', 1); f.pointer(f.button, 'pointerdown', 2, 200); f.pointer(f.photo, 'pointermove', 1, 80);
  assert.equal(f.send(f.photo, 'touchstart', { touches: [{ target: f.photo }, { target: f.button }] }).defaultPrevented, true);
  assert.equal(f.send(f.outside, 'touchmove', { touches: [{ target: f.outside }, { target: f.canvas }] }).defaultPrevented, true);
  assert.equal(f.send(f.photo, 'gesturestart').defaultPrevented, true);
  assert.equal(f.send(f.button, 'gesturechange').defaultPrevented, true);
  assert.deepEqual(f.calls.lock, []); assert.deepEqual(f.calls.travel, []); assert.deepEqual(f.calls.pan, []);
  f.pointer(f.photo, 'pointerup', 1); f.pointer(f.button, 'pointerup', 2);
  assert.equal(f.send(f.outside, 'gesturestart').defaultPrevented, false);
  f.dispose();
});

test('moving implicit capture from a photo preserves both contacts, third fingers reset the baseline, and cancellation unlocks', () => {
  const f = fixture();
  f.pointer(f.photo, 'pointerdown', 1); f.pointer(f.canvas, 'pointerdown', 2, 200);
  f.pointer(f.photo, 'lostpointercapture', 1);
  f.pointer(f.canvas, 'pointermove', 2, 220); assert.equal(f.calls.travel.length, 1);
  f.pointer(f.button, 'pointerdown', 3, 300); f.pointer(f.button, 'pointermove', 3, 400);
  assert.equal(f.calls.travel.length, 1, 'No jump when an extra contact is present');
  f.pointer(f.button, 'pointercancel', 3); f.pointer(f.canvas, 'pointermove', 2, 230);
  assert.equal(f.calls.travel.length, 2); assert.ok(f.calls.travel[1] < .5, 'Resume from the current pair');
  f.pointer(f.canvas, 'pointercancel', 1); f.pointer(f.canvas, 'pointercancel', 2);
  assert.deepEqual(f.calls.lock, [true, false]); assert.equal(f.captures.size, 0);
  f.pointer(f.canvas, 'pointerdown', 4); f.pointer(f.canvas, 'pointermove', 4, 140);
  assert.deepEqual(f.calls.move, [4], 'A fresh single-finger gesture works after cancellation');
  f.dispose();
});

test('window blur and disposal release touch captures and restore orbit controls', () => {
  const f = fixture();
  f.pointer(f.canvas, 'pointerdown', 1); f.pointer(f.photo, 'pointerdown', 2, 200);
  f.window.dispatchEvent(new Event('blur'));
  assert.deepEqual(f.calls.lock, [true, false]); assert.equal(f.captures.size, 0);
  f.pointer(f.canvas, 'pointerdown', 3); f.pointer(f.button, 'pointerdown', 4, 200);
  f.dispose(); assert.deepEqual(f.calls.lock, [true, false, true, false]); assert.equal(f.captures.size, 0);
  f.pointer(f.canvas, 'pointerdown', 5); f.pointer(f.photo, 'pointerdown', 6, 200); f.pointer(f.photo, 'pointermove', 6, 240);
  assert.equal(f.calls.travel.length, 0, 'Document listeners are removed after the map unmounts');
});

test('trackpad pinch on floating UI controls the map but normal wheel scrolling in the photo menu stays native', () => {
  const f = fixture(); f.dispose();
  const steps = []; let enabled = true;
  const menu = { closest: selector => selector === '.photo-cluster-picker' ? {} : null };
  const dispose = bindMapTravelControls(f.canvas, { enabled: () => enabled, travel: value => steps.push(value) });
  assert.equal(f.send(f.button, 'wheel', { deltaY: -20, deltaMode: 0, ctrlKey: true }, f.surface).defaultPrevented, true);
  assert.deepEqual(steps, [.2]);
  assert.equal(f.send(menu, 'wheel', { deltaY: 60, deltaMode: 0 }, f.surface).defaultPrevented, false);
  assert.deepEqual(steps, [.2]);
  enabled = false;
  assert.equal(f.send(f.photo, 'wheel', { deltaY: -20, deltaMode: 0, ctrlKey: true }, f.surface).defaultPrevented, true);
  assert.deepEqual(steps, [.2], 'Fixed photo perspective must not zoom the browser or move the camera');
  dispose();
});

test('two-finger pan translates the camera and pivot together without rotating or changing the lens', () => {
  const camera = new PerspectiveCamera(43, 1.5, .5, 4000), target = new Vector3(10, 0, 20);
  camera.position.set(-240, 340, -380); camera.lookAt(target); camera.updateMatrixWorld();
  const position = camera.position.clone(), offset = position.clone().sub(target), rotation = camera.quaternion.clone();
  panMapView(camera, target, 30, -20, 600);
  assert.ok(camera.position.distanceTo(position) > 1);
  assert.ok(camera.position.clone().sub(target).distanceTo(offset) < 1e-8);
  assert.ok(camera.quaternion.angleTo(rotation) < 1e-7); assert.equal(camera.fov, 43);
  panMapView(camera, target, -30, 20, 600);
  assert.ok(camera.position.distanceTo(position) < 1e-8);
});

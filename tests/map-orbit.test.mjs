import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { mapGroundOrbitTarget, mapObjectInView, orbitMapObject, turnMapView } from '../src/map-orbit.ts';
import { bindMapTravelControls, travelAlongView } from '../src/map-travel-controls.ts';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} ~= ${b}`);
const fixture = (position = [0, 60, 100], gaze = [20, 0, 10]) => {
  const camera = new THREE.PerspectiveCamera(43, 1.5, .5, 4000), target = new THREE.Vector3(...gaze);
  camera.position.fromArray(position); camera.lookAt(target); camera.updateMatrixWorld();
  return { camera, target };
};

test('ground orbit uses the forward centre ray after travel, without moving or turning the camera', () => {
  const { camera, target } = fixture();
  travelAlongView(camera, target, 30);
  const position = camera.position.clone(), quaternion = camera.quaternion.clone();
  const intersection = mapGroundOrbitTarget(camera);
  close(intersection.distanceTo(new THREE.Vector3(20, 0, 10)), 0);
  close(camera.position.distanceTo(position), 0); close(camera.quaternion.angleTo(quaternion), 0);
  assert.ok(intersection.distanceTo(camera.position) < target.distanceTo(camera.position));
});

test('underground ground pivots use the basement plane while preserving exposed-area framing', () => {
  const ground = -3.8, { camera, target } = fixture([0, ground + 60, 100], [20, ground, 10]);
  travelAlongView(camera, target, 30, ground);
  const orientation = camera.quaternion.clone();
  close(mapGroundOrbitTarget(camera, undefined, ground).distanceTo(new THREE.Vector3(20, ground, 10)), 0);
  for (const viewport of [{left:.4,top:0,width:.6,height:1},{left:0,top:0,width:1,height:.35}]) {
    const pivot = mapGroundOrbitTarget(camera, viewport, ground), projected = pivot.clone().project(camera);
    close(pivot.y, ground);
    close(projected.x, 2 * (viewport.left + viewport.width / 2) - 1);
    close(projected.y, 1 - 2 * (viewport.top + viewport.height / 2));
  }
  close(camera.quaternion.angleTo(orientation), 0);
});

test('horizon, sky and intersections behind the camera choose in-place look', () => {
  for (const [position, gaze] of [
    [[0, 60, 100], [0, 60, 0]],
    [[0, 60, 100], [0, 70, 0]], [[0, -60, 100], [0, -70, 0]], [[0, 0, 100], [0, -10, 0]]
  ]) assert.equal(mapGroundOrbitTarget(fixture(position, gaze).camera), null);
});

test('ground orbit extends beyond both the campus boundary and the finite model ground', () => {
  for (const gaze of [[101,0,0], [-20,0,20], [2400,0,-1800]]) {
    const {camera,target} = fixture([0,60,100],gaze);
    const pivot = mapGroundOrbitTarget(camera);
    close(pivot.distanceTo(new THREE.Vector3(...gaze)),0);
    const position = camera.position.clone(), projected = pivot.clone().project(camera);
    orbitMapObject(camera,target,pivot,20,0,600);
    assert.ok(camera.position.distanceTo(position)>1,'Outside ground hits orbit rather than only turning the head');
    close(pivot.clone().project(camera).distanceTo(projected),0);
  }
});

test('ground pivots follow the exposed centre ray, including when that ray leaves campus', () => {
  const { camera } = fixture([0, 60, 100], [0, 0, 0]);
  const originalPosition = camera.position.clone(), originalQuaternion = camera.quaternion.clone();
  for (const viewport of [{left:.4,top:0,width:.6,height:1},{left:0,top:0,width:1,height:.35}]) {
    const pivot = mapGroundOrbitTarget(camera,viewport), projected = pivot.clone().project(camera);
    close(projected.x,2*(viewport.left+viewport.width/2)-1);
    close(projected.y,1-2*(viewport.top+viewport.height/2)); close(pivot.y,0);
  }
  const outsidePivot = mapGroundOrbitTarget(camera,{left:.4,top:0,width:.6,height:1});
  assert.ok(Math.abs(outsidePivot.x)>10,'A card can place the exposed centre beyond campus and still supply a pivot');
  close(camera.position.distanceTo(originalPosition),0); close(camera.quaternion.angleTo(originalQuaternion),0);
});

test('in-place look responds immediately, preserves position and lens, and permits looking at the sky', () => {
  const { camera, target } = fixture(), position = camera.position.clone(), direction = camera.getWorldDirection(new THREE.Vector3());
  turnMapView(camera, target, 100, 80, 600);
  close(camera.position.distanceTo(position), 0); assert.equal(camera.fov, 43);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).distanceTo(direction) > .1);
  turnMapView(camera, target, 0, 10000, 600);
  assert.ok(camera.getWorldDirection(new THREE.Vector3()).y > .99);
  assert.ok(target.toArray().every(Number.isFinite)); close(camera.position.distanceTo(position), 0);
});

test('selected photos outside the frame or behind the camera release their pivot; partly visible buildings retain it', () => {
  const { camera } = fixture([0, 40, 100], [0, 40, 0]);
  assert.equal(mapObjectInView(camera, new THREE.Vector3(0, 40, 0)), true);
  assert.equal(mapObjectInView(camera, new THREE.Vector3(300, 40, 0)), false);
  assert.equal(mapObjectInView(camera, new THREE.Vector3(0, 40, 150)), false);
  assert.equal(mapObjectInView(camera, new THREE.Vector3(0, 40, -5000)), false);
  const point = new THREE.Vector3(80, 40, 0);
  assert.equal(mapObjectInView(camera, point), false);
  assert.equal(mapObjectInView(camera, point, { min: [20, 20, -10], max: [100, 60, 10] }), true);
  assert.equal(mapObjectInView(camera, point, { min: [200, 20, -10], max: [300, 60, 10] }), false);
});

test('cards exclude covered photos and fully covered buildings from the visible frustum', () => {
  const { camera } = fixture([0,40,100],[0,40,0]);
  const side = {left:.4,top:0,width:.6,height:1}, bottom = {left:0,top:0,width:1,height:.35};
  const covered = new THREE.Vector3(-30,40,0), exposed = new THREE.Vector3(30,40,0);
  assert.equal(mapObjectInView(camera,covered),true);
  assert.equal(mapObjectInView(camera,covered,null,side),false);
  assert.equal(mapObjectInView(camera,exposed,null,side),true);
  assert.equal(mapObjectInView(camera,new THREE.Vector3(0,20,0),null,bottom),false);
  assert.equal(mapObjectInView(camera,new THREE.Vector3(0,65,0),null,bottom),true);
  assert.equal(mapObjectInView(camera,covered,{min:[-40,20,-10],max:[5,60,10]},side),true,'A building still visible beside the card retains selection');
  assert.equal(mapObjectInView(camera,covered,{min:[-40,20,-10],max:[-30,60,10]},side),false);
  assert.equal(mapObjectInView(camera,new THREE.Vector3(30,40,150),null,side),false);
  assert.equal(mapObjectInView(camera,new THREE.Vector3(30,40,-5000),null,side),false);
});

test('off-axis ground orbit keeps the pivot in the exposed centre without horizon roll or a lens change', () => {
  const { camera, target } = fixture([0,60,100],[0,0,0]);
  const viewport = {left:0,top:0,width:1,height:.35};
  const pivot = mapGroundOrbitTarget(camera,viewport);
  const radius = camera.position.distanceTo(pivot), initial = pivot.clone().project(camera);
  for (const [dx,dy] of [[30,10],[-50,30],[20,-20]]) {
    orbitMapObject(camera,target,pivot,dx,dy,600);
    const current = pivot.clone().project(camera);
    close(current.x,initial.x); close(current.y,initial.y); close(camera.position.distanceTo(pivot),radius);
    close(new THREE.Euler().setFromQuaternion(camera.quaternion,'YXZ').z,0); assert.equal(camera.fov,43);
  }
});

test('selected-object orbit preserves its radius and off-centre view even after passing the object', () => {
  const { camera, target } = fixture(), pivot = new THREE.Vector3(-40, 15, -30);
  travelAlongView(camera, target, 500);
  const position = camera.position.clone(), radius = position.distanceTo(pivot), quaternion = camera.quaternion.clone();
  const offsetAngle = camera.getWorldDirection(new THREE.Vector3()).angleTo(pivot.clone().sub(position));
  orbitMapObject(camera, target, pivot, 0, 0, 600);
  close(camera.position.distanceTo(position), 0); close(camera.quaternion.angleTo(quaternion), 0);
  orbitMapObject(camera, target, pivot, 70, 40, 600);
  close(camera.position.distanceTo(pivot), radius);
  close(camera.getWorldDirection(new THREE.Vector3()).angleTo(pivot.clone().sub(camera.position)), offsetAngle);
  assert.ok(camera.position.distanceTo(position) > 10); assert.equal(camera.fov, 43);
});

test('near-vertical orbits stay continuous beside and above cards and survive OrbitControls updates', () => {
  for (const viewport of [
    {left:0,top:0,width:1,height:1},
    {left:.4,top:0,width:.6,height:1},
    {left:0,top:0,width:1,height:.35},
    {left:.3,top:0,width:.7,height:.4}
  ]) {
    const {camera,target} = fixture([0,60,100],[0,0,0]);
    const pivot = mapGroundOrbitTarget(camera,viewport);
    const initial = pivot.clone().project(camera), radius = camera.position.distanceTo(pivot);
    target.copy(camera.position).addScaledVector(camera.getWorldDirection(new THREE.Vector3()),radius);
    const controls = new OrbitControls(camera);
    controls.target.copy(target); controls.minPolarAngle = .01; controls.maxPolarAngle = Math.PI-.01;
    for (let i=0;i<120;i++) {
      const before = camera.quaternion.clone();
      orbitMapObject(camera,controls.target,pivot,2,4,600);
      const custom = camera.quaternion.clone(), position = camera.position.clone();
      assert.ok(before.angleTo(custom)<.05,'A short drag must not flip the horizon at the pole');
      controls.update();
      assert.ok(custom.angleTo(camera.quaternion)<1e-7,'Controls must not correct the custom orbit');
      close(camera.position.distanceTo(position),0);
      const projected = pivot.clone().project(camera);
      close(projected.x,initial.x); close(projected.y,initial.y);
      close(camera.position.distanceTo(pivot),radius);
    }
    const atLimit = camera.quaternion.clone();
    orbitMapObject(camera,controls.target,pivot,0,20,600); controls.update();
    assert.ok(atLimit.angleTo(camera.quaternion)<1e-7,'Further upward dragging holds the pole limit');
    orbitMapObject(camera,controls.target,pivot,0,-4,600); controls.update();
    assert.ok(atLimit.angleTo(camera.quaternion)>.04,'Reversing the drag leaves the limit immediately');
    controls.dispose();
  }
});

test('rotation mode is chosen once per single-pointer gesture and yields to two-finger travel and fixed photo views', () => {
  const canvas = new EventTarget(), captures = new Set(), looks = [], travels = [];
  Object.assign(canvas, { clientHeight: 600, setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) });
  const pointer = (type, values = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, { pointerType: 'touch', pointerId: 1, button: 0, clientX: 100, clientY: 100, ...values });
    canvas.dispatchEvent(event); return event;
  };
  let starts = 0, finishes = 0, enabled = true;
  const dispose = bindMapTravelControls(canvas, { enabled: () => enabled, travel: steps => travels.push(steps),
    rotation: { start: () => { starts++; return true; }, look: (dx, dy) => looks.push([dx, dy]), finish: () => { finishes++; } } });
  pointer('pointerdown'); pointer('pointermove', { clientX: 130 }); pointer('pointermove', { clientX: 150, clientY: 110 });
  assert.deepEqual(looks, [[30, 0], [20, 10]]); assert.equal(starts, 1);
  pointer('pointerdown', { pointerId: 2, clientX: 250 }); assert.equal(finishes, 1);
  pointer('pointermove', { pointerId: 2, clientX: 270 }); assert.equal(looks.length, 2); assert.equal(travels.length, 1);
  pointer('pointerup', { pointerId: 2 }); pointer('pointerup');
  pointer('pointerdown', { pointerType: 'mouse', button: 2 }); assert.equal(starts, 1, 'Right-button pan does not change the pivot');
  pointer('pointerup', { pointerType: 'mouse' });
  pointer('pointerdown', { pointerType: 'mouse' }); pointer('pointercancel', { pointerType: 'mouse' });
  assert.equal(starts, 2); assert.equal(finishes, 2); assert.equal(captures.size, 0);
  enabled = false; pointer('pointerdown'); pointer('pointermove', { clientX: 200 });
  assert.equal(starts, 2); assert.equal(looks.length, 2, 'Photo display ignores rotation');
  enabled = true; pointer('pointerdown'); dispose(); assert.equal(finishes, 3); assert.equal(captures.size, 0);
  pointer('pointerdown'); assert.equal(starts, 3, 'Unmount removes rotation bindings');
});

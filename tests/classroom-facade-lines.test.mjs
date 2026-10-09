import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { classroomWindowLayout, solidCoreWindowLayout } from '../src/teaching-classrooms.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';

const config = { wallThickness: .24, bayWidth: 4, windowWidth: 2.6, sill: .9, top: 2.8, columns: 2, transom: .35 };
const rectangle = (x = 0) => [[x, 0], [x + 12, 0], [x + 12, 8], [x, 8], [x, 0]];
const core = [[rectangle()]];
const layout = settings => classroomWindowLayout(core, { ...config, ...settings }, 3.6, 3.6);

test('confirmed facade lines keep front windows without borrowing unknown backs, returns or inner walls', () => {
  const old = layout({});
  assert.equal(old.length, 10, 'An omitted constraint preserves the explicit legacy layout');
  assert.deepEqual(layout({ facadeLines: [] }), [], 'An explicitly unknown facade has no generic glass');
  const front = layout({ facadeLines: [[[0, 0], [12, 0]]] });
  assert.equal(front.length, 3);
  assert.ok(front.every(window => Math.abs(window.from[1] - config.wallThickness / 2) < 1e-9 &&
    Math.abs(window.to[1] - config.wallThickness / 2) < 1e-9), 'The glazing retains its half-wall inset');
  const hole = [[1, .01], [1, 5], [11, 5], [11, .01], [1, .01]];
  assert.deepEqual(classroomWindowLayout([[rectangle(), hole]], { ...config, facadeLines: [[[0, 0], [12, 0]]] }, 3.6, 3.6), front,
    'A nearby inner wall cannot reuse exterior facade evidence');
  assert.deepEqual(layout({ facadeLines: [[[2, -2], [2, 2]]] }), [], 'An intersecting line does not authorize a crossing window');
});

test('partial facade evidence covers a complete bay, tolerates rounding, and can join reversed fragments', () => {
  const settings = { facadeLines: [[[2, .00002], [0, .00002]], [[5, .00002], [2, .00002]]] };
  const windows = layout(settings);
  assert.equal(windows.length, 1, 'The first complete bay is confirmed across the two fragments');
  assert.ok(windows[0].from[0] > .69 && windows[0].to[0] < 3.31);
  assert.deepEqual(layout({ facadeLines: [[[.7, 0], [3.2, 0]]] }), [], 'A partly confirmed pane is not clipped into a false smaller window');
  assert.deepEqual(layout({ facadeLines: [[[0, .01], [12, .01]]] }), [], 'Floating-point tolerance cannot move evidence to a different wall');
});

test('thin curved chords all need evidence for the same bay, without wrapping into an unknown chord', () => {
  const ring = Array.from({ length: 65 }, (_, i) => [4 * Math.cos(i * Math.PI / 32), 4 * Math.sin(i * Math.PI / 32)]);
  ring[64] = ring[0];
  const curved = [[ring]], options = { ...config, windowWidth: 2.8 };
  const unrestricted = classroomWindowLayout(curved, options, 3.6, 3.6);
  assert.ok(unrestricted.length > 6);
  assert.deepEqual(classroomWindowLayout(curved, { ...options, facadeLines: [ring] }, 3.6, 3.6), unrestricted);
  assert.deepEqual(classroomWindowLayout(curved, { ...options, facadeLines: [ring.slice(0, 9)] }, 3.6, 3.6), [],
    'The first bay crosses an unconfirmed chord, so none of its fragments becomes glass');
});

test('floor limits and thin curtain-wall piers use the same layout, with independent core evidence', () => {
  const options = { ...config, windowWidth: 20, pierWidth: .08, startFloor: 2, endFloor: 3, facadeLines: [[[0, 0], [12, 0]]] };
  const windows = classroomWindowLayout(core, options, 14.4, 3.6);
  assert.equal(windows.length, 6);
  assert.ok(windows.every(window => Math.abs(Math.hypot(window.to[0] - window.from[0], window.to[1] - window.from[1]) - 3.92) < 1e-9));
  assert.deepEqual([...new Set(windows.map(window => window.bottom))], [4.5, 8.1]);
  const defaults = classroomWindowLayout(core, { ...options, pierWidth: undefined }, 14.4, 3.6);
  assert.ok(defaults.every(window => Math.abs(window.to[0] - window.from[0] - 3.1) < 1e-9), 'The original .9m pier remains the default');
  const cores = [
    { partId: 'a', outer: rectangle(20), holes: [], classroomWindows: { ...options, facadeLines: [] } },
    { partId: 'a', outer: rectangle(40), holes: [], startFloor: 2,
      classroomWindows: { ...options, startFloor: 3, facadeLines: [[[40, 0], [52, 0]]] } },
    { partId: 'a', outer: rectangle(60), holes: [] },
  ];
  const independent = solidCoreWindowLayout(cores, 14.4, 3.6);
  assert.equal(independent.length, 3);
  assert.ok(independent.every(window => window.from[0] > 40 && window.to[0] < 52 && window.bottom === 8.1),
    'Only the dedicated core\'s own confirmed facade and floor generate windows');
});

test('real window apertures and glazing agree, while unknown faces and unconfirmed floors stay solid', () => {
  const options = { ...config, facadeLines: [[[0, 0], [12, 0]]], startFloor: 2, endFloor: 3 };
  const section = { id: 'a', name: 'Evidence test', outer: rectangle(), holes: [], floors: 4, height: 14.4 };
  const body = new THREE.Mesh(buildingGeometry(section, 14.4, 3.6, [], [], [], options),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  body.rotation.x = -Math.PI / 2; body.position.y = .12; body.updateMatrixWorld();
  const detail = teachingWindowGeometry({ classroomWindows: options }, [section], 3.6);
  const glass = new THREE.Mesh(detail.glass, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  glass.updateMatrixWorld();
  const hit = (mesh, x, y, z, dz) => new THREE.Raycaster(new THREE.Vector3(x, .12 + y, z), new THREE.Vector3(0, 0, dz), 0, .9).intersectObject(mesh).length;
  try {
    assert.equal(detail.glass.getAttribute('position').count / 3, 12, 'Six allowed panes have six matching thin glazing panels');
    for (const y of [5.2, 8.8]) {
      assert.equal(hit(body, 2, y, -.5, 1), 0, 'The confirmed front window cuts its actual wall');
      assert.ok(hit(glass, 2, y, -.5, 1), 'The matching glazing lies inside that aperture');
      assert.ok(hit(body, 2, y, 8.5, -1), 'The unconfirmed back remains concrete');
      assert.equal(hit(glass, 2, y, 8.5, -1), 0);
    }
    for (const y of [1.6, 12.4]) {
      assert.ok(hit(body, 2, y, -.5, 1), 'Unconfirmed ground/top storeys keep their walls');
      assert.equal(hit(glass, 2, y, -.5, 1), 0);
    }
    assert.ok(hit(body, 2, 3.7, -.5, 1), 'The intermediate concrete floor is retained');
  } finally {
    body.geometry.dispose(); body.material.dispose(); glass.material.dispose();
    detail.glass.dispose(); detail.frames.dispose();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { campusExteriorGeometry, OFFICE_ID, LIBRARY_ID } from '../src/campus-exterior-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { officeWindowLayout } from '../src/office-windows.ts';
import { classroomGlazingGeometry } from '../src/architecture-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));

test('observed office and library details stay attached to their approved faces and respect cut floors', () => {
  for (const id of [OFFICE_ID, LIBRARY_ID]) {
    const building = campus.buildings.find(building => building.id === id), before = JSON.stringify(building), floors = id === LIBRARY_ID ? 5 : 4;
    const area = building.outer.slice(1).reduce((sum, p, i) => sum + building.outer[i][0] * p[1] - p[0] * building.outer[i][1], 0);
    for (const floorHeight of [3.6, 4.2]) for (const selectedFloor of [undefined, 1, 3, 4]) {
      const cutoff = selectedFloor === undefined ? undefined : selectedFloor * floorHeight;
      const model = campusExteriorGeometry(building, floors, floorHeight, cutoff);
      try {
        assert.equal(model.glass.getAttribute('position').count, 0,
          'The detail layer does not duplicate glass already supplied by an actual window layout');
        assert.equal(model.frame.getAttribute('position').count > 0, id === LIBRARY_ID, 'Library diagonal braces remain without duplicate office strip frames');
        for (const geometry of Object.values(model)) {
          const positions = geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) {
            const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
            assert.ok(Number.isFinite(x + y + z));
            assert.ok(y <= .12 + Math.min(cutoff ?? Infinity, (id === LIBRARY_ID ? 3 : floors) * floorHeight) + .001, 'No detail restores a removed storey or exceeds the 3F annex');
            let distance = Infinity, outwardOffset = Infinity;
            for (let j = 1; j < building.outer.length; j++) {
              const [ax, az] = building.outer[j - 1], [bx, bz] = building.outer[j], dx = bx - ax, dz = bz - az;
              const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
              const candidate = Math.hypot(x - ax - t * dx, z - az - t * dz);
              if (candidate < distance) {
                distance = candidate;
                outwardOffset = (area > 0 ? 1 : -1) * ((x - ax) * dz - (z - az) * dx) / Math.hypot(dx, dz);
              }
            }
            assert.ok(distance < .31, 'The decorative panel stays on the approved wall, without a new volume');
            assert.ok(outwardOffset >= .019, 'Panels sit outside the real wall rather than coplanar with it or buried inside it');
          }
          assert.equal(geometry.userData.photoOcclusionMask.some(Boolean), false, 'Details do not add photograph occlusion layers');
        }
      } finally { Object.values(model).forEach(geometry => geometry.dispose()); }
    }
    assert.equal(JSON.stringify(building), before, 'Confirmed footprint and floor data are untouched');
  }
});

test('library annex facade follows the effective two-floor editor override', () => {
  const building = campus.buildings.find(building => building.id === LIBRARY_ID);
  for (const floorHeight of [3.6, 4.2]) {
    const info = buildingLevels(building, { floors: 5, floorHeight, partFloors: { 'curved-annex': 2 } });
    const annexFloors = info.sections.find(section => section.id === 'curved-annex').floors;
    for (const selectedFloor of [undefined, 1, 2, 3]) {
      const cutoff = selectedFloor === undefined ? undefined : selectedFloor * floorHeight;
      const model = campusExteriorGeometry(building, info.floors, info.floorHeight, cutoff, annexFloors);
      try {
        assert.equal(model.glass.getAttribute('position').count, 0);
        assert.ok(model.frame.getAttribute('position').count > 0);
        for (const geometry of Object.values(model)) {
          const positions = geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) assert.ok(positions.getY(i) <= .12 + Math.min(2 * floorHeight, cutoff ?? Infinity) + .001,
            'Frames, braces and glazing stop at the overridden annex roof even when the main body has more floors');
        }
      } finally { Object.values(model).forEach(geometry => geometry.dispose()); }
    }
  }
});

test('library detail layer never invents fallback glass when window evidence is absent', () => {
  const saved = campus.buildings.find(building => building.id === LIBRARY_ID);
  for (const classroomWindows of [saved.classroomWindows, { ...saved.classroomWindows, facadeLines: [] }, undefined]) {
    const building = { ...saved, classroomWindows }, model = campusExteriorGeometry(building, 5, 3.6);
    try {
      assert.equal(model.glass.getAttribute('position').count, 0, 'Missing, unknown and configured layouts all forbid shallow fallback glass');
      assert.ok(model.frame.getAttribute('position').count > 0, 'White diagonal braces remain on the confirmed entry');
    } finally { Object.values(model).forEach(geometry => geometry.dispose()); }
  }
});

test('office tall light strip has real shared apertures, retained floor bands and no overlapping ordinary panes', () => {
  const saved = campus.buildings.find(building => building.id === OFFICE_ID), original = JSON.stringify(saved);
  const area = saved.outer.slice(1).reduce((sum, point, i) => sum + saved.outer[i][0] * point[1] - point[0] * saved.outer[i][1], 0), sign = area >= 0 ? 1 : -1;
  for (const floorHeight of [3.6, 4.2]) for (const cutoff of [undefined, floorHeight, 3 * floorHeight]) {
    // Wider ordinary bays deliberately overlap the strip before the helper's
    // exclusion, so this also catches duplicate glass and mullions at the join.
    const building = { ...saved, classroomWindows: { ...saved.classroomWindows, bayWidth: 3, windowWidth: 2.8, pierWidth: .08 } };
    const height = Math.min(4 * floorHeight, cutoff ?? Infinity), windows = officeWindowLayout(building, height, floorHeight);
    const strips = windows.filter(window => Math.abs((window.bottom % floorHeight) - .25) < 1e-7);
    assert.equal(strips.length, Math.round(height / floorHeight));
    assert.ok(windows.filter(window => !strips.includes(window)).every(window => !polygonClipping.intersection(window.cut, strips[0].cut).length),
      'The confirmed tall strip replaces any overlapping ordinary bay rather than duplicating it');
    const geometry = buildingGeometry(building, height, floorHeight, [], [], [], building.classroomWindows, [], [], cutoff !== undefined, windows);
    const body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    body.rotation.x = -Math.PI / 2; body.position.y = .12; body.updateMatrixWorld();
    const glazing = classroomGlazingGeometry(windows, building.classroomWindows), glass = new THREE.Mesh(glazing.glass, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    glass.updateMatrixWorld();
    const rayAt = (from, to, y) => {
      const along = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
      const normal = new THREE.Vector3(-along.z * sign, 0, along.x * sign);
      const point = new THREE.Vector3((from[0] + to[0]) / 2, .12 + y, (from[1] + to[1]) / 2);
      return new THREE.Raycaster(point.addScaledVector(normal, -.55), normal, 0, 1.1);
    };
    try {
      assert.equal(glazing.glass.getAttribute('position').count / 3, windows.length * 2, 'Each aperture has only one thin glazing panel');
      for (const strip of strips) {
        assert.ok(Math.abs(Math.hypot(strip.to[0] - strip.from[0], strip.to[1] - strip.from[1]) - 1.9) < 1e-7);
        const ray = rayAt(strip.from, strip.to, (strip.bottom + strip.top) / 2);
        assert.equal(ray.intersectObject(body).length, 0, 'The tall window is a true hole through the wall');
        assert.ok(ray.intersectObject(glass).length, 'The shared pane fills the hole');
        const band = rayAt(strip.from, strip.to, Math.floor(strip.bottom / floorHeight) * floorHeight + .13);
        assert.ok(band.intersectObject(body).length, 'Concrete floor bands remain between the tall lights');
        assert.equal(band.intersectObject(glass).length, 0);
      }
      const unknown = rayAt(building.outer[7], building.outer[8], floorHeight / 2);
      assert.ok(unknown.intersectObject(body).length, 'An unconfirmed side facade remains solid');
      assert.equal(unknown.intersectObject(glass).length, 0);
    } finally { geometry.dispose(); body.material.dispose(); glass.material.dispose(); glazing.glass.dispose(); glazing.frames.dispose(); }
  }
  assert.equal(JSON.stringify(saved), original, 'The test and helper do not alter approved footprints or window evidence');
});

test('office tall strip requires complete evidence on its own front face', () => {
  const saved = campus.buildings.find(building => building.id === OFFICE_ID);
  const a = saved.outer[13], b = saved.outer[14], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const point = fraction => [a[0] + (b[0] - a[0]) * fraction, a[1] + (b[1] - a[1]) * fraction];
  const strip = windows => windows.filter(window => Math.abs((window.bottom % 3.6) - .25) < 1e-7);
  const layout = facadeLines => officeWindowLayout({ ...saved, classroomWindows: { ...saved.classroomWindows, facadeLines } }, 14.4, 3.6);
  assert.deepEqual(layout([]), [], 'An explicitly unknown building does not acquire special glass');
  assert.equal(strip(layout([[saved.outer[6], saved.outer[7]]])).length, 0, 'Back-face evidence cannot authorize the front strip');
  assert.equal(strip(layout([[point(.48 - .95 / length), point(.48)]])).length, 0, 'Partial evidence does not authorize the remaining half of the strip');
  assert.equal(strip(layout([[a, b]])).length, 4, 'The confirmed front retains the tall strip on its four storeys');
  assert.equal(strip(layout(undefined)).length, 4, 'Legacy explicitly configured glazing retains its original semantics');
});

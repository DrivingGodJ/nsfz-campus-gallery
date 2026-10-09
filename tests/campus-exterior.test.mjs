import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { campusExteriorGeometry, OFFICE_ID, LIBRARY_ID } from '../src/campus-exterior-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));

test('observed office and library details stay attached to their approved faces and respect cut floors', () => {
  for (const id of [OFFICE_ID, LIBRARY_ID]) {
    const building = campus.buildings.find(building => building.id === id), before = JSON.stringify(building), floors = id === LIBRARY_ID ? 5 : 4;
    const area = building.outer.slice(1).reduce((sum, p, i) => sum + building.outer[i][0] * p[1] - p[0] * building.outer[i][1], 0);
    for (const floorHeight of [3.6, 4.2]) for (const selectedFloor of [undefined, 1, 3, 4]) {
      const cutoff = selectedFloor === undefined ? undefined : selectedFloor * floorHeight;
      const model = campusExteriorGeometry(building, floors, floorHeight, cutoff);
      try {
        assert.ok(model.glass.getAttribute('position').count > 0, 'The verified glazing is present');
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
        assert.ok(model.glass.getAttribute('position').count > 0);
        for (const geometry of Object.values(model)) {
          const positions = geometry.getAttribute('position');
          for (let i = 0; i < positions.count; i++) assert.ok(positions.getY(i) <= .12 + Math.min(2 * floorHeight, cutoff ?? Infinity) + .001,
            'Frames, braces and glazing stop at the overridden annex roof even when the main body has more floors');
        }
      } finally { Object.values(model).forEach(geometry => geometry.dispose()); }
    }
  }
});

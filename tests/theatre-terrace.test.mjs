import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingGeometry, snapFootprint } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingRailGeometry } from '../src/architecture-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const theatre = campus.buildings.find(building => building.id === 'local/theatre');
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const lerp = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t);
const mesh = (geometry, extruded = false) => {
  const result = new THREE.Mesh(geometry, material);
  if (extruded) { result.rotation.x = -Math.PI / 2; result.position.y = .12; }
  result.updateMatrixWorld(); return result;
};
const cast = (target, point, y, direction, far = 100) => new THREE.Raycaster(new THREE.Vector3(point[0], y, point[1]), new THREE.Vector3(...direction), 0, far).intersectObject(target)[0];

// The unchanged complete footprint supplies independent samples of the blue
// curved outside band, rather than sampling whatever a new terrace generates.
const arcSamples = theatre.outer.slice(11, 22).slice(1).map((b, i) => {
  const a = theatre.outer[11 + i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const inward = [-(b[1] - a[1]) / length, (b[0] - a[0]) / length];
  const edge = lerp(a, b, .5), point = edge.map((n, j) => n + inward[j] * 1.5);
  return { edge, point, inward };
});

function model(floorHeight, selectedFloor) {
  const info = buildingLevels(theatre, { floorHeight }), cutoff = selectedFloor === undefined ? undefined : selectedFloor * floorHeight;
  const geometries = info.sections.map(section => buildingGeometry(section, Math.min(section.height, cutoff ?? section.height), floorHeight,
    theatre.groundPassages, theatre.floorCorridors.filter(corridor => corridor.partId === section.id), [], undefined, [], [],
    cutoff !== undefined && cutoff <= section.height + 1e-6));
  const group = new THREE.Group(); geometries.forEach(geometry => group.add(mesh(geometry, true))); group.updateMatrixWorld();
  const rails = teachingRailGeometry(theatre, info.sections, floorHeight, cutoff);
  return { info, group, rails, guard: mesh(rails), dispose() { geometries.forEach(geometry => geometry.dispose()); rails.dispose(); } };
}

test('the curved terrace and six-storey theatre share a complete nonoverlapping footprint', () => {
  assert.deepEqual(corrections.buildings.find(building => building.id === theatre.id), theatre, 'Refresh data preserves the same theatre model');
  const info = buildingLevels(theatre), terrace = info.sections.find(section => section.id === 'curved-terrace');
  assert.equal(terrace.floors, 4);
  assert.ok(terrace.roofTerrace.railEdges.length);
  const footprints = info.sections.map(section => snapFootprint([[section.outer, ...section.holes]]));
  const complete = snapFootprint([[theatre.outer, ...theatre.holes]]), union = polygonClipping.union(...footprints);
  assert.deepEqual(polygonClipping.difference(complete, union), [], 'The lower four floors retain the full old outside outline without gaps');
  assert.deepEqual(polygonClipping.difference(union, complete), [], 'No new mass projects beyond the old theatre outline');
  for (let i = 0; i < footprints.length; i++) for (let j = i + 1; j < footprints.length; j++) {
    assert.deepEqual(polygonClipping.intersection(footprints[i], footprints[j]), [], 'Adjacent parts meet without overlapping walls');
  }
});

test('the blue band is enclosed on floors one to four, an open terrace on five and empty on six', () => {
  const floorHeight = 3.6, full = model(floorHeight), deckTop = .12 + 4 * floorHeight + .25;
  try {
    for (const { point, inward } of arcSamples) {
      const outward = [-inward[0], 0, -inward[1]];
      for (let floor = 0; floor < 4; floor++) {
        assert.ok(cast(full.group, point, .12 + floor * floorHeight + 1.5, outward, 2), 'The curved outside wall remains solid below the terrace');
      }
      const floor = cast(full.group, point, deckTop + .5, [0, -1, 0], .8);
      assert.ok(floor && Math.abs(floor.point.y - deckTop) < 1e-4, 'The fifth-floor terrace has a continuous floor at the ordinary fifth-storey floor level');
      assert.equal(cast(full.group, point, deckTop + 1, [0, 1, 0]), undefined, 'The terrace has open sky above it');
      assert.equal(cast(full.group, point, .12 + 5 * floorHeight + 1, [0, -1, 0], 1.5), undefined, 'The same band has no sixth-storey floor or roof');
      assert.equal(cast(full.group, point, .12 + 5 * floorHeight + 1.5, outward, 2), undefined, 'No sixth-storey outside wall remains in the terrace band');
      assert.ok(cast(full.group, point, .12 + 5 * floorHeight + 1.5, [inward[0], 0, inward[1]], 2.2), 'The inner theatre wall still encloses its sixth storey');
    }
  } finally { full.dispose(); }
});

test('terrace guards protect the fifth-floor edge without adding sixth-floor or lower-floor guards', () => {
  const floorHeight = 3.6, full = model(floorHeight);
  try {
    for (const { point, inward } of arcSamples) {
      const outward = [-inward[0], 0, -inward[1]];
      for (const rise of [.5, 1.05]) {
        const y = .12 + 4 * floorHeight + .25 + rise;
        assert.ok(cast(full.guard, point, y, outward, 2), 'Both handrails follow the complete curved terrace edge');
        assert.equal(cast(full.guard, point, y + floorHeight, outward, 2), undefined, 'There is no invented sixth-floor gallery guard');
        assert.equal(cast(full.guard, point, y - floorHeight, outward, 2), undefined, 'The fourth floor retains its solid facade instead of gallery guards');
      }
    }
    assert.ok(full.rails.userData.photoOcclusionMask.every(value => value === 0), 'Thin guards do not hide photo markers');
  } finally { full.dispose(); }
});

test('cutaways keep the fifth-floor terrace usable at changed floor heights and remove only selected ceilings', () => {
  for (const floorHeight of [2.4, 3.6, 4.2]) {
    const slabThickness = Math.min(.25, floorHeight * .1), deckTop = .12 + 4 * floorHeight + slabThickness;
    for (const selectedFloor of [4, 5, 6]) {
      const cut = model(floorHeight, selectedFloor);
      try {
        for (const { point, inward } of arcSamples) {
          const floor = cast(cut.group, point, deckTop + .5, [0, -1, 0], .8);
          assert.equal(Boolean(floor), selectedFloor > 4, 'The fourth-floor ceiling disappears; fifth- and sixth-floor views retain the real terrace floor');
          if (floor) assert.ok(Math.abs(floor.point.y - deckTop) < 1e-4, 'Terrace elevation follows the configured floor height and slab thickness');
          assert.equal(cast(cut.group, point, deckTop + .5, [0, 1, 0]), undefined, 'No cap is introduced above the outdoor terrace');
          assert.equal(Boolean(cast(cut.guard, point, deckTop + .5, [-inward[0], 0, -inward[1]], 2)), selectedFloor > 4, 'The fifth-floor guard appears only when that floor is shown');
        }
      } finally { cut.dispose(); }
    }
  }
});

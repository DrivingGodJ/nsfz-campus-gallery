import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { stairwellFrame, teachingStairGeometry } from '../src/teaching-stairs.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420'), stair = building.stairwells[0];
const { at, across } = stairwellFrame(stair);
const point = (u, v, y) => { const [x, z] = at(u, v); return new THREE.Vector3(x, y, z); };
const mesh = (geometry, extrusion = false) => {
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  if (extrusion) { result.rotation.x = -Math.PI / 2; result.position.y = .12; }
  result.updateMatrixWorld(); return result;
};
const down = (model, origin) => new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObject(model)[0];
const dispose = geometry => Object.values(geometry).forEach(g => g.dispose());

test('the photographed stairwell connects every main-building floor with two opposing flights and a half landing', () => {
  for (const override of [site.buildingOverrides[building.id], { floors: 7, floorHeight: 4.2 }]) {
    const info = buildingLevels(building, override), geometry = teachingStairGeometry(building, info.sections, info.floorHeight), model = mesh(geometry.concrete);
    const near = stair.landingDepth, far = near + stair.run;
    for (let level = 0; level < override.floors - 1; level++) {
      const bottom = .12 + level * info.floorHeight + .25, middle = bottom + info.floorHeight / 2;
      for (let i = 0; i < stair.stepsPerFlight; i++) {
        const t = (i + .5) / stair.stepsPerFlight, rise = (i + 1) * info.floorHeight / 2 / stair.stepsPerFlight;
        const lower = down(model, point(near + t * stair.run, -1.3, middle + .1));
        const upper = down(model, point(far - t * stair.run, 1.3, bottom + info.floorHeight + .1));
        assert.ok(lower && upper, 'Both flights have solid, upward-facing treads');
        assert.ok(Math.abs(lower.point.y - (bottom + rise)) < 1e-4);
        assert.ok(Math.abs(upper.point.y - (middle + rise)) < 1e-4);
      }
      const landing = down(model, point(far + stair.landingDepth / 2, 0, middle + .1));
      assert.ok(Math.abs(landing.point.y - middle) < 1e-4, 'One shared platform joins both flights at half a storey');
    }
    geometry.concrete.computeBoundingBox();
    assert.ok(geometry.concrete.boundingBox.max.y <= .12 + info.sections[0].height + 1e-5, 'No flight pierces the roof');
    assert.ok(geometry.concrete.getAttribute('position').count / 3 < 5000, 'Simplified stairs stay inexpensive');
    dispose(geometry);
  }
});

test('stair flights meet the retained full-floor landing instead of running into a solid floor', () => {
  const info = buildingLevels(building, site.buildingOverrides[building.id]), section = info.sections[0];
  const body = buildingGeometry(section, section.height, info.floorHeight, building.groundPassages, building.floorCorridors.filter(c => c.partId === section.id), building.stairwells);
  const model = mesh(body, true);
  for (let level = 0; level < section.floors; level++) {
    const landing = down(model, point(.7, 0, .12 + (level + .8) * info.floorHeight));
    assert.ok(Math.abs(landing.point.y - (.12 + level * info.floorHeight + .25)) < 1e-4, 'The common storey landing aligns with the staircase');
    const start = point(3, -7, .12 + (level + .5) * info.floorHeight);
    assert.equal(new THREE.Raycaster(start, new THREE.Vector3(across[0], 0, across[1]), 0, 7).intersectObject(model).length, 0, 'The original lake-facing wall no longer conceals the stairs');
  }
  const shaft = down(model, point(3, 0, .12 + section.height - .3));
  assert.ok(Math.abs(shaft.point.y - .37) < 1e-4, 'Intermediate floor plates are genuinely open through the stair shaft');
  const roof = down(model, point(3, 0, 30));
  assert.ok(Math.abs(roof.point.y - (.12 + section.height)) < 1e-4, 'The original roof still closes the stairwell');
  const classroom = down(model, new THREE.Vector3(112, 30, 37));
  assert.ok(Math.abs(classroom.point.y - roof.point.y) < 1e-4, 'The adjoining classroom mass is retained');
  body.dispose();
});

test('floor cutaways clip flights, supports and handrails, and the thin staircase structure does not hide photos', () => {
  const info = buildingLevels(building, site.buildingOverrides[building.id]);
  for (const floor of [1, 2, 3, 5]) {
    const shown = floor * info.floorHeight, geometry = teachingStairGeometry(building, info.sections, info.floorHeight, shown);
    for (const part of Object.values(geometry)) {
      part.computeBoundingBox();
      assert.ok(part.boundingBox.max.y <= .12 + shown + 1e-4, 'No upper-floor fragments float above the selected floor');
      assert.equal(part.userData.photoOcclusionMask.length, part.getAttribute('position').count / 3);
      assert.ok(part.userData.photoOcclusionMask.every(value => value === 0), 'Slim rails and flights preserve corridor marker visibility');
    }
    const landing = down(mesh(geometry.concrete), point(5.5, 0, .12 + info.floorHeight / 2 + .4));
    assert.ok(landing, 'The first-floor stairs remain visible in a first-floor cutaway');
    dispose(geometry);
  }
});

test('stair calibration survives map refresh without changing the photo records or creating a selectable landmark', async () => {
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus);
  assert.equal(stair.partId, 'main');
  assert.equal(building.stairwells.length, 1, 'Only the photographed bay is opened');
  assert.equal(campus.features.some(f => f.type === 'stairs'), false);
});

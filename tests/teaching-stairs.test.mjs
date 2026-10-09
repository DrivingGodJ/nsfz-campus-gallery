import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { buildingCoreFootprint, buildingGeometry } from '../src/building-geometry.ts';
import { stairwellFrame, stairwellShaft, teachingStairGeometry } from '../src/teaching-stairs.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
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
const rear = building.stairwells.find(s => s.internal), rearFrame = stairwellFrame(rear);
const rearPoint = (u, v, y) => { const [x, z] = rearFrame.at(u, v); return new THREE.Vector3(x, y, z); };
const area = polygons => polygons.reduce((total, polygon) => total + polygon.reduce((sum, ring, index) => sum + (index ? -1 : 1) * Math.abs(ring.slice(1).reduce((value, p, i) => value + ring[i][0] * p[1] - p[0] * ring[i][1], 0)) / 2, 0), 0);

test('every main-building floor starts on the right-hand flight and turns back onto the left-hand flight', () => {
  for (const override of [site.buildingOverrides[building.id], { floors: 7, floorHeight: 4.2 }]) {
    const info = buildingLevels(building, override), geometry = teachingStairGeometry({ ...building, stairwells: [stair] }, info.sections, info.floorHeight), model = mesh(geometry.concrete);
    const near = stair.landingDepth, far = near + stair.run;
    for (let level = 0; level < override.floors - 1; level++) {
      const bottom = .12 + level * info.floorHeight + .25, middle = bottom + info.floorHeight / 2;
      for (let i = 0; i < stair.stepsPerFlight; i++) {
        const t = (i + .5) / stair.stepsPerFlight, rise = (i + 1) * info.floorHeight / 2 / stair.stepsPerFlight;
        const lower = down(model, point(near + t * stair.run, 1.3, middle + .1));
        const upper = down(model, point(far - t * stair.run, -1.3, bottom + info.floorHeight + .1));
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

test('the rear stairwell replaces a classroom and climbs left first, then returns right on every storey', () => {
  assert.equal(rear.partId, 'main');
  assert.equal(rear.firstFlight, 'left');
  for (const override of [site.buildingOverrides[building.id], { floors: 7, floorHeight: 4.2 }]) {
    const info = buildingLevels(building, override), section = info.sections.find(s => s.id === rear.partId);
    const corridors = building.floorCorridors.filter(c => c.partId === section.id), solids = building.solidCores.filter(c => c.partId === section.id), cutouts = building.cutouts.filter(c => c.partId === section.id);
    const originalCore = buildingCoreFootprint(section, building.groundPassages, corridors, [stair], solids, cutouts);
    assert.equal(corridors.find(c => c.edge === 19).depth, 3, 'The existing front corridor keeps its three-metre width');
    assert.ok(area(polygonClipping.difference([rear.opening.outer], originalCore)) < .011, 'The room only overlaps the corridor at its two-millimetre joining seam');
    assert.ok(area(polygonClipping.difference([stairwellShaft(rear).outer], originalCore)) < 1e-6, 'The entire flight shaft lies in the previous classroom');
    const geometry = teachingStairGeometry({ ...building, stairwells: [rear] }, info.sections, info.floorHeight), model = mesh(geometry.concrete);
    const near = rear.landingDepth, far = near + rear.run;
    for (let level = 0; level < section.floors - 1; level++) {
      const bottom = .12 + level * info.floorHeight + .25, middle = bottom + info.floorHeight / 2;
      for (let i = 0; i < rear.stepsPerFlight; i++) {
        const t = (i + .5) / rear.stepsPerFlight, rise = (i + 1) * info.floorHeight / 2 / rear.stepsPerFlight;
        const lower = down(model, rearPoint(near + t * rear.run, -1.3, middle + .1));
        const upper = down(model, rearPoint(far - t * rear.run, 1.3, bottom + info.floorHeight + .1));
        assert.ok(lower && upper, 'Left and right flights both have solid treads');
        assert.ok(Math.abs(lower.point.y - (bottom + rise)) < 1e-4, 'The left flight rises away from the corridor');
        assert.ok(Math.abs(upper.point.y - (middle + rise)) < 1e-4, 'The right flight returns toward the corridor');
      }
      const landing = down(model, rearPoint(far + rear.landingDepth / 2, 0, middle + .1));
      assert.ok(landing && Math.abs(landing.point.y - middle) < 1e-4, 'The shared half-storey landing joins both flights');
    }
    const vertices = geometry.concrete.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      const dx = vertices.getX(i) - rear.origin[0], dz = vertices.getZ(i) - rear.origin[1];
      const u = dx * rearFrame.along[0] + dz * rearFrame.along[1], v = dx * rearFrame.across[0] + dz * rearFrame.across[1];
      assert.ok(u >= near - 1e-4 && u <= far + rear.landingDepth + 1e-4 && Math.abs(v) <= rear.width / 2 + 1e-4, 'Every stair and platform stays inside its classroom bay');
    }
    dispose(geometry); model.material.dispose();
  }
});

test('the enclosed rear stairs connect to intact corridor landings and remain usable with roof and floor cutaways', () => {
  const info = buildingLevels(building, site.buildingOverrides[building.id]), section = info.sections.find(s => s.id === rear.partId);
  const corridors = building.floorCorridors.filter(c => c.partId === section.id), stairs = building.stairwells.filter(s => s.partId === section.id), solids = building.solidCores.filter(c => c.partId === section.id), cutouts = building.cutouts.filter(c => c.partId === section.id);
  for (const selectedFloor of [undefined, 1, 3, section.floors]) {
    const shownFloors = selectedFloor || section.floors, height = shownFloors * info.floorHeight;
    const body = buildingGeometry(section, height, info.floorHeight, building.groundPassages, corridors, stairs, building.classroomWindows, solids, cutouts, !!selectedFloor), model = mesh(body, true);
    model.material.side = THREE.DoubleSide;
    const structure = teachingStairGeometry({ ...building, stairwells: [rear] }, info.sections, info.floorHeight, selectedFloor && height);
    const stairModels = Object.values(structure).map(part => mesh(part));
    const windows = teachingWindowGeometry(building, info.sections, info.floorHeight, selectedFloor && height), glass = mesh(windows.glass);
    for (let level = 0; level < shownFloors; level++) {
      const floorY = .12 + level * info.floorHeight + .25;
      for (const u of [-2.8, -1.5, -.2, .7]) {
        const landing = down(model, rearPoint(u, 0, floorY + info.floorHeight / 2));
        assert.ok(landing && Math.abs(landing.point.y - floorY) < 1e-4, 'The three-metre corridor and storey landing keep a continuous floor');
      }
      for (const u of [-2.8, -1.5, -.2]) {
        const ray = new THREE.Raycaster(rearPoint(u, -4, floorY + 1.3), new THREE.Vector3(rearFrame.across[0], 0, rearFrame.across[1]), 0, 6.4);
        assert.equal(ray.intersectObject(model).length, 0, 'No enclosure wall projects across the existing corridor');
        assert.equal(ray.intersectObjects(stairModels).length, 0, 'No stair, exterior support or handrail invades the corridor');
      }
      const entry = new THREE.Raycaster(rearPoint(-1.5, 0, floorY + 1), new THREE.Vector3(rearFrame.along[0], 0, rearFrame.along[1]), 0, 2.5);
      assert.equal(entry.intersectObject(model).length, 0, 'The stairwell entry opens directly onto the corridor landing');
      for (const sign of [-1, 1]) {
        const ray = new THREE.Raycaster(rearPoint(3, sign * 2.2, floorY + 1.3), new THREE.Vector3(sign * rearFrame.across[0], 0, sign * rearFrame.across[1]), 0, .6), wall = ray.intersectObject(model)[0];
        assert.ok(wall && Math.abs(wall.distance - .25) < 1e-4, 'The internal bay retains both classroom-side enclosure walls');
        assert.equal(ray.intersectObject(glass).length, 0, 'The internal partitions are walls rather than classroom glazing');
      }
      const back = new THREE.Raycaster(rearPoint(6, 0, floorY + 1.3), new THREE.Vector3(rearFrame.along[0], 0, rearFrame.along[1]), 0, .6).intersectObject(model)[0];
      assert.ok(back && Math.abs(back.distance - .2) < 1e-4, 'The back wall encloses the turning landing');
    }
    const shaft = down(model, rearPoint(3, 0, .12 + height - .3));
    assert.ok(shaft && Math.abs(shaft.point.y - .37) < 1e-4, 'Intermediate slabs leave the rear stair shaft open');
    if (!selectedFloor) {
      const roof = down(model, rearPoint(3, 0, .12 + height + 1));
      assert.ok(roof && Math.abs(roof.point.y - (.12 + height)) < 1e-4, 'The normal roof still covers the enclosed staircase');
    } else {
      const landing = down(model, rearPoint(.7, 0, .12 + height + 1));
      assert.ok(landing && Math.abs(landing.point.y - (.12 + (shownFloors - 1) * info.floorHeight + .25)) < 1e-4, 'A selected floor loses its ceiling but keeps its landing');
    }
    for (const part of Object.values(structure)) {
      part.computeBoundingBox();
      assert.ok(part.boundingBox.max.y <= .12 + height + 1e-4, 'Rear flights and handrails are clipped with the selected floor');
    }
    dispose(structure); dispose(windows); stairModels.forEach(part => part.material.dispose()); glass.material.dispose(); body.dispose(); model.material.dispose();
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

test('stairs sit beside the classroom wall, with enclosed outer rooms from the second floor and an open ground entrance', () => {
  for (const [override, cutaway] of [[site.buildingOverrides[building.id]], [{ floors: 7, floorHeight: 4.2 }], [site.buildingOverrides[building.id], 1], [site.buildingOverrides[building.id], 3]]) {
    const info = buildingLevels(building, override), section = info.sections[0], height = Math.min(section.height, (cutaway || section.floors) * info.floorHeight);
    const body = buildingGeometry(section, height, info.floorHeight, building.groundPassages,
      building.floorCorridors.filter(c => c.partId === section.id), building.stairwells, building.classroomWindows, building.solidCores, building.cutouts);
    const model = mesh(body, true); model.material.side = THREE.DoubleSide;
    for (let level = 0; level < (cutaway || section.floors); level++) {
      for (const u of [stair.landingDepth, 3, stair.landingDepth * 2 + stair.run]) {
        const wall = new THREE.Raycaster(point(u, stair.width / 2, .12 + level * info.floorHeight + .55), new THREE.Vector3(across[0], 0, across[1]), 0, 1).intersectObject(model)[0];
        assert.ok(wall && wall.distance > .08 && wall.distance < .2, 'The flight is close to the classroom wall without penetrating it');
      }
      for (const u of [2, 3, 5]) {
        const room = new THREE.Raycaster(point(u, -2.4, .12 + (level + .5) * info.floorHeight), new THREE.Vector3(-across[0], 0, -across[1]), 0, 5).intersectObject(model)[0];
        assert.equal(!!room, level > 0, 'The outer room is closed on every upper floor, while the ground-floor entrance remains open');
        if (room) {
          assert.ok(Math.abs(room.distance - .55) < 1e-4, 'A clear gap separates the room wall from the stair shaft');
          assert.equal(body.userData.photoOcclusionMask[room.faceIndex], 1, 'The room walls are solid photo occluders');
        }
      }
    }
    body.dispose(); model.material.dispose();
  }
});

test('stair calibration survives map refresh without changing the photo records or creating a selectable landmark', async () => {
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus);
  assert.equal(stair.partId, 'main');
  assert.equal(building.stairwells.length, 2, 'Both photographed stair bays survive the map refresh');
  assert.equal(campus.features.some(f => f.type === 'stairs'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { cafeteriaBodyGeometry, dormitoryBodyGeometry, facadeGeometry } from '../src/facade-geometry.ts';
import { laboratoryBodyGeometry } from '../src/laboratory-geometry.ts';
import { gymArchitecture, GYM_ID } from '../src/architecture-geometry.ts';
import { pavilionGeometry, PAVILION_BASE } from '../src/pavilion-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const mesh = geometry => { const result = new THREE.Mesh(geometry, material); result.updateMatrixWorld(); return result; };
const down = (object, x, y, z) => new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, -1)).intersectObject(object)[0];
const up = (object, x, y, z) => new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 0, 1)).intersectObject(object)[0];
const ordinary = (building, section, height, floorHeight, cutaway) => buildingGeometry(section, height, floorHeight, building.groundPassages,
  building.floorCorridors?.filter(c => c.partId === section.id), building.stairwells?.filter(s => s.partId === section.id), building.classroomWindows,
  building.solidCores?.filter(c => c.partId === section.id), building.cutouts?.filter(c => c.partId === section.id), cutaway);

function exposedFloorSamples(geometry, height, floorHeight, label = "") {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox, object = mesh(geometry), floor = Math.max(0, (Math.ceil(height / floorHeight - 1e-8) - 1) * floorHeight);
  let samples = 0;
  for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
    const x = THREE.MathUtils.lerp(bounds.min.x, bounds.max.x, i / 12), y = THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, j / 12);
    const floorHit = down(object, x, y, floor + floorHeight * .5);
    if (!floorHit || Math.abs(floorHit.point.z - floor - .25) > .02) continue;
    // Starting inside a thin solid wall sees its legitimate top edge; only
    // probe usable interior space with at least 35 cm of horizontal clearance.
    const origin = new THREE.Vector3(x, y, floor + floorHeight * .5);
    // A window can clear the eye-height rays while this sample remains inside
    // its thin wall footprint. Its legitimate lintel cap is not a room ceiling.
    // Check the wall-head height too; genuine interior roof caps still fail the
    // strict downward/upward assertions below because no nearby wall is hit.
    const clearanceOrigins = [origin, new THREE.Vector3(x, y, height - .05)];
    if (clearanceOrigins.some(point => [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]].some(direction =>
      new THREE.Raycaster(point, new THREE.Vector3(...direction), 0, .35).intersectObject(object).length))) continue;
    // Looking down from above must reach that same floor, not a replacement cap.
    const above = down(object, x, y, height + 1);
    assert.ok(above && Math.abs(above.point.z - floorHit.point.z) < 1e-4, `${label}: ceiling at ${above?.point.z}, floor at ${floorHit.point.z}, sample ${x},${y}`);
    assert.equal(up(object, x, y, floor + floorHeight * .5), undefined, 'The selected-floor ceiling is absent');
    samples++;
  }
  return samples;
}

test('all ordinary campus buildings open every selected storey, preserving floors and walls', () => {
  for (const building of campus.buildings.filter(b => !b.appearance && b.id !== GYM_ID && !b.facade)) {
    const info = buildingLevels(building, site.buildingOverrides[building.id]);
    for (const section of info.sections) for (const floor of Array.from({ length: section.floors }, (_, i) => i + 1)) {
      const height = Math.min(section.height, floor * info.floorHeight), geometry = ordinary(building, section, height, info.floorHeight, true);
      assert.ok(exposedFloorSamples(geometry, height, info.floorHeight, `${building.id}/${floor}`) > 0, `${building.id}/${section.id}/${floor} retains an exposed floor`);
      geometry.computeBoundingBox();
      assert.ok(Math.abs(geometry.boundingBox.max.z - height) < 1e-4, 'Walls retain the selected storey height');
      geometry.dispose();
    }
  }
});

test('laboratory, cafeteria and dormitory cutaways remove first and top ceilings without flattening their profiles', () => {
  const generators = { laboratory: laboratoryBodyGeometry, cafeteria: cafeteriaBodyGeometry, dormitory: dormitoryBodyGeometry };
  for (const building of campus.buildings.filter(b => b.facade && generators[b.facade.type])) {
    const info = buildingLevels(building, site.buildingOverrides[building.id]);
    for (const floor of [1, 2, info.floors]) {
      const height = floor * info.floorHeight, geometry = generators[building.facade.type](building, height, info.floorHeight, true);
      assert.ok(exposedFloorSamples(geometry, height, info.floorHeight, `${building.id}/${floor}`) > 0, `${building.id}/${floor} retains an exposed floor`);
      geometry.dispose();
    }
  }
});

test('removing the selected ceiling keeps lower ceilings and the normal complete roof intact', () => {
  const shape = { outer: [[0, 0], [12, 0], [12, 9], [0, 9], [0, 0]], holes: [] };
  const corridor = { partId: 'main', footprint: { outer: [[0, 0], [12, 0], [12, 3], [0, 3], [0, 0]], holes: [] }, points: [[0, 0], [12, 0]], depth: 3 };
  for (const floorHeight of [2.4, 3.6, 4.2]) {
    const height = floorHeight * 3;
    const cut = buildingGeometry(shape, height, floorHeight, [], [corridor], [], undefined, [], [], true);
    const full = buildingGeometry(shape, height, floorHeight, [], [corridor]);
    assert.equal(up(mesh(cut), 6, -1.5, height - floorHeight / 2), undefined);
    assert.ok(up(mesh(cut), 6, -1.5, floorHeight / 2), 'The lower storey retains its real ceiling');
    assert.ok(up(mesh(full), 6, -1.5, height - floorHeight / 2), 'Clearing the floor selection restores the roof');
    assert.ok(exposedFloorSamples(cut, height, floorHeight) > 0);
    cut.dispose(); full.dispose();
  }
});

test('gymnasium, dormitory dome and glass pavilion roofs disappear when their top floor is selected', () => {
  const gym = campus.buildings.find(b => b.id === GYM_ID), levels = buildingLevels(gym, site.buildingOverrides[gym.id]);
  const bridge = campus.features.find(f => f.id === 'local/footbridge');
  const fullGym = gymArchitecture(gym, levels.height, levels.floorHeight, bridge);
  const cutGym = gymArchitecture(gym, levels.height, levels.floorHeight, bridge, levels.height);
  assert.ok(fullGym.roof.getAttribute('position').count > 0);
  assert.equal(cutGym.roof.getAttribute('position').count, 0);
  for (const model of [fullGym, cutGym]) for (const geometry of Object.values(model)) geometry.dispose();

  const dorm = campus.buildings.find(b => b.facade?.type === 'dormitory'), dormLevels = buildingLevels(dorm, site.buildingOverrides[dorm.id]);
  const dormCut = facadeGeometry(dorm, dormLevels.floors, dormLevels.floorHeight, dormLevels.height, true);
  assert.equal(dormCut.dome, undefined);
  for (const { geometry } of dormCut.geometries) geometry.dispose();

  const hall = campus.buildings.find(b => b.appearance?.type === 'glass-pavilion'), hallLevels = buildingLevels(hall, site.buildingOverrides[hall.id]);
  const pavilion = pavilionGeometry(hall.appearance, hallLevels.height, 48, true);
  assert.deepEqual(pavilion.roofIndices, []); assert.deepEqual(pavilion.canopyIndices, []);
  assert.ok(pavilion.wallIndices.length && pavilion.rearGlassIndices.length, 'The pavilion facade remains');
  const rearHeight = pavilion.rearTop - PAVILION_BASE;
  const rear = buildingGeometry(pavilion.rearWing, rearHeight, hallLevels.height, [], [], [], undefined, [], [], true);
  assert.ok(exposedFloorSamples(rear, rearHeight, hallLevels.height) > 0, 'The solid rear wing opens as well');
  rear.dispose();
});


test('independent solid-core rooms also expose their floor when their storey is selected', () => {
  const shape = { outer: [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], holes: [] };
  const room = { outer: [[2, 2], [5, 2], [5, 6], [2, 6], [2, 2]], holes: [], partId: 'main', startFloor: 2 };
  const geometry = buildingGeometry(shape, 10.8, 3.6, [], [], [], undefined, [room], [], true), object = mesh(geometry);
  assert.equal(up(object, 3, -4, 8.5), undefined, 'The independent room has no solid top cap');
  assert.ok(Math.abs(down(object, 3, -4, 8.5).point.z - 7.45) < 1e-4, 'The room keeps its selected floor');
  assert.ok(new THREE.Raycaster(new THREE.Vector3(3, -4, 8.5), new THREE.Vector3(-1, 0, 0), 0, 1).intersectObject(object).length, 'The room retains its enclosure wall');
  geometry.dispose();
});

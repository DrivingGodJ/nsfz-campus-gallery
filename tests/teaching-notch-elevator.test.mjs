import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingElevatorGeometry, teachingRailGeometry, teachingWindowGeometry } from '../src/architecture-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420');
const shaft = building.solidCores.find(core => core.partId === 'sixth-floor-wing' && core.elevator);
const connector = building.floorCorridors.find(c => c.partId === shaft.partId && 'points' in c);
const vector = p => new THREE.Vector3(p[0], 0, p[1]);
const door = vector(shaft.outer[2]).lerp(vector(shaft.outer[3]), .5);
const approach = vector(connector.points.at(-1));
const along = door.clone().sub(approach).normalize();
const across = new THREE.Vector3(-along.z, 0, along.x);
const down = new THREE.Vector3(0, -1, 0);

function mesh(geometry, extrusion = false) {
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (extrusion) { object.rotation.x = -Math.PI / 2; object.position.y = .12; }
  object.updateMatrixWorld();
  return object;
}
function model(floorHeight, selectedFloor) {
  const info = buildingLevels(building, { floorHeight });
  const cutaway = selectedFloor && selectedFloor * floorHeight;
  const bodies = info.sections.map(section => mesh(buildingGeometry(section, Math.min(section.height, cutaway ?? section.height), floorHeight,
    building.groundPassages, building.floorCorridors.filter(c => c.partId === section.id), building.stairwells.filter(s => s.partId === section.id),
    building.classroomWindows, building.solidCores.filter(c => c.partId === section.id), building.cutouts.filter(c => c.partId === section.id), !!selectedFloor), true));
  const windows = teachingWindowGeometry(building, info.sections, floorHeight, cutaway);
  const details = teachingElevatorGeometry(building, info.sections, floorHeight, cutaway);
  const objects = Object.fromEntries(Object.entries(details).map(([key, geometry]) => [key, mesh(geometry)]));
  const glass = mesh(windows.glass), frames = mesh(windows.frames);
  const rails = mesh(teachingRailGeometry(building, info.sections, floorHeight, cutaway));
  return { info, bodies, objects, glass, rails, dispose() {
    for (const object of [...bodies, ...Object.values(objects), glass, frames, rails]) { object.geometry.dispose(); object.material.dispose(); }
  } };
}

test('the notch elevator is reachable from the existing corridor on all six storeys, without a wall, window or rail across its entrance', () => {
  assert.equal(building.solidCores.filter(core => core.elevator).length, 2, 'The earlier main-wing observation elevator is retained');
  assert.equal(building.solidCores.find(core => core.partId === 'main' && core.elevator).elevator.doorEdge, 3);
  assert.equal(shaft.elevator.doorEdge, 2, 'The new elevator door faces the short link into the courtyard corridor');
  for (const floorHeight of [3.6, 4.2]) for (const selectedFloor of [undefined, 3]) {
    const { info, bodies, glass, rails, dispose } = model(floorHeight, selectedFloor);
    const section = info.sections.find(section => section.id === shaft.partId);
    assert.equal(section.floors, 6);
    for (let floor = 0; floor < (selectedFloor ?? section.floors); floor++) {
      for (const offset of [-.6, 0, .6]) {
        const start = approach.clone().addScaledVector(across, offset); start.y = .12 + floor * floorHeight + 1.3;
        const ray = new THREE.Raycaster(start, along, 0, approach.distanceTo(door) - .08);
        assert.equal(ray.intersectObjects(bodies).length, 0, `No concrete blocks floor ${floor + 1}'s door approach`);
        assert.equal(ray.intersectObject(glass).length, 0, 'No classroom pane closes the entrance');
        assert.equal(ray.intersectObject(rails).length, 0, 'The courtyard railing leaves the connection open');
      }
      for (const t of [.03, .25, .5, .75, .97]) for (const offset of [-.84, 0, .84]) {
        const start = approach.clone().lerp(door, t).addScaledVector(across, offset); start.y = .12 + floor * floorHeight + 1.3;
        const hit = new THREE.Raycaster(start, down, 0, 1.4).intersectObjects(bodies)[0];
        assert.ok(hit, 'The complete width of the connection has a continuous floor');
        assert.ok(Math.abs(hit.point.y - (.12 + floor * floorHeight + .25)) < 1e-4, 'The landing meets the existing floor without a step or gap');
      }
    }
    dispose();
  }
});

test('the new observation elevator has transparent sides and paired doors only on the corridor-facing side', () => {
  const center = vector(shaft.outer[0]).lerp(vector(shaft.outer[2]), .5);
  for (const floorHeight of [3.6, 4.2]) for (const selectedFloor of [undefined, 3]) {
    const { bodies, objects, dispose } = model(floorHeight, selectedFloor);
    for (let floor = 0; floor < (selectedFloor ?? 6); floor++) for (let edge = 0; edge < 4; edge++) {
      const a = vector(shaft.outer[edge]), b = vector(shaft.outer[edge + 1]);
      const direction = b.clone().sub(a).normalize(), normal = new THREE.Vector3(-direction.z, 0, direction.x);
      const point = a.clone().lerp(b, .35).addScaledVector(normal, -.2); point.y = .12 + floor * floorHeight + 1.3;
      const ray = new THREE.Raycaster(point, normal, 0, .4);
      assert.ok(ray.intersectObjects([objects.glass, objects.doors]).length, `Side ${edge} has a glass pane on floor ${floor + 1}`);
      assert.equal(ray.intersectObject(objects.doors).length > 0, edge === 2, 'Door leaves appear only towards the corridor');
      assert.equal(ray.intersectObjects(bodies).length, 0, 'Concrete does not overlap the glass shaft');
    }
    for (let floor = 0; floor < (selectedFloor ?? 6); floor++) {
      center.y = .12 + (floor + .5) * floorHeight;
      const hits = new THREE.Raycaster(center, down).intersectObjects(bodies);
      assert.ok(hits.length && Math.abs(hits[0].point.y - .37) < 1e-4, 'Intermediate classroom slabs do not divide the elevator shaft');
    }
    for (const object of Object.values(objects)) {
      object.geometry.computeBoundingBox();
      assert.ok(object.geometry.boundingBox.max.y < .12 + (selectedFloor ?? 6) * floorHeight, 'Glazing and doors stop below the current roof or floor cut');
      assert.ok(object.geometry.userData.photoOcclusionMask.every(value => value === 0), 'Transparent details do not hide photo markers');
    }
    center.y = 100;
    const cap = new THREE.Raycaster(center, down).intersectObjects(bodies)[0];
    assert.ok(Math.abs(cap.point.y - (selectedFloor ? .37 : .12 + 6 * floorHeight)) < 1e-4, 'The complete model has a roof; selecting a floor removes its ceiling');
    dispose();
  }
});

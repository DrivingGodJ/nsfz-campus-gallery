import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { buildingSkylightGeometry, SKYLIGHT_BASE, SKYLIGHT_THICKNESS } from '../src/skylight-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const building = campus.buildings.find(building => building.id === 'way/855459420');
const center = ring => ring.slice(0, 4).reduce((sum, point) => [sum[0] + point[0] / 4, sum[1] + point[1] / 4], [0, 0]);
const down = point => new THREE.Raycaster(new THREE.Vector3(point[0], 100, point[1]), new THREE.Vector3(0, -1, 0));
function mesh(geometry, localExtrusion = false) {
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  if (localExtrusion) { result.rotation.x = -Math.PI / 2; result.position.y = .12; }
  result.updateMatrixWorld();
  return result;
}
const dispose = meshes => meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
const disposeRoofs = roofs => roofs.forEach(roof => { roof.glass.dispose(); roof.frame.dispose(); });

test('the two atriums are inside the corresponding wings, with only the wider main atrium covered', () => {
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus, 'Openings and skylight persist after a map refresh');
  assert.equal(building.parts.length, 2);
  assert.deepEqual(building.holes, building.parts.flatMap(part => part.holes));
  assert.ok(building.parts.every(part => part.holes.length === 1));
  assert.deepEqual(building.skylights.map(roof => roof.partId), ['main']);
  const [main, wing] = building.parts;
  for (const part of [main, wing]) assert.deepEqual(polygonClipping.difference([part.holes[0]], [part.outer]), [], 'The opening stays inside its own wing');
  const [a, b] = [main.outer[20], main.outer[19]], axis = new THREE.Vector2(b[0] - a[0], b[1] - a[1]).normalize();
  for (const part of [main, wing]) {
    const [p, q] = part.holes[0], edge = new THREE.Vector2(q[0] - p[0], q[1] - p[1]).normalize();
    assert.ok(Math.abs(edge.dot(axis)) > .999999, 'Courtyards align with the building rather than world axes');
  }
  const width = ring => Math.hypot(ring[1][0] - ring[0][0], ring[1][1] - ring[0][1]);
  assert.ok(width(main.holes[0]) > width(wing.holes[0]));
  assert.ok(center(main.holes[0])[0] > main.outer[20][0] && center(wing.holes[0])[0] < main.outer[20][0], 'The glass courtyard is on the broad main wing; the open courtyard is on the opposite projecting wing');
});

test('both courtyards are hollow from ground to roof, including floor cutaways, with inward facing walls', () => {
  for (const override of [{ floors: 5, floorHeight: 3.6 }, { floors: 7, floorHeight: 4.2, partFloors: { 'sixth-floor-wing': 4 } }]) {
    const info = buildingLevels(building, override);
    for (const floor of [undefined, 1, 3]) {
      const meshes = info.sections.map(section => mesh(buildingGeometry(section, floor ? Math.min(section.height, floor * info.floorHeight) : section.height, info.floorHeight, building.groundPassages, building.floorCorridors?.filter(corridor => corridor.partId === section.id)), true));
      for (const part of info.sections) {
        const hole = part.holes[0], middle = center(hole);
        for (const u of [.15, .5, .85]) for (const v of [.15, .5, .85]) {
          const point = [0, 1].map(d => hole[0][d] + (hole[1][d] - hole[0][d]) * u + (hole[3][d] - hole[0][d]) * v);
          assert.equal(down(point).intersectObjects(meshes, false).length, 0, 'No roof or solid floor remains inside either opening');
        }
        // The courtyard corridors recess the rear wall by three metres.
        const edge = [0, 1].map(d => (hole[2][d] + hole[3][d]) / 2), towardWall = new THREE.Vector3(edge[0] - middle[0], 0, edge[1] - middle[1]).normalize();
        for (const level of [.5, ...floor === 1 ? [] : [1.5]]) {
          const ray = new THREE.Raycaster(new THREE.Vector3(middle[0], .12 + info.floorHeight * level, middle[1]), towardWall);
          const hit = ray.intersectObjects(meshes, false)[0];
          assert.ok(hit && Math.abs(Math.hypot(hit.point.x - edge[0], hit.point.z - edge[1]) - 3) < 1e-4, 'Recessed courtyard back walls are visible from inside at the lower and upper floors');
        }
      }
      dispose(meshes);
    }
  }
});

test('the glass roof covers only the main hole and follows its section height without capping lower floor views', () => {
  for (const override of [{ floors: 5, floorHeight: 3.6 }, { floors: 3, floorHeight: 4.2, partFloors: { 'sixth-floor-wing': 7 } }]) {
    const info = buildingLevels(building, override), main = info.sections.find(section => section.id === 'main');
    const roofs = buildingSkylightGeometry(building, info.sections);
    assert.equal(roofs.length, 1);
    const glass = mesh(roofs[0].glass), frame = mesh(roofs[0].frame);
    for (const roofMesh of [glass, frame]) {
      roofMesh.geometry.computeBoundingBox();
      assert.ok(roofMesh.geometry.boundingBox.max.y < SKYLIGHT_BASE + main.height + .2, 'Roof height follows the covered main wing, not the taller secondary wing');
    }
    const covered = down(center(main.holes[0])).intersectObject(glass)[0];
    assert.ok(covered);
    assert.ok(Math.abs(covered.point.y - SKYLIGHT_BASE - main.height - .03 - SKYLIGHT_THICKNESS) < 1e-4);
    assert.equal(down(center(info.sections.find(section => section.id !== 'main').holes[0])).intersectObjects([glass, frame], false).length, 0, 'The smaller courtyard stays open');
    assert.deepEqual(buildingSkylightGeometry(building, info.sections, main.height - info.floorHeight), [], 'A lower floor view has no relocated glass roof');
    const topFloor = buildingSkylightGeometry(building, info.sections, main.height);
    assert.equal(topFloor.length, 0, 'Selecting the top floor also removes its glass ceiling');
    disposeRoofs(topFloor);
    dispose([glass, frame]);
  }
});

test('courtyard walls retain their orientation when polygon clipping or imported rings reverse winding', () => {
  const info = buildingLevels(building), section = info.sections[0], hole = section.holes[0], middle = center(hole);
  const edge = [0, 1].map(d => (hole[0][d] + hole[1][d]) / 2), direction = new THREE.Vector3(edge[0] - middle[0], 0, edge[1] - middle[1]).normalize();
  for (const ring of [hole, [...hole].reverse()]) {
    const body = mesh(buildingGeometry({ ...section, holes: [ring] }, section.height, info.floorHeight, building.groundPassages), true);
    for (const level of [.5, 1.5]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(middle[0], .12 + info.floorHeight * level, middle[1]), direction);
      const hit = ray.intersectObject(body)[0];
      assert.ok(hit && Math.hypot(hit.point.x - edge[0], hit.point.z - edge[1]) < 1e-4);
    }
    dispose([body]);
  }
});

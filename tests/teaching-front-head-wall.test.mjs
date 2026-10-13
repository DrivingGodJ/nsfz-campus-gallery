import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { teachingStairGeometry } from '../src/teaching-stairs.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420');
const main = building.parts.find(p => p.id === 'main');
const from = main.outer[8], to = building.classroomWindows.groundBlindFacadeLines[0].at(-1);
const along = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
const inward = new THREE.Vector3(-along.z, 0, along.x);
const at = (t, depth, y) => new THREE.Vector3(from[0], y, from[1]).lerp(new THREE.Vector3(to[0], y, to[1]), t).addScaledVector(inward, depth);
const wall = building.solidCores.find(c => c.partition && c.startFloor === 2 && c.outer[0][0] === from[0] && c.outer[0][1] === from[1]);
const without = { ...building, solidCores: building.solidCores.filter(c => c !== wall) };
const mesh = (geometry, extruded = false) => {
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (extruded) { result.rotation.x = -Math.PI / 2; result.position.y = .12; }
  result.updateMatrixWorld(); return result;
};
function body(b, section, info, selectedFloor) {
  const height = selectedFloor ? selectedFloor * info.floorHeight : section.height;
  return buildingGeometry(section, height, info.floorHeight, b.groundPassages, b.floorCorridors.filter(c => c.partId === section.id),
    b.stairwells.filter(s => s.partId === section.id), section.classroomWindows ?? b.classroomWindows,
    b.solidCores.filter(c => c.partId === section.id), b.cutouts.filter(c => c.partId === section.id), !!selectedFloor);
}

test('the red-marked front stair head is opaque above ground while the first floor and stairs remain unchanged', () => {
  assert.ok(wall, 'The saved wall follows the marked straight head face');
  assert.deepEqual(corrections.buildings.find(b => b.id === building.id).solidCores, building.solidCores, 'Map refresh preserves the closure');
  for (const [floorHeight, selectedFloor] of [[3.6, undefined], [3.6, 1], [3.6, 3], [3.6, 5], [4.2, undefined]]) {
    const info = buildingLevels(building, { floors: 5, floorHeight }), section = info.sections.find(p => p.id === 'main');
    const current = mesh(body(building, section, info, selectedFloor), true), old = mesh(body(without, section, info, selectedFloor), true);
    for (let floor = 0; floor < (selectedFloor ?? section.floors); floor++) for (const rise of [.55, 1.6, 3.3]) {
      const y = .12 + floor * floorHeight + rise;
      for (const t of [.005, .2, .5, .8, .995]) {
        const ray = new THREE.Raycaster(at(t, -.4, y), inward, 0, .9), hit = ray.intersectObject(current)[0];
        assert.equal(!!hit, floor > 0, 'Every occupied upper floor is sealed and the ground face is still open');
        if (hit) {
          assert.ok(Math.abs(hit.distance - .4) < 1e-4, 'The face stays on the original facade line');
          assert.equal(current.geometry.userData.photoOcclusionMask[hit.faceIndex], 1, 'The new wall is opaque masonry');
          const inside = new THREE.Raycaster(at(t, .7, y), inward.clone().negate(), 0, .9).intersectObject(current)[0];
          if (t > .01 && t < .99) assert.ok(inside && Math.abs(inside.distance - .42) < 1e-4, `The inside face keeps the existing 0.28 metre wall thickness: ${floorHeight}/${selectedFloor}/${floor}/${rise}/${t}: ${inside?.distance}`);
        }
      }
      // Follow the existing first stair well inside the marked facade, away from its closure.
      const passage = new THREE.Raycaster(at(.5, 1, y), inward, 0, 1.5);
      assert.deepEqual(passage.intersectObject(current).map(h => h.distance), passage.intersectObject(old).map(h => h.distance), 'The inner stair space is preserved');
    }
    const windows = teachingWindowGeometry(building, info.sections, floorHeight, selectedFloor && selectedFloor * floorHeight);
    const oldWindows = teachingWindowGeometry(without, info.sections, floorHeight, selectedFloor && selectedFloor * floorHeight);
    for (const key of ['glass', 'frames']) assert.deepEqual(windows[key].getAttribute('position').array, oldWindows[key].getAttribute('position').array, 'Unmarked windows and frames remain exactly unchanged');
    const stairs = teachingStairGeometry(building, info.sections, floorHeight, selectedFloor && selectedFloor * floorHeight);
    const oldStairs = teachingStairGeometry(without, info.sections, floorHeight, selectedFloor && selectedFloor * floorHeight);
    for (const key of ['concrete', 'rails']) assert.deepEqual(stairs[key].getAttribute('position').array, oldStairs[key].getAttribute('position').array, 'All existing stair flights and guards remain unchanged');
    for (const o of [current, old]) { o.geometry.dispose(); o.material.dispose(); }
    for (const batch of [windows, oldWindows, stairs, oldStairs]) Object.values(batch).forEach(g => g.dispose());
  }
});

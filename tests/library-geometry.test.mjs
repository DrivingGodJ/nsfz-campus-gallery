import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const library = campus.buildings.find(building => building.id === 'way/855459419');

test('the library keeps its full footprint and five-storey main body with a three-storey curved annex', () => {
  assert.deepEqual(applyCampusCorrections(campus, corrections).buildings.find(building => building.id === library.id), library);
  const [main, annex] = library.parts;
  assert.deepEqual(polygonClipping.union([main.outer], [annex.outer]), polygonClipping.union([library.outer]));
  assert.deepEqual(polygonClipping.intersection([main.outer], [annex.outer]), []);
  assert.deepEqual([main.outer[0], main.outer.at(-2)], [annex.outer.at(-2), annex.outer[0]], 'Both volumes meet along the same exact seam');
  assert.deepEqual(buildingLevels(library).sections.map(section => section.floors), [5, 3]);

  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  try {
    for (const floorHeight of [3.6, 4.2]) for (const selectedFloor of [undefined, 3, 4]) {
      const info = buildingLevels(library, { floors: 5, floorHeight });
      const cutoff = selectedFloor === undefined ? undefined : selectedFloor * floorHeight;
      for (const section of info.sections) {
        const height = Math.min(section.height, cutoff ?? section.height);
        const cutaway = cutoff !== undefined && cutoff <= section.height + 1e-6;
        const geometry = buildingGeometry(section, height, floorHeight, [], [], [], undefined, [], [], cutaway);
        const body = new THREE.Mesh(geometry, material);
        body.rotation.x = -Math.PI / 2; body.position.y = .12; body.updateMatrixWorld();
        const point = section.id === 'main' ? [50, 128] : [50, 104];
        const hit = new THREE.Raycaster(new THREE.Vector3(point[0], 100, point[1]), new THREE.Vector3(0, -1, 0)).intersectObject(body)[0];
        const expectedTop = .12 + (cutaway ? (selectedFloor - 1) * floorHeight + .25 : section.height);
        assert.ok(hit && Math.abs(hit.point.y - expectedTop) < 1e-4, 'The annex ends at its third-floor roof, which is removed only when its own top storey is selected');
        geometry.dispose();
      }
    }
  } finally { material.dispose(); }
});

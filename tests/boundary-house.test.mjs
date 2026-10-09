import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { boundaryHouseGeometry } from '../src/boundary-house-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

test('photographed boundary house stays clear of the memorial, has a visible solid door and loses its roof on floor selection', async () => {
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  const house = campus.buildings.find(b => b.id === 'local/boundary-house'), memorial = campus.buildings.find(b => b.id === 'way/855459421');
  assert.deepEqual(applyCampusCorrections({ ...campus, buildings: campus.buildings.filter(b => b.id !== house.id) }, corrections).buildings.find(b => b.id === house.id), house);
  assert.deepEqual(polygonClipping.intersection([house.outer], [memorial.outer]), [], 'The new roofed house does not replace or intersect the museum');
  const levels = buildingLevels(house);
  assert.equal(levels.floors, 1);
  assert.equal(levels.floorHeight, 3.15, 'A low one-storey house uses its calibrated height without changing any photo parameters');
  assert.equal(buildingLevels(house, { floors: 1, floorHeight: 3.5 }).height, 3.5, 'Editor height overrides retain priority');
  assert.equal(house.classroomWindows, null, 'Unconfirmed windows remain absent');
  const [a, b] = house.outer, width = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const front = new THREE.Vector3((a[0] + b[0]) / 2, 1.12, (a[1] + b[1]) / 2);
  const outward = new THREE.Vector3(-(b[1] - a[1]) / width, 0, (b[0] - a[0]) / width);
  for (const cutaway of [false, true]) {
    const model = boundaryHouseGeometry(house, levels.height, cutaway);
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    try {
      const walls = new THREE.Mesh(model.walls, material), door = new THREE.Mesh(model.door, material);
      const ray = new THREE.Raycaster(front.clone().addScaledVector(outward, 1), outward.clone().negate(), 0, 1.3);
      assert.equal(ray.intersectObject(walls).length, 0, 'The doorway is cut through the shell');
      assert.ok(ray.intersectObject(door).length, 'The recessed red leaf occupies the opening');
      const jambRay = new THREE.Raycaster(front.clone().add(new THREE.Vector3((b[0] - a[0]) / width, 0, (b[1] - a[1]) / width)).addScaledVector(outward, 1), outward.clone().negate(), 0, 1.3);
      assert.ok(jambRay.intersectObject(walls).length, 'The grey-brick jamb remains solid');
      assert.equal(model.roof.getAttribute('position').count > 0, !cutaway, 'Floor selection removes the roof and eaves');
      assert.equal(model.eaves.getAttribute('position').count > 0, !cutaway);
      for (const geometry of Object.values(model)) {
        const positions = geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) assert.ok(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i)));
      }
    } finally { material.dispose(); Object.values(model).forEach(geometry => geometry.dispose()); }
  }
});

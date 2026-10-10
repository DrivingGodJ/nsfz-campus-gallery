import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { luxunMemorialGeometry, luxunMemorialLayout } from '../src/luxun-memorial-geometry.ts';

test('memorial arcade has real through arches, an unobstructed covered ground passage and no invented glazing', async () => {
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const building = campus.buildings.find(b => b.id === 'way/855459421'), layout = luxunMemorialLayout(building), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const floorHeight = building.floorHeight, height = building.floors * floorHeight;
  assert.ok(layout.length / layout.bays > 2.3 && layout.length / layout.bays < 2.7, 'Pillar spacing follows the narrow photographed bays');
  const point = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(layout.transform);
  const direction = new THREE.Vector3().setFromMatrixColumn(layout.transform, 0);
  for (const cutaway of [undefined, floorHeight, height]) {
    const geometry = luxunMemorialGeometry(building, height, floorHeight, cutaway);
    try {
      const ray = new THREE.Raycaster(point(-1, 1.6, -layout.corridor / 2), direction, 0, layout.length + 2);
      assert.equal(ray.intersectObject(new THREE.Mesh(geometry.brick, material)).length, 0, 'Sight line passes through both end arches and the entire south corridor');
      const outward = new THREE.Vector3().setFromMatrixColumn(layout.transform, 2);
      const upperRay = new THREE.Raycaster(point(layout.length / layout.bays / 2, floorHeight * 1.6, 1), outward.clone().negate(), 0, 1.7);
      assert.equal(upperRay.intersectObject(new THREE.Mesh(geometry.brick, material)).length, 0, 'Upper arcade is a rounded opening rather than a painted panel');
      assert.equal(geometry.roof.getAttribute('position').count > 0, cutaway === undefined);
      assert.equal(geometry.tiles.getAttribute('position').count > 0, cutaway === undefined);
      assert.equal('glass' in geometry, false);
      for (const g of Object.values(geometry)) {
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
        if (cutaway !== undefined && p.count) { g.computeBoundingBox(); assert.ok(g.boundingBox.max.y <= cutaway + .13); }
      }
    } finally { Object.values(geometry).forEach(g => g.dispose()); }
  }
  material.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { printRoomGeometry, printRoomLayout } from '../src/print-room-geometry.ts';

test('print room has a low tiled roof, a solid brick shell and a south-end plaque, including cutaway views', () => {
  const room = { outer: [[162.1, 51.5], [160.725, 34.35], [163.516, 34.126], [164.891, 51.276], [162.1, 51.5]], holes: [] };
  const layout = printRoomLayout(room, 3.4);
  const outward = new THREE.Vector3((room.outer[1][1] - room.outer[0][1]) / layout.length, 0, -(room.outer[1][0] - room.outer[0][0]) / layout.length);
  const front = new THREE.Vector3(0, 1.5, 0).applyMatrix4(layout.transform);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const cutaway of [false, true]) {
    const model = printRoomGeometry(room, 3.4, cutaway);
    try {
      model.walls.computeBoundingBox();
      for (const [axis, coordinate] of [['x', 0], ['z', 1]]) {
        assert.ok(Math.abs(model.walls.boundingBox.min[axis] - Math.min(...room.outer.map(p => p[coordinate]))) < .02, 'The shell stays inside the proposed footprint');
        assert.ok(Math.abs(model.walls.boundingBox.max[axis] - Math.max(...room.outer.map(p => p[coordinate]))) < .02);
      }
      const ray = new THREE.Raycaster(front.clone().addScaledVector(outward, 1), outward.clone().negate(), 0, 2);
      assert.ok(ray.intersectObject(new THREE.Mesh(model.walls, material)).length, 'Unconfirmed windows and doorways do not perforate the brick wall');
      assert.equal(model.roof.getAttribute('position').count > 0, !cutaway);
      assert.equal(model.tiles.getAttribute('position').count > 0, !cutaway);
      assert.equal(model.eaves.getAttribute('position').count > 0, !cutaway);
      model.plaque.computeBoundingBox();
      assert.ok(model.plaque.boundingBox.min.z > 48, 'The sign is near the south end facing campus');
      for (const geometry of Object.values(model)) {
        const positions = geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) assert.ok(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i)));
      }
      if (!cutaway) {
        model.roof.computeBoundingBox();
        assert.ok(model.roof.boundingBox.max.y < 3.6 && model.roof.boundingBox.min.y > 2.5, 'The roof stays on a modest single storey');
        assert.ok(model.roof.boundingBox.min.z < 34.126 && model.roof.boundingBox.max.z > 51.5, 'Eaves overhang both ends');
      }
    } finally { Object.values(model).forEach(part => part.dispose()); }
  }
  material.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildingWallTriangles } from '../src/building-geometry.ts';

// Independent reference uses the previous Three.js extrusion path. Retain its
// exact face order and winding so normals, edge welding and occlusion stay put.
test('direct wall emission matches extrusions for concave contours, courtyards and small seams', () => {
  const outer = [[120, 30], [132, 30], [132, 35], [125, 35], [125, 42], [120, 42], [120, 30]];
  const hole = [[121, 31], [121, 34], [124, 34], [124, 31], [121, 31]];
  for (const data of [
    { outer, holes: [hole] },
    { outer: [...outer].reverse(), holes: [[...hole].reverse()] },
    { outer: [[120, 30], [120 + 1e-11, 30], ...outer.slice(1)], holes: [hole] },
  ]) {
    const points = data.outer.map(([x, z]) => new THREE.Vector2(x, -z));
    if (!THREE.ShapeUtils.isClockWise(points)) points.reverse();
    const shape = new THREE.Shape(points);
    shape.holes = data.holes.map(ring => {
      const points = ring.map(([x, z]) => new THREE.Vector2(x, -z));
      if (THREE.ShapeUtils.isClockWise(points)) points.reverse();
      return new THREE.Path(points);
    });
    const reference = new THREE.ExtrudeGeometry(shape, { depth: 3.6, bevelEnabled: false });
    try {
      const position = reference.getAttribute('position'), walls = [];
      for (let i = 0; i < position.count; i += 3) {
        if (position.getZ(i) === position.getZ(i + 1) && position.getZ(i) === position.getZ(i + 2)) continue;
        for (let k = 0; k < 3; k++) walls.push(position.getX(i + k), position.getY(i + k), position.getZ(i + k));
      }
      assert.deepEqual(buildingWallTriangles(data, 3.6), walls);
    } finally { reference.dispose(); }
  }
});

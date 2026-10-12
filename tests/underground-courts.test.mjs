import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { undergroundLayout } from '../src/underground-geometry.ts';
import { undergroundBadmintonLayout, undergroundDetailGeometry, undergroundRoomFrame } from '../src/underground-details.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const area = undergroundLayout(campus.features).areas.get('local/underground-badminton');
const frame = undergroundRoomFrame(area.feature), origin = area.feature.outer[0];
const local = (x, z) => [frame.across[0] * (x - origin[0]) + frame.across[1] * (z - origin[1]),
  frame.along[0] * (x - origin[0]) + frame.along[1] * (z - origin[1])];
const bounds = (geometry, start, count) => {
  const points = geometry.attributes.position;
  const projected = Array.from({ length: count }, (_, i) => local(points.getX(start + i), points.getZ(start + i)));
  return [0, 1].map(axis => [Math.min(...projected.map(p => p[axis])), Math.max(...projected.map(p => p[axis]))]);
};
const close = (value, expected) => assert.ok(Math.abs(value - expected) < 5e-5, `${value} ~= ${expected}`);

test('twenty complete badminton courts run across the hall in two rows, with clear doors, central aisle and timber bay', () => {
  const before = JSON.stringify(area.feature), layout = undergroundBadmintonLayout(frame);
  const model = undergroundDetailGeometry(area.feature, area.footprints, area.openings);
  const courts = [];
  const timber = [[[10, frame.length - 13], [25, frame.length - 13], [25, frame.length - 3], [10, frame.length - 3], [10, frame.length - 13]]];
  assert.equal(layout.rows, 2); assert.equal(layout.cols, 10); assert.equal(layout.centers.length, 20);
  assert.equal(model.nets.attributes.position.count, 20 * 36, 'Each court retains a separate net');
  try {
    for (const [i, [u, v]] of layout.centers.entries()) {
      const net = bounds(model.nets, i * 36, 36);
      close(net[0][1] - net[0][0], .014);
      close(net[1][1] - net[1][0], 6.4);
      close((net[0][0] + net[0][1]) / 2, u);
      close((net[1][0] + net[1][1]) / 2, v);
      const lines = bounds(model.paint, i * 13 * 36, 12 * 36);
      close(lines[0][1] - lines[0][0], 13.44);
      close(lines[1][1] - lines[1][0], 6.14);
      // The first four are both doubles and singles sidelines. Their long
      // spans must follow the hall's short axis, independent of its rotation.
      for (let edge = 0; edge < 4; edge++) {
        const side = bounds(model.paint, (i * 13 + edge) * 36, 36);
        close(side[0][1] - side[0][0], 13.4);
        close(Math.abs((side[1][0] + side[1][1]) / 2 - v), edge < 2 ? 3.05 : 2.59);
      }
      for (const [axis, dimension] of [[0, frame.width], [1, frame.length]]) {
        assert.ok(lines[axis][0] > 0 && lines[axis][1] < dimension, 'Actual painted lines stay inside the hall');
        assert.ok(net[axis][0] > 0 && net[axis][1] < dimension, 'Actual nets stay inside the hall');
      }
      const ring = [[u - 6.7, v - 3.05], [u + 6.7, v - 3.05], [u + 6.7, v + 3.05], [u - 6.7, v + 3.05], [u - 6.7, v - 3.05]];
      for (const other of courts) assert.deepEqual(polygonClipping.intersection([ring], [other]), [], 'Court playing areas never overlap');
      assert.deepEqual(polygonClipping.intersection([ring], timber), [], 'The existing timber multipurpose bay stays clear');
      assert.ok(u + 6.7 <= frame.width / 2 - 1 + 1e-8 || u - 6.7 >= frame.width / 2 + 1 - 1e-8, 'A 2 m central aisle remains');
      courts.push(ring);
    }
    for (let i = 0; i < 20 * 192; i++) {
      const positions = model.wood.attributes.position, [u, v] = local(positions.getX(i), positions.getZ(i));
      assert.ok(u > 0 && u < frame.width && v > 0 && v < frame.length - 13, 'Net posts and feet also stay inside, clear of the timber bay');
    }
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const objects = ['nets', 'wood'].map(kind => { const object = new THREE.Mesh(model[kind], material); object.updateMatrixWorld(); return object; });
    for (const opening of area.openings) {
      const p = opening[0].map((n, i) => (n + opening[1][i]) / 2);
      const normal = new THREE.Vector3(opening[1][1] - opening[0][1], 0, opening[0][0] - opening[1][0]).normalize();
      for (const sign of [-1, 1]) assert.equal(new THREE.Raycaster(new THREE.Vector3(p[0], area.feature.height + 1.2, p[1]), normal.clone().multiplyScalar(sign), 0, 3).intersectObjects(objects).length, 0, 'Court fittings leave both original hall doors clear');
    }
    material.dispose();
    assert.equal(JSON.stringify(area.feature), before, 'Hall dimensions and door data remain unchanged');
  } finally { Object.values(model).forEach(geometry => geometry.dispose()); }
});

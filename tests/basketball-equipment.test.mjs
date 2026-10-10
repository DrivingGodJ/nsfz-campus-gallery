import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { basketballEquipment, basketballGeometry } from '../src/basketball-geometry.ts';
import { basketballFenceGeometry } from '../src/basketball-fence-geometry.ts';
import { passageFootprint } from '../src/underground-geometry.ts';

const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
const campus = await read('public/data/campus.json');
const feature = campus.features.find(item => item.type === 'basketballCourts'), layout = feature.courts;
const polygon = shape => [shape.outer, ...(shape.holes || [])];
const local = ([x, z]) => [(x - layout.center[0]) * layout.axis[1] - (z - layout.center[1]) * layout.axis[0],
  (x - layout.center[0]) * layout.axis[0] + (z - layout.center[1]) * layout.axis[1]];
const vector = ([x, z], y = 0) => new THREE.Vector3(x, y, z);
const mesh = (geometry, material) => { const object = new THREE.Mesh(geometry, material); object.updateMatrixWorld(); return object; };
const triangles = geometry => (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
const finite = geometry => {
  assert.ok([...geometry.getAttribute('position').array].every(Number.isFinite));
  if (geometry.getAttribute('normal')) assert.ok([...geometry.getAttribute('normal').array].every(Number.isFinite));
};
const distanceToSegment = (p, a, b) => {
  const direction = b.map((n, i) => n - a[i]), lengthSquared = direction[0] ** 2 + direction[1] ** 2;
  const t = Math.max(0, Math.min(1, p.reduce((sum, n, i) => sum + (n - a[i]) * direction[i], 0) / lengthSquared));
  return Math.hypot(...p.map((n, i) => n - a[i] - direction[i] * t));
};

test('each painted court has two usable standard-height baskets, with inward-facing boards and real open hoops and hanging nets', () => {
  const before = JSON.stringify(layout), equipment = basketballEquipment(layout), courts = basketballGeometry(layout);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const objects = Object.fromEntries(['metal', 'bases', 'glass', 'rims', 'nets'].map(name => [name, mesh(equipment[name], material)]));
  const down = new THREE.Vector3(0, -1, 0), across = vector([layout.axis[1], -layout.axis[0]]);
  try {
    assert.equal(equipment.baskets.length, courts.length * 2);
    assert.equal(new Set(equipment.baskets.map(basket => `${basket.courtIndex}:${basket.end}`)).size, courts.length * 2);
    for (let index = 0; index < courts.length; index++) {
      assert.deepEqual(equipment.baskets.filter(basket => basket.courtIndex === index).map(basket => basket.end).sort(), [-1, 1]);
    }
    for (const basket of equipment.baskets) {
      const court = courts[basket.courtIndex], inward = vector(basket.inward), ring = new THREE.Vector3(...basket.ring);
      assert.ok(Math.abs(inward.length() - 1) < 1e-7);
      assert.ok(vector(court.center).sub(vector(basket.baseline)).dot(inward) > 10, 'The basket faces its own playing court');
      const boundary = court.surface.outer, baseline = basket.end < 0 ? boundary.slice(0, 2) : boundary.slice(2, 4);
      assert.ok(distanceToSegment(basket.baseline, ...baseline) < 1e-7, 'The basket is centered on its actual painted baseline');
      assert.ok(Math.abs(vector([ring.x, ring.z]).sub(vector(basket.baseline)).dot(inward) - 1.575) < 1e-6);
      assert.ok(Math.abs(ring.y - 3.21) < 1e-6, 'The rim center is 3.05 m above the 0.16 m playing surface');
      const marks = court.marks.filter(mark => mark.points.length === 65).map(mark => {
        const points = mark.points.slice(0, -1), center = points.reduce((sum, p) => sum.map((n, i) => n + p[i] / points.length), [0, 0]);
        return { center, radius: Math.hypot(mark.points[0][0] - center[0], mark.points[0][1] - center[1]) };
      }).filter(mark => mark.radius < 1);
      assert.ok(marks.some(mark => Math.hypot(mark.center[0] - ring.x, mark.center[1] - ring.z) < 1e-6), 'The physical hoop aligns with the existing basket circle');
      for (const direction of [across, inward]) for (const sign of [-1, 1]) {
        const above = ring.clone().addScaledVector(direction, sign * .225); above.y = 5;
        const hit = new THREE.Raycaster(above, down, 0, 3).intersectObject(objects.rims)[0];
        assert.ok(hit && Math.abs(hit.point.y - ring.y) < .03, 'The visible hoop occupies the calibrated circle at rim height');
      }
      assert.equal(new THREE.Raycaster(ring.clone().setY(5), down, 0, 3).intersectObject(objects.rims).length, 0, 'The hoop center remains an open hole rather than a solid disk');
      const board = new THREE.Vector3(...basket.boardCenter);
      assert.ok(Math.abs(vector([board.x, board.z]).sub(vector(basket.baseline)).dot(inward) - 1.2) < 1e-6);
      for (const offset of [0, -.8, .8]) {
        const eye = board.clone().addScaledVector(across, offset).addScaledVector(inward, 2);
        const hit = new THREE.Raycaster(eye, inward.clone().negate(), 0, 2.2).intersectObject(objects.glass)[0];
        assert.ok(hit && hit.face.normal.dot(inward) > .999, 'The broad front face of each backboard faces into its court');
        assert.ok(Math.abs(hit.distance - 2) < .05, 'The board is near its calibrated plane, with only thin glass thickness');
      }
      const support = vector(basket.support, 1.6), supportHit = new THREE.Raycaster(support.clone().addScaledVector(across, 1), across.clone().negate(), 0, 2).intersectObject(objects.metal)[0];
      assert.ok(supportHit && Math.abs(supportHit.distance - 1) < .12, 'A real upright supports each board behind the baseline');
      const baseHit = new THREE.Raycaster(vector(basket.support, 1.5), down, 0, 2).intersectObject(objects.bases)[0];
      assert.ok(baseHit && baseHit.point.y > .5 && baseHit.point.y < .8, 'Every upright has a low outdoor support base');
      const cords = equipment.nets.getAttribute('position'), nearby = [];
      for (let i = 0; i < cords.count; i++) {
        if (Math.hypot(cords.getX(i) - ring.x, cords.getZ(i) - ring.z) < .28 && cords.getY(i) < ring.y) nearby.push(cords.getY(i));
      }
      assert.ok(nearby.length > 30 && Math.min(...nearby) > ring.y - .5 && Math.min(...nearby) < ring.y - .35, 'Open hanging cords reach below each rim instead of becoming a solid cone');
      let netHits = 0;
      for (let i = 0; i < 72; i++) {
        const angle = i * Math.PI / 36, ray = new THREE.Raycaster(ring.clone().add(new THREE.Vector3(0, -.21, 0)), new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), 0, .3);
        if (ray.intersectObject(objects.nets).length) netHits++;
      }
      assert.ok(netHits > 0 && netHits < 54, 'Actual rays meet hanging cords while most directions pass through open mesh gaps');
    }
    let count = 0;
    for (const name of ['metal', 'bases', 'glass', 'rims', 'nets']) { finite(equipment[name]); count += triangles(equipment[name]); }
    assert.ok(count < 6000, 'All eight baskets reuse five modest merged meshes');
    equipment.bases.computeBoundingBox();
    assert.ok(Math.abs(equipment.bases.boundingBox.min.y - .16) < 1e-6, 'Support bases rest directly on the existing court surface');
    assert.equal(JSON.stringify(layout), before);
  } finally { material.dispose(); ['metal', 'bases', 'glass', 'rims', 'nets'].forEach(name => equipment[name].dispose()); }
});

test('basket bases remain outside playable courts and keep the single fence, entrances, aircraft, flag platform and buildings clear', async () => {
  const equipment = basketballEquipment(layout), courts = basketballGeometry(layout);
  const fence = passageFootprint(feature.railEdges[0], .09);
  const obstacles = [
    ...campus.buildings,
    ...campus.features.filter(item => item.aircraft || item.flagPlatform),
    ...campus.features.filter(item => item.type === 'garageEntrance' || item.type === 'tunnelEntrance' || item.type === 'path' && item.points && !item.representedBy)
      .map(item => ({ id: item.id, ...(item.outer ? item : passageFootprint(item.points, item.width || 3)) })),
    { id: 'basketball-fence', ...fence },
  ];
  try {
    for (const basket of equipment.baskets) {
      const base = polygon(basket.base);
      for (const court of courts) assert.equal(clip.intersection(base, polygon(court.surface)).length, 0, 'Support feet never intrude into painted playing rectangles');
      for (const obstacle of obstacles) assert.equal(clip.intersection(base, polygon(obstacle)).length, 0, `Support feet keep ${obstacle.id} clear`);
      assert.equal(clip.difference(base, [campus.boundary]).length, 0);
    }
    assert.deepEqual(applyCampusCorrections(campus, await read('data/campus-corrections.json')), campus, 'The fenced court and nearby display calibration survive map regeneration');
  } finally { ['metal', 'bases', 'glass', 'rims', 'nets'].forEach(name => equipment[name].dispose()); }
});

test('the fine mesh fence appears only along the designated outer southern baseline at the correct ground and top heights', () => {
  assert.deepEqual(feature.railEdges, [[feature.outer[4], feature.outer[5]]]);
  assert.equal(feature.railHeight, 3.8);
  const fence = basketballFenceGeometry(feature), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  try {
    for (const part of Object.values(fence)) finite(part);
    const vertices = fence.wire.getAttribute('position'), wireSides = [];
    assert.ok(vertices.count > 500 && vertices.count % 2 === 0 && vertices.count / 2 < 1100, 'Dense diamond mesh stays one inexpensive line-segment batch');
    for (let i = 0; i < vertices.count; i++) {
      const [across, along] = local([vertices.getX(i), vertices.getZ(i)]);
      assert.ok(Math.abs(along + 16) < 1e-5, 'Every wire lies on the single photographed outer side');
      assert.ok(along < -layout.length / 2 - 1, 'The fence is beyond the playable baseline');
      assert.ok(vertices.getY(i) > .16 && vertices.getY(i) < .16 + feature.railHeight);
      wireSides.push(across);
    }
    const courtsSpan = layout.count * layout.width + (layout.count - 1) * layout.gap;
    assert.ok(Math.max(...wireSides) - Math.min(...wireSides) > courtsSpan, 'The mesh spans all four courts rather than one bay');
    fence.wire.computeBoundingBox(); fence.frame.computeBoundingBox();
    assert.ok(Math.abs(fence.frame.boundingBox.min.y - .16) < .001);
    assert.ok(Math.abs(fence.frame.boundingBox.max.y - (.16 + feature.railHeight)) < .05);
    assert.ok(fence.wire.boundingBox.min.y - .16 < .15 && .16 + feature.railHeight - fence.wire.boundingBox.max.y < .15, 'Mesh reaches close to both the ground frame and the top rail');
    const frameVertices = fence.frame.getAttribute('position');
    for (let i = 0; i < frameVertices.count; i++) assert.ok(Math.abs(local([frameVertices.getX(i), frameVertices.getZ(i)])[1] + 16) < .06, 'No frame wraps around unrequested sides or seals the entrance');
    assert.ok(triangles(fence.frame) < 700, 'All posts and horizontal rails share one small opaque mesh');
    const frame = mesh(fence.frame, material), [a, b] = feature.railEdges[0];
    const middle = a.map((n, i) => (n + b[i]) / 2), eye = vector(middle, .16 + feature.railHeight).addScaledVector(vector(layout.axis), 1);
    const hit = new THREE.Raycaster(eye, vector(layout.axis).negate(), 0, 2).intersectObject(frame)[0];
    assert.ok(hit && Math.abs(hit.distance - 1) < .06, 'The real top rail sits on the selected outer line');
  } finally { material.dispose(); Object.values(fence).forEach(part => part.dispose()); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { basketballEquipment, basketballGeometry } from '../src/basketball-geometry.ts';
import { basketballFenceGeometry } from '../src/basketball-fence-geometry.ts';
import { passageFootprint } from '../src/underground-geometry.ts';
import { curvedStairTreads } from '../src/structure-geometry.ts';

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

test('basket bases remain outside playable courts and keep both fences, entrances, aircraft, flag platform and buildings clear', async () => {
  const equipment = basketballEquipment(layout), courts = basketballGeometry(layout);
  const obstacles = [
    ...campus.buildings,
    ...campus.features.filter(item => item.aircraft || item.flagPlatform),
    ...campus.features.filter(item => item.type === 'garageEntrance' || item.type === 'tunnelEntrance' || item.type === 'path' && item.points && !item.representedBy)
      .map(item => ({ id: item.id, ...(item.outer ? item : passageFootprint(item.points, item.width || 3)) })),
    ...feature.railEdges.map((chain, index) => ({ id: 'basketball-fence-' + index, ...passageFootprint(chain, .09) })),
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

test('the single-panel side fence follows the marked grass margin, leaving the tall southern fence and northern entrance separate', () => {
  assert.deepEqual(feature.railEdges[0], [feature.outer[4], feature.outer[5]], 'The original southern fence stays in place');
  assert.equal(feature.railEdges.length, 2, 'Only the two requested sides have fences');
  const originalSide = feature.outer.slice(3, 5), [a, b] = originalSide;
  const direction = b.map((n, i) => n - a[i]), length = Math.hypot(...direction);
  const outward = [direction[1] / length, -direction[0] / length];
  const side = feature.railEdges[1];
  for (const [point, along] of [[side[0], 0], [side[1], length - 9]]) {
    const offset = point.map((n, i) => n - a[i]);
    assert.ok(Math.abs(offset[0] * outward[0] + offset[1] * outward[1] - 5.5) < 1e-8, 'The side fence moves outward to the red grass-margin line');
    assert.ok(Math.abs(offset[0] * direction[0] / length + offset[1] * direction[1] / length - along) < 1e-8, 'The north end stays aligned and the south end stops before the old corner');
  }
  assert.ok(distanceToSegment(side[1], ...feature.railEdges[0]) > 10, 'An open passage separates the two fences');
  const footprint = passageFootprint(side, .1);
  for (const road of campus.features.filter(item => item.type === 'path' && item.points && !item.representedBy)) {
    assert.equal(clip.intersection(polygon(footprint), polygon(passageFootprint(road.points, road.width || 3))).length, 0, 'The moved fence leaves existing roads clear');
  }
  const entrance = campus.features.find(item => item.id === 'local/underpass-entrance');
  const stairOpening = curvedStairTreads({ ...entrance.curvedStair, steps: 1 })[0].ring;
  assert.equal(clip.intersection(polygon(footprint), [stairOpening]).length, 0, 'The northern post leaves the curved entrance stairs clear');
  assert.equal(feature.railHeight, 3.8);
  assert.deepEqual(feature.railHeights, [3.8, 1.9], 'Only the moved side fence is lowered to one 1.9 m panel');
  const heights = feature.railHeights;
  const tallFence = basketballFenceGeometry({ ...feature, railHeights: [3.8, 3.8] });
  try {
    for (const railHeights of [undefined, [3.8]]) {
      const fallback = basketballFenceGeometry({ ...feature, railHeights });
      try {
        for (const part of ['frame', 'wire']) {
          assert.deepEqual(fallback[part].getAttribute('position').array, tallFence[part].getAttribute('position').array, 'Absent edge heights retain the scalar 3.8 m fence on both sides');
        }
      } finally { Object.values(fallback).forEach(part => part.dispose()); }
    }
  } finally { Object.values(tallFence).forEach(part => part.dispose()); }
  const fence = basketballFenceGeometry(feature), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  try {
    for (const part of Object.values(fence)) finite(part);
    const vertices = fence.wire.getAttribute('position'), wireSides = [], wireCoverage = [0, 0];
    const wireBounds = [[Infinity, -Infinity], [Infinity, -Infinity]];
    const courtsSpan = layout.count * layout.width + (layout.count - 1) * layout.gap;
    assert.ok(vertices.count > 500 && vertices.count % 2 === 0 && vertices.count / 2 < 1600, 'Both diamond nets share one inexpensive line-segment batch');
    for (let i = 0; i < vertices.count; i++) {
      const point = [vertices.getX(i), vertices.getZ(i)], [across, along] = local(point);
      const distances = feature.railEdges.map(([a, b]) => distanceToSegment(point, a, b));
      const side = distances[0] <= distances[1] ? 0 : 1;
      assert.ok(distances[side] < 1e-5, 'Every wire stays on one of the two requested outer edges');
      if (side === 0) {
        assert.ok(along < -layout.length / 2 - 1, 'The southern fence is beyond the playable baseline');
        wireSides.push(across);
      } else assert.ok(across < -courtsSpan / 2 - .5, 'The eastern fence stays beyond the outermost playing sideline');
      wireCoverage[side]++;
      const y = vertices.getY(i);
      wireBounds[side][0] = Math.min(wireBounds[side][0], y);
      wireBounds[side][1] = Math.max(wireBounds[side][1], y);
      assert.ok(y > .16 && y < .16 + heights[side], 'Each net keeps its own selected height');
    }
    assert.ok(wireCoverage.every(count => count > 300), 'Each requested side has a complete visible mesh');
    assert.ok(Math.max(...wireSides) - Math.min(...wireSides) > courtsSpan, 'The mesh spans all four courts rather than one bay');
    fence.wire.computeBoundingBox(); fence.frame.computeBoundingBox();
    assert.ok(Math.abs(fence.frame.boundingBox.min.y - .16) < .001);
    assert.ok(Math.abs(fence.frame.boundingBox.max.y - (.16 + feature.railHeight)) < .05);
    for (const [index, [bottom, top]] of wireBounds.entries()) {
      assert.ok(bottom - .16 < .15 && .16 + heights[index] - top < .15, 'Both nets reach close to their own ground and top rails');
    }
    const frameVertices = fence.frame.getAttribute('position'), frameCoverage = [0, 0];
    for (let i = 0; i < frameVertices.count; i++) {
      const point = [frameVertices.getX(i), frameVertices.getZ(i)];
      const distances = feature.railEdges.map(([a, b]) => distanceToSegment(point, a, b));
      const side = distances[0] <= distances[1] ? 0 : 1;
      assert.ok(distances[side] < .06, 'No frame wraps around unrequested sides or seals the entrance');
      assert.ok(frameVertices.getY(i) < .16 + heights[side] + .04, 'No posts or rails remain above either fence height');
      if (side === 1) assert.ok(frameVertices.getY(i) < 2.10, 'The side fence has no second tier above the single panel');
      frameCoverage[side]++;
    }
    assert.ok(frameCoverage.every(count => count > 100), 'Both requested sides have physical posts and rails');
    assert.ok(triangles(fence.frame) < 700, 'All posts and horizontal rails share one small opaque mesh');
    const frame = mesh(fence.frame, material);
    for (const [index, [a, b]] of feature.railEdges.entries()) {
      const middle = a.map((n, i) => (n + b[i]) / 2), normal = vector([a[1] - b[1], b[0] - a[0]]).normalize();
      const eye = vector(middle, .16 + heights[index]).addScaledVector(normal, 1);
      const hit = new THREE.Raycaster(eye, normal.clone().negate(), 0, 2).intersectObject(frame)[0];
      assert.ok(hit && Math.abs(hit.distance - 1) < .06, 'Each real top rail sits on its selected outer line');
      const count = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 3.4);
      const firstBay = a.map((n, i) => n + (b[i] - n) * .5 / count);
      const midEye = vector(firstBay, .16 + heights[index] / 2).addScaledVector(normal, 1);
      const midHits = new THREE.Raycaster(midEye, normal.clone().negate(), 0, 2).intersectObject(frame);
      assert.equal(midHits.length > 0, index === 0, 'The southern fence retains its middle rail; the single side panel has no horizontal seam');
    }
    const extendedSouth = b.map((n, i) => n + 5.5 * outward[i]);
    for (const [edge, description] of [
      [originalSide, 'The old side-fence location is vacated'],
      [[side[1], extendedSouth], 'The south gap has no continuation or joining rail'],
      [feature.outer.slice(2, 4), 'The northern access beside the underground entrance remains open'],
    ]) {
      const [from, to] = edge, middle = from.map((n, i) => (n + to[i]) / 2);
      const normal = vector([from[1] - to[1], to[0] - from[0]]).normalize();
      for (const y of [1, .16 + feature.railHeight]) {
        const eye = vector(middle, y).addScaledVector(normal, 1);
        assert.equal(new THREE.Raycaster(eye, normal.clone().negate(), 0, 2).intersectObject(frame).length, 0, description);
      }
    }
  } finally { material.dispose(); Object.values(fence).forEach(part => part.dispose()); }
});

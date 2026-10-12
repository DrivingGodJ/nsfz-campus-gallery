import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { riverLandscapeGeometry, RIVER_GARDEN_PATH_ID } from '../src/river-landscape.ts';
import { roadFootprint } from '../src/road-geometry.ts';
import { benchGeometry } from '../src/bench-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const read = path => JSON.parse(fs.readFileSync(new URL('../' + path, import.meta.url)));
const campus = read('public/data/campus.json'), corrections = read('data/campus-corrections.json');
const group = campus.features.find(f => f.id === 'local/river-bank-trees');
const tree = group.trees[3], center = [71, 15.35];
const bench = campus.features.find(f => f.id === 'local/river-tree-ring-bench');
const path = campus.features.find(f => f.id === RIVER_GARDEN_PATH_ID);
const polygon = shape => [shape.outer, ...(shape.holes ?? [])];
const at = (radius, angle) => [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
const inside = (point, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
};
const contains = (shape, point) => inside(point, shape.outer) && !(shape.holes ?? []).some(hole => inside(point, hole));

test('only the identified opposite-bank tree moves, and the separate teaching-building flowering tree stays fixed', () => {
  assert.equal(campus.features.filter(f => f.id === group.id).length, 1);
  assert.deepEqual(group.trees.map(t => t.position), [
    [51.1, 39.2], [53.3, 27.9], [61, 25.1], center, [95.1, 7.2], [102.6, 8.1],
    [117.4, 8.2], [94.2, 29.1], [105.5, 23], [122.85, 10.67], [132, 11.9],
  ], 'The original 11-tree group keeps every other root in place');
  assert.equal(tree.radius, 2.25);
  assert.ok(Math.abs(tree.height - 9.95) < 1e-10, 'The moved tree retains its original mature size');
  const allTrees = campus.features.flatMap(f => f.trees ?? []);
  assert.equal(allTrees.filter(t => Math.hypot(...t.position.map((v, i) => v - center[i])) < 1e-7).length, 1);
  assert.equal(allTrees.filter(t => Math.hypot(t.position[0] - 60.5, t.position[1] - 11.1) < 1e-7).length, 0, 'The tree is moved, not duplicated');
  const flowering = campus.features.find(f => f.id === 'local/teaching-flowering-tree').trees[0];
  assert.deepEqual(flowering.position, [75.803, 49.245]);
  assert.equal(flowering.radius, 3.1); assert.equal(flowering.height, 8.6); assert.equal(flowering.crownColor, '#e7e8d8');
  assert.deepEqual(campus.features.find(f => f.id === 'local/teaching-flowering-tree-bench').bench.center, [77.58, 45.248]);
  assert.equal(campus.features.filter(f => f.id === bench.id).length, 1);
  assert.deepEqual(bench.bench.center, tree.position);
  assert.deepEqual([bench.bench.innerRadius, bench.bench.depth, bench.bench.seatHeight], [.8, .55, .45]);
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus, 'Source-map regeneration preserves the corrected tree and ring seat');
});

test('the actual tan path surrounds a clear tree well in all 64 directions and the timber seat stays concentric', () => {
  const before = JSON.stringify(campus), landscape = riverLandscapeGeometry(campus.features, campus.buildings);
  const furniture = benchGeometry(bench.bench), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const floor = new THREE.Mesh(landscape.paths, material), seat = new THREE.Mesh(furniture.seat, material), supports = new THREE.Mesh(furniture.supports, material);
  for (const mesh of [seat, supports]) {
    mesh.position.set(center[0], bench.height ?? .02, center[1]);
    mesh.rotation.y = -Math.atan2(bench.bench.axis[1], bench.bench.axis[0]);
  }
  [floor, seat, supports].forEach(mesh => mesh.updateMatrixWorld());
  const hits = (point, mesh = floor) => new THREE.Raycaster(new THREE.Vector3(point[0], 1, point[1]), new THREE.Vector3(0, -1, 0), 0, 2).intersectObject(mesh);
  try {
    const footprint = roadFootprint(path);
    assert.ok(footprint.holes.some(hole => inside(center, hole)), 'The complete path has a physical unpaved hole around the relocated tree');
    for (let i = 0; i < 64; i++) {
      const angle = i * Math.PI / 32;
      for (const radius of [1.65, 2.2, 2.75]) {
        const point = at(radius, angle), hit = hits(point)[0];
        assert.ok(contains(footprint, point) && hit, `Direction ${i} keeps the full 1.2 m ring path usable`);
        assert.ok(Math.abs(hit.point.y - .126) < 1e-6, 'The ring joins the existing tan path at its existing surface height');
      }
      for (const radius of [0, .65, 1.45]) assert.equal(hits(at(radius, angle)).length, 0, 'No straight path remains across the tree well or the inside of the ring');
      for (const radius of [0, .65]) for (const mesh of [seat, supports])
        assert.equal(hits(at(radius, angle), mesh).length, 0, 'The seat and its legs leave roots and the trunk open');
    }
    const count = Math.ceil(Math.PI * 2 * (bench.bench.innerRadius + bench.bench.depth / 2) / .17);
    for (let i = 0; i < count; i++) {
      const point = at(bench.bench.innerRadius + bench.bench.depth / 2, (i + .5) * Math.PI * 2 / count);
      const hit = hits(point, seat)[0];
      assert.ok(hit && Math.abs(hit.point.y - ((bench.height ?? .02) + bench.bench.seatHeight)) < 1e-6, 'Every radial wood plank is a real seat around the same tree centre');
    }
    assert.equal(JSON.stringify(campus), before, 'Rendering does not rewrite the measured map');
  } finally { Object.values(landscape).forEach(g => g.dispose()); Object.values(furniture).forEach(g => g.dispose()); material.dispose(); }
});

test('the joined circular route retains both road approaches without entering lake water, buildings or the seat', () => {
  const footprint = roadFootprint(path);
  assert.equal(path.width, 1.2); assert.equal(path.representedBy, 'river-landscape');
  assert.equal(clip.union(polygon(footprint)).length, 1, 'The ring and both approaches share one connected walking surface');
  for (const id of ['way/1233313449', 'way/855459416']) {
    const road = roadFootprint(campus.features.find(f => f.id === id));
    assert.ok(clip.intersection(polygon(footprint), polygon(road)).length, 'Each preserved approach still connects to its original road');
  }
  for (const shape of [...campus.buildings, ...campus.features.filter(f => f.type === 'water' && f.outer), bench])
    assert.deepEqual(clip.intersection(polygon(footprint), polygon(shape)), [], 'The entire usable path and its approaches stay outside water and solid furniture/buildings');
  const landscape = riverLandscapeGeometry(campus.features, campus.buildings), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(landscape.paths, material); mesh.updateMatrixWorld();
  const ordinaryRoads = campus.features.filter(f => ['path', 'bridge'].includes(f.type) && f.id !== path.id && (f.points || f.outer) && !f.representedBy).map(roadFootprint);
  try {
    for (const point of path.points) {
      if (Math.hypot(point[0] - center[0], point[1] - center[1]) < 2.9 || ordinaryRoads.some(road => contains(road, point))) continue;
      assert.ok(new THREE.Raycaster(new THREE.Vector3(point[0], 1, point[1]), new THREE.Vector3(0, -1, 0), 0, 2).intersectObject(mesh).length, 'The actual tan mesh preserves the route on both sides of the new circle');
    }
  } finally { Object.values(landscape).forEach(g => g.dispose()); material.dispose(); }
});

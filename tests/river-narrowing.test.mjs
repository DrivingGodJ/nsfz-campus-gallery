import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { riverGardenPaths, riverWaterFootprints, riverLandscapeGeometry } from '../src/river-landscape.ts';
import { passageFootprint } from '../src/underground-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const find = id => campus.features.find(feature => feature.id === id);
const polygon = shape => [shape.outer, ...(shape.holes ?? [])];
const inside = (point, ring) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i][1] > point[1]) !== (ring[j][1] > point[1]) && point[0] <
      (ring[j][0] - ring[i][0]) * (point[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
  }
  return hit;
};

test('DSC08084 river narrowing leaves a continuous land path between both bridge approaches', () => {
  const waters = riverWaterFootprints(campus.features);
  assert.equal(waters.length, 1, 'The narrowed river still joins the pond beyond the arch');
  for (const point of [[99, 12], [104, 14], [109, 12]]) {
    assert.ok(!waters.some(water => inside(point, water.outer)), 'The red-line office bank becomes land');
  }
  for (const point of [[99, 18], [104, 18], [110, 18]]) {
    assert.ok(waters.some(water => inside(point, water.outer)), 'Water along the opposite bank remains');
  }
  const bridge = find('local/lake-bridge'), [a, b] = bridge.points;
  assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) > 11 && Math.hypot(b[0] - a[0], b[1] - a[1]) < 13);
  assert.ok(a[1] > 15 && a[1] < 17, 'The bridge head follows the narrower office bank');
  assert.deepEqual(b, [85.80659907247455, 27.60770522110976], 'The opposite bridge head stays in place');

  const controls = riverGardenPaths.at(-1);
  const route = new THREE.CatmullRomCurve3(controls.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal')
    .getSpacedPoints(controls.length * 5).map(point => [point.x, point.z]);
  const footprint = passageFootprint(route, 1.2);
  for (const obstacle of [...waters, ...campus.buildings]) {
    assert.equal(clip.intersection(polygon(footprint), polygon(obstacle)).length, 0, 'The yellow route remains on clear land');
  }
  const roads = campus.features.filter(feature => ['path', 'bridge'].includes(feature.type) && feature.points && !feature.representedBy)
    .map(feature => ({ id: feature.id, ...passageFootprint(feature.points, feature.width ?? 2) }));
  assert.ok(inside(route[0], roads.find(road => road.id === 'way/1233313440').outer));
  assert.ok(inside(route.at(-1), roads.find(road => road.id === 'way/1277839951').outer));
  for (const tree of campus.features.flatMap(feature => feature.trees ?? [])) {
    assert.ok(!inside(tree.position, footprint.outer), 'No trunk blocks the new garden path');
  }
  const geometry = riverLandscapeGeometry(campus.features, campus.buildings);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry.paths, material); mesh.updateMatrixWorld();
  try {
    let sampled = 0;
    for (const [x, z] of route) {
      if (roads.some(road => inside([x, z], road.outer))) continue;
      const hits = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
      assert.ok(hits.length && Math.abs(hits[0].point.y - .126) < 1e-6, 'The rendered path has no clipping gaps');
      sampled++;
    }
    assert.ok(sampled > 80);
    assert.equal(new THREE.Raycaster(new THREE.Vector3(99.2, 1, 9.8), new THREE.Vector3(0, -1, 0)).intersectObject(mesh).length, 0,
      'The superseded straight garden path is gone');
  } finally {
    Object.values(geometry).forEach(part => part.dispose()); material.dispose();
  }
});

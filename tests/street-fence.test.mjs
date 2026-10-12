import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { STREET_FENCE_COLOR, STREET_FENCE_RAIL_LEVELS, streetFenceGeometry } from '../src/street-fence-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const fence = campus.features.find(feature => feature.id === 'local/street-fence');
const frontage = [campus.boundary[17], campus.boundary[18], campus.boundary[26], campus.boundary[27], campus.boundary[0]];
const segments = route => route.slice(1).map((to, i) => [route[i], to]);
function distance(point, route) {
  return Math.min(...segments(route).map(([a, b]) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length2 = dx * dx + dz * dz;
    const t = length2 ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / length2)) : 0;
    return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz);
  }));
}
function crosses(a, b, p, q) {
  const dx = b[0] - a[0], dz = b[1] - a[1], ex = q[0] - p[0], ez = q[1] - p[1], divisor = dx * ez - dz * ex;
  if (Math.abs(divisor) < 1e-8) return false;
  const ax = p[0] - a[0], az = p[1] - a[1], t = (ax * ez - az * ex) / divisor, s = (ax * dz - az * dx) / divisor;
  return t >= 0 && t <= 1 && s >= 0 && s <= 1;
}

test('street fence follows the main-campus frontage, closes the marked footbridge gap and retains the other gate openings', () => {
  assert.ok(fence, 'The fence is included in the campus model');
  assert.equal(fence.type, 'fence');
  assert.equal(fence.railEdges.length, 4, 'Three gate openings remain after joining the marked footbridge gap');
  for (const [actual, expected] of [[fence.railEdges[0][0], frontage[0]], [fence.railEdges.at(-1).at(-1), frontage.at(-1)]]) {
    assert.ok(Math.hypot(actual[0] - expected[0], actual[1] - expected[1]) < 1e-6);
  }
  const routes = campus.features.filter(feature => (feature.type === 'path' || feature.type === 'bridge') && feature.points && !feature.representedBy
    && segments(frontage).some(([a, b]) => segments(feature.points).some(([p, q]) => crosses(a, b, p, q))));
  assert.deepEqual(routes.map(route => route.id).sort(), ['local/footbridge', 'way/1233313446', 'way/855459414', 'way/855459415']);
  const openRoutes=routes.filter(route=>route.id!=='local/footbridge');
  const geometry = streetFenceGeometry(fence), vertices = geometry.attributes.position;
  const street = campus.features.find(feature => feature.id === 'way/424713229');
  const gates = campus.features.filter(feature => ['local/gate-monument', 'local/gate-bell-tower'].includes(feature.id));
  for (let i = 0; i < vertices.count; i++) {
    const point = [vertices.getX(i), vertices.getZ(i)];
    assert.ok(distance(point, frontage) < .07, 'No part extends around the sports annex or away from the mapped frontage');
    assert.ok(distance(point, street.points) > street.width / 2 + .5, 'The fence stays clear of the external carriageway');
    for (const route of openRoutes) assert.ok(distance(point, route.points) > route.width / 2 + .7, `${route.id}: gate posts, pickets and ornaments all leave the full route width plus clearance`);
    for (const gate of gates) assert.ok(distance(point, gate.outer) > 1.4, `${gate.id}: the wide main entrance also clears its landmark footprint`);
  }
  const length = fence.railEdges.flatMap(segments).reduce((sum, [a, b]) => sum + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
  assert.ok(Math.abs(length - 347.011516) < .001, 'The former 5.1 metre footbridge gap is now included in the continuous frontage');
  const model=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  const [a,b]=[[37.7878347021563,-66.3761196469519],[33.495350491369194,-63.622065135602064]];
  const normal=new THREE.Vector3(b[1]-a[1],0,a[0]-b[0]).normalize();
  for(const t of [.1,.5,.9]) for(const level of STREET_FENCE_RAIL_LEVELS){
    const p=new THREE.Vector3(a[0]+(b[0]-a[0])*t,.12+1.6*level,a[1]+(b[1]-a[1])*t);
    assert.ok(new THREE.Raycaster(p.addScaledVector(normal,.3),normal.clone().negate(),0,.6).intersectObject(model).length,'Both rails fill every part of the marked gap');
  }
  model.material.dispose();
  geometry.dispose();
});

test('one finite batch contains two continuous rails, open pickets, spearheads and the pointed diamond band', () => {
  assert.equal(STREET_FENCE_COLOR, '#20382e');
  const geometry = streetFenceGeometry(fence), vertices = geometry.attributes.position;
  assert.ok(vertices.count > 200000 && vertices.count < 300000, 'Detailed iron is one bounded static batch');
  assert.ok(Array.from(vertices.array).every(Number.isFinite));
  assert.ok(Math.abs(geometry.boundingBox.min.y - .12) < 1e-5);
  assert.ok(Math.abs(geometry.boundingBox.max.y - 1.72) < 1e-5, 'Spear tips finish exactly 1.6 m above the base');
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mesh = new THREE.Mesh(geometry, material), ray = new THREE.Raycaster();
  for (const chain of fence.railEdges) for (const [a, b] of segments(chain)) {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz), normal = new THREE.Vector3(-dz / length, 0, dx / length);
    for (const level of STREET_FENCE_RAIL_LEVELS) {
      const middle = new THREE.Vector3((a[0] + b[0]) / 2, fence.height + fence.railHeight * level, (a[1] + b[1]) / 2);
      ray.set(middle.clone().addScaledVector(normal, .3), normal.clone().negate()); ray.far = .6;
      assert.ok(ray.intersectObject(mesh, false).length, 'Both rails remain continuous within every chain');
    }
  }
  geometry.dispose();
  const small = streetFenceGeometry({ railEdges: [[[0, 0], [2.4, 0]], [[4, 0], [6.4, 0]]], railHeight: 1.6, height: .12 });
  const smallMesh = new THREE.Mesh(small, material);
  const hits = (x, y) => { ray.set(new THREE.Vector3(x, y, .3), new THREE.Vector3(0, 0, -1)); ray.far = .6; return ray.intersectObject(smallMesh, false).length; };
  assert.equal(hits(.08, .87), 0, 'The lower fence stays open between the narrow pickets');
  const spacing = 2.4 / Math.ceil(2.4 / .18);
  assert.ok(hits(spacing * 1.5, .12 + 1.6 * .74), 'A sloping side of the pointed diamond appears between pickets');
  for (const level of STREET_FENCE_RAIL_LEVELS) assert.equal(hits(3.2, .12 + 1.6 * level), 0, 'Separate chains never gain a rail across an opening');
  assert.ok(hits(spacing, .12 + 1.6 * .96), 'The picket has a spearhead above its vertical stem');
  small.dispose(); material.dispose();
});

test('empty or repeated frontage points produce no invalid iron geometry', () => {
  for (const railEdges of [[], [[]], [[[0, 0], [0, 0]]]]) {
    const geometry = streetFenceGeometry({ railEdges });
    assert.equal(geometry.attributes.position.count, 0);
    assert.ok(Array.from(geometry.attributes.position.array).every(Number.isFinite));
    geometry.dispose();
  }
});

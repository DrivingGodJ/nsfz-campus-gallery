import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { passageFootprint } from '../src/underground-geometry.ts';
import { hedgeFenceGeometry, securityGateGeometry } from '../src/gate-frontage-geometry.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const fence = campus.features.find(f => f.id === 'local/sports-gate-hedge');
const campusFence = campus.features.find(f => f.id === 'local/street-fence');
const booth = campus.features.find(f => f.id === 'local/sports-gate-security');
const mesh = g => { const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); m.updateMatrixWorld(); return m; };
const release = meshes => meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });

test('the planted fence is across the street and ends at the newly circled sports-side entry, where the gate crosses that entry', () => {
  assert.equal(campusFence.hedge, undefined, 'The mistakenly planted campus-side fence is restored');
  assert.deepEqual(fence.railEdges, [], 'The sports-side fence uses its photographed plain metal rails');
  const roadSide = p => .5436160293641769 * (p[0] + 29.55111948896922) + .8393340292269379 * (p[1] + 32.71679834443505);
  assert.ok(fence.hedge.points.every(p => Math.abs(roadSide(p) + 16.8) < 1e-6), 'The whole marked hedge is across both road lanes on the sports-ground side');
  assert.ok(campusFence.railEdges[1].every(p => roadSide(p) > 8), 'Original campus-side iron stays on the opposite side');
  assert.equal(campusFence.railEdges.length, 4, 'All existing frontage chains and gate gaps survive');
  const model = booth.securityGate, end = fence.hedge.points.at(-1), [x, z] = model.axis;
  const world = (u, v) => [model.center[0] + x * u - z * v, model.center[1] + z * u + x * v];
  const cabinStart = world(-model.width / 2, model.depth / 2);
  assert.ok(Math.hypot(cabinStart[0] - end[0], cabinStart[1] - end[1]) < 1e-7, 'Cabin starts precisely at the marked hedge end');
  assert.ok(Math.hypot(...model.axis) > .9999);
  assert.ok(model.gateLength < 4, 'The accordion is folded beside the cabin');
  const a = world(model.width / 2, model.depth / 2), b = world(model.width / 2 + model.gateLength + .4, model.depth / 2);
  const gate = passageFootprint([a, b], .6);
  const entry = campus.features.find(f => f.id === 'way/855459410');
  assert.deepEqual(booth.connectedTo, [entry.id]);
  const entryLane = passageFootprint(entry.points.slice(0, 2), entry.width);
  assert.deepEqual(clip.intersection([booth.outer], [entryLane.outer]), [], 'Cabin stands beside the actual entry, rather than in the middle of the hedge or road');
  assert.ok(clip.intersection([gate.outer], [entryLane.outer]).length, 'The door sits across the circled entry road');
  const road = campus.features.find(f => f.id === 'way/855459415');
  for (let i = 1; i < road.points.length; i++) {
    const footprint = passageFootprint([road.points[i - 1], road.points[i]], road.width);
    for (const shape of [booth, gate]) assert.deepEqual(clip.intersection([shape.outer], [footprint.outer]), [], 'Cabin and folded gate preserve the complete four-metre entry road');
  }
  for (const feature of campus.features.filter(f => f.landmark || f.track)) for (const shape of [booth, gate]) {
    const ring = feature.platform?.outer ?? feature.outer;
    assert.deepEqual(clip.intersection([shape.outer], [ring]), [], 'The cabin and folded gate keep the clock, gate monument and raised sports platform clear');
  }
  const street = campus.features.find(f => f.id === 'way/422967076');
  for (let i = 1; i < street.points.length; i++) for (const shape of [booth, gate]) assert.deepEqual(clip.intersection([shape.outer], [passageFootprint([street.points[i - 1], street.points[i]], street.width).outer]), [], 'No part extends into the street carriageway');
  assert.deepEqual(applyCampusCorrections(campus, JSON.parse(fs.readFileSync(new URL('../data/campus-corrections.json', import.meta.url)))), campus, 'Regeneration preserves the marked fence and cabin');
});

test('the planted frontage has continuous dense greenery and actual metal rails above it', () => {
  const parts = hedgeFenceGeometry(fence), objects = Object.values(parts).map(mesh), foliage = [mesh(parts.foliage.clone()), mesh(parts.tips.clone())], metal = mesh(parts.rails.clone());
  const [a, b] = fence.hedge.points, dx = b[0] - a[0], dz = b[1] - a[1], normal = new THREE.Vector3(-dz, 0, dx).normalize();
  try {
    for (const object of objects) assert.ok(Array.from(object.geometry.attributes.position.array).every(Number.isFinite));
    for (let t = .02; t < 1; t += .02) for (const y of [.7, 1.4, 2.1]) {
      const point = new THREE.Vector3(a[0] + dx * t, fence.height + y, a[1] + dz * t);
      assert.ok(new THREE.Raycaster(point.addScaledVector(normal, .8), normal.clone().negate(), 0, 1.6).intersectObjects(foliage).length, 'No gaps through the marked planted barrier');
    }
    for (const y of [fence.hedge.height - .12, fence.hedge.railHeight]) {
      const p = new THREE.Vector3((a[0] + b[0]) / 2, fence.height + y, (a[1] + b[1]) / 2);
      assert.ok(new THREE.Raycaster(p.addScaledVector(normal, .6), normal.clone().negate(), 0, 1.2).intersectObject(metal).length, 'Both silver horizontal rails span the frontage');
    }
    parts.rails.computeBoundingBox(); assert.ok(parts.rails.boundingBox.max.y > 3.2);
  } finally { release([...objects, ...foliage, metal]); }
});

test('the security cabin has a hollow glazed shell, a glazed street door and a rounded flat roof, plus genuine crossed accordion bars', () => {
  const model = booth.securityGate, parts = securityGateGeometry(model), objects = Object.fromEntries(Object.entries(parts).map(([k, g]) => [k, mesh(g)]));
  const ray = (x, y) => new THREE.Raycaster(new THREE.Vector3(x, y, model.depth / 2 + .5), new THREE.Vector3(0, 0, -1), 0, .8);
  try {
    for (const object of Object.values(objects)) assert.ok(Array.from(object.geometry.attributes.position.array).every(Number.isFinite));
    for (const [x, y] of [[.45, 1.55], [-model.width * .3, .65]]) {
      assert.equal(ray(x, y).intersectObject(objects.metal).length, 0, 'Window and door glass have no solid sheet behind them');
      assert.ok(ray(x, y).intersectObject(objects.glass).length);
    }
    assert.ok(ray(.45, .45).intersectObject(objects.metal).length, 'Metal lower skirt matches the photo');
    assert.ok(Math.abs(parts.roof.boundingBox.max.y - model.totalHeight) < 1e-5);
    assert.equal(parts.glass.userData.photoOcclusionMask.some(Boolean), false, 'Transparent glazing does not block photo overlays');
    const start = model.width / 2 + .09, count = Math.ceil(model.gateLength / .3), step = model.gateLength / count;
    assert.ok(ray(start + step * 3.5, .93).intersectObject(objects.metal).length, 'The crossed telescoping bars are real geometry');
    assert.equal(ray(start + step * 3.3, .95).intersectObject(objects.metal).length, 0, 'The accordion has open spaces between rods');
  } finally { release(Object.values(objects)); }
});

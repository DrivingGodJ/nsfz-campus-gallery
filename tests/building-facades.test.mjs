import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { cafeteriaLowerProfile, cafeteriaBodyGeometry, dormitoryProfile, dormitoryBodyGeometry, facadeGeometry, FACADE_BASE } from '../src/facade-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const facades = campus.buildings.filter(b => b.facade);
const food = facades.find(b => b.facade.type === 'cafeteria');
const dorm = facades.find(b => b.facade.type === 'dormitory');
const dispose = model => model.geometries.forEach(({ geometry }) => geometry.dispose());

const inside = (p, shape) => polygonClipping.intersection([shape.outer], [[[p[0] - .01, p[1] - .01], [p[0] + .01, p[1] - .01], [p[0] + .01, p[1] + .01], [p[0] - .01, p[1] + .01], [p[0] - .01, p[1] - .01]]]).length > 0;

test('localized facade calibrations survive refresh and retain the merged dormitory', async () => {
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  assert.deepEqual(facades.map(b => b.facade.type).sort(), ['cafeteria', 'dormitory', 'laboratory']);
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus);
  assert.equal(site.buildingOverrides[dorm.id].name, '宿舍');
  assert.equal(dorm.sourceBuildingIds.length, 3);
});

test('the observatory and doorway align with the existing projecting bay, while the rest stays plain', () => {
  assert.equal(dorm.facade.entry.edge, 4, 'Uses the existing forward step, not the long flat wing');
  const entry = dorm.facade.entry, a = dorm.outer[entry.edge], b = dorm.outer[entry.edge + 1];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const axis = new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize();
  const out = new THREE.Vector3(axis.z, 0, -axis.x);
  let peakRatio;
  for (const floorHeight of [2.4, 3.6, 4.1]) {
    const model = facadeGeometry(dorm, 6, floorHeight);
    const center = new THREE.Vector3(model.dome.center[0], 0, model.dome.center[1]);
    const from = center.clone().sub(new THREE.Vector3(a[0], 0, a[1]));
    assert.ok(Math.abs(from.dot(axis) - length * .5) < 1e-6, 'Dome is centered on the original bay');
    assert.ok(inside(model.dome.center, dorm), 'Dome is supported by the existing roof');
    const ratio = (model.dome.peak - FACADE_BASE - .06) / floorHeight;
    if (peakRatio !== undefined) assert.ok(Math.abs(ratio - peakRatio) < 1e-7);
    peakRatio = ratio;
    assert.ok(!model.geometries.some(p => ['roof', 'red', 'wall'].includes(p.kind)), 'No full-building roof, colored bands, or window rows');
    const plaque = new THREE.Vector3(...model.plaque.center);
    assert.ok(Math.abs(plaque.clone().sub(new THREE.Vector3(a[0], 0, a[1])).dot(axis) - length * entry.at) < 1e-6, 'Plaque is centered below the observatory');
    assert.ok(plaque.y + model.plaque.height / 2 < FACADE_BASE + 6 * floorHeight);
    assert.ok(plaque.clone().sub(new THREE.Vector3(a[0], 0, a[1])).dot(out) > 0, 'The crest is on the outward facing surface');
    assert.ok(model.geometries.some(p => p.kind === 'emblem'), 'The plaque includes a raised crest');
    const rayPoint = new THREE.Vector3(a[0], FACADE_BASE + floorHeight * .35, a[1]).addScaledVector(axis, length * entry.at);
    const ray = new THREE.Raycaster(rayPoint.clone().addScaledVector(out, 3), out.clone().negate());
    const mesh = new THREE.Mesh(model.geometries.find(p => p.kind === 'glass').geometry, new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
    mesh.updateMatrixWorld(); assert.ok(ray.intersectObject(mesh).length);
    mesh.material.dispose(); dispose(model);
  }
});

test('the dormitory bay blends smoothly into both wings and retains the same outline at every floor', () => {
  const original = JSON.stringify(dorm), {shape, curve} = dormitoryProfile(dorm);
  const entry = dorm.facade.entry, a = dorm.outer[entry.edge], b = dorm.outer[entry.edge + 1];
  const center = [a[0] + (b[0] - a[0]) * entry.at, a[1] + (b[1] - a[1]) * entry.at];
  assert.ok(curve.length > 100, 'The curved shoulders have enough segments to avoid a polygonal silhouette');
  assert.ok(curve.some(p => Math.hypot(p[0] - center[0], p[1] - center[1]) < 1e-8), 'The original forward-bay anchor is preserved');
  for (const i of [0, 1, 2, 7, 8, 9, 10, 11]) assert.ok(shape.outer.some(p => Math.hypot(p[0] - dorm.outer[i][0], p[1] - dorm.outer[i][1]) < 1e-8), 'Other wings and rear walls remain in their original locations');
  for (const oldCorner of dorm.outer.slice(3, 7)) assert.ok(!shape.outer.some(p => Math.hypot(p[0] - oldCorner[0], p[1] - oldCorner[1]) < .01), 'The stepped corners are removed');
  const local = [dorm.outer[2], ...curve, dorm.outer[7]];
  for (let i = 1; i < local.length - 1; i++) {
    const u = new THREE.Vector2(local[i][0] - local[i - 1][0], local[i][1] - local[i - 1][1]);
    const v = new THREE.Vector2(local[i + 1][0] - local[i][0], local[i + 1][1] - local[i][1]);
    assert.ok(u.length() > 1e-5 && v.length() > 1e-5);
    assert.ok(u.normalize().dot(v.normalize()) > .999, 'No visible bend at either shoulder or the centre of the curve');
  }
  for (const height of [3.6, 7.2, 21.6]) {
    const geometry = dormitoryBodyGeometry(dorm, height, 3.6), p = geometry.getAttribute('position'), n = geometry.getAttribute('normal');
    geometry.computeBoundingBox();
    assert.ok(Math.abs(geometry.boundingBox.max.z - height) < 1e-5);
    for (const point of curve) {
      const wallVertices = [];
      for (let i = 0; i < p.count; i++) if (Math.hypot(point[0] - p.getX(i), point[1] + p.getY(i)) < 1e-4 && Math.abs(n.getZ(i)) < .5) wallVertices.push(i);
      assert.ok(wallVertices.some(i => p.getZ(i) === 0) && wallVertices.some(i => Math.abs(p.getZ(i) - height) < 1e-5), 'Roof and ground outlines share the same curve');
      const first = new THREE.Vector3().fromBufferAttribute(n, wallVertices[0]);
      for (const i of wallVertices) assert.ok(first.distanceTo(new THREE.Vector3().fromBufferAttribute(n, i)) < 1e-6, 'Shared wall vertices use continuous shading');
    }
    geometry.dispose();
  }
  assert.equal(JSON.stringify(dorm), original);
});

test('cafeteria keeps its projecting lower two floors as plain massing with smooth, uncapped ends', () => {
  const {profile, shape, start, end, peak} = cafeteriaLowerProfile(food);
  const bay = profile.filter(p => p.projecting);
  assert.ok(bay.length > 100, 'The broad curve has enough segments for a smooth silhouette');
  assert.equal(food.facade.lowerBay.start.edge, 9, 'The curve starts before the left-hand corner');
  assert.equal(food.facade.lowerBay.end.edge, 2, 'The same curve continues through the front corners');
  assert.ok(bay.every(p => inside(p.point, shape)));
  const original = JSON.stringify(food);
  const extension = polygonClipping.difference([shape.outer], [food.outer]);
  assert.ok(extension.length > 0, 'The curved lower volume really projects outside the upper wall');
  const from = new THREE.Vector2(...bay[0].point), to = new THREE.Vector2(...bay.at(-1).point), chord = to.clone().sub(from).normalize();
  const outwardDepth = Math.abs(new THREE.Vector2(peak[0] - from.x, peak[1] - from.y).cross(chord));
  assert.ok(outwardDepth > 5, 'The central arc has the pronounced projection shown in the reference');
  assert.ok(!inside(peak, food), 'The bay projects toward the lake rather than curving into the building');
  const turns = new Set();
  for (let i = 1; i < bay.length - 1; i++) {
    const a = bay[i - 1].point, b = bay[i].point, c = bay[i + 1].point;
    const u = new THREE.Vector2(b[0] - a[0], b[1] - a[1]), v = new THREE.Vector2(c[0] - b[0], c[1] - b[1]);
    turns.add(Math.sign(u.cross(v)));
    assert.ok(u.normalize().dot(v.normalize()) > .999, 'The front arc has no angular kink at the original facade joint');
  }
  assert.equal(turns.size, 1, 'The arc turns in one direction throughout, without two separate bulges or an intermediate dip');
  for (let i = 0; i < profile.length; i++) {
    const a = profile[(i + profile.length - 1) % profile.length].point, b = profile[i].point, c = profile[(i + 1) % profile.length].point;
    const u = new THREE.Vector2(b[0] - a[0], b[1] - a[1]), v = new THREE.Vector2(c[0] - b[0], c[1] - b[1]);
    assert.ok(u.length() > 1e-6 && v.length() > 1e-6);
    assert.ok(u.normalize().dot(v.normalize()) > .96, 'No acute corner in the lower outline, including material transitions');
  }
  for (const [sample, anchor] of [[bay[0], food.facade.lowerBay.start], [bay.at(-1), food.facade.lowerBay.end]]) {
    const a = food.outer[anchor.edge], b = food.outer[anchor.edge + 1];
    assert.ok(Math.hypot(sample.point[0] - a[0] - (b[0] - a[0]) * anchor.at, sample.point[1] - a[1] - (b[1] - a[1]) * anchor.at) < 1e-6, 'Bay tapers flush to the unchanged wall');
  }
  assert.ok(start < end);
  for (const floorHeight of [2.4, 3.6, 4.1]) {
    const info = buildingLevels(food, {...site.buildingOverrides[food.id], floorHeight});
    const model = facadeGeometry(food, info.floors, floorHeight);
    assert.deepEqual(model.geometries, [], 'No dark glass, mullions, or facade decorations remain');
    const body = cafeteriaBodyGeometry(food, info.height, floorHeight); body.computeBoundingBox();
    assert.ok(Math.abs(body.boundingBox.max.z - info.height) < 1e-5, 'Original floor-based total height is retained');
    const p = body.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getZ(i) > 2 * floorHeight + 1e-5) assert.ok(inside([p.getX(i), -p.getY(i)], food), 'Upper massing is unchanged');
    const mesh = new THREE.Mesh(body, new THREE.MeshBasicMaterial({side: THREE.DoubleSide}));
    const interior = shiftedPointToward(peak, [(from.x + to.x) / 2, (from.y + to.y) / 2], .3);
    mesh.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(interior[0], -interior[1], info.height + 10), new THREE.Vector3(0, 0, -1));
    const hits = ray.intersectObject(mesh);
    assert.ok(hits.length && Math.abs(hits[0].point.z - 2 * floorHeight) < 1e-4, 'The projecting volume is physically capped at the second floor');
    mesh.material.dispose();
    body.dispose(); dispose(model);
  }
  assert.equal(JSON.stringify(food), original);
});

function shiftedPointToward(point, target, distance) {
  const length = Math.hypot(target[0] - point[0], target[1] - point[1]);
  return [point[0] + (target[0] - point[0]) * distance / length, point[1] + (target[1] - point[1]) * distance / length];
}

test('floor cuts clip the projecting lower volume and remove the observatory without leftover details', () => {
  for (const building of facades) for (const floorHeight of [2.4, 3.6, 4.1]) for (const floor of [1, 2]) {
    const info = buildingLevels(building, {...site.buildingOverrides[building.id], floorHeight});
    const model = facadeGeometry(building, info.floors, floorHeight, floor * floorHeight);
    assert.equal(model.dome, undefined);
    assert.equal(model.plaque, undefined);
    for (const {geometry} of model.geometries) {
      geometry.computeBoundingBox();
      assert.ok(geometry.boundingBox.max.y <= FACADE_BASE + floor * floorHeight + 1e-5);
      assert.ok(Array.from(geometry.getAttribute('position').array).every(Number.isFinite));
    }
    dispose(model);
  }
});

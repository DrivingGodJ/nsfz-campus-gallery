import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { undergroundFloorElevation, undergroundLayout } from '../src/underground-geometry.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';
import { curvedStairPoint, pointOnStairTread } from '../src/structure-geometry.ts';
import { photoCameraHeightRange, photoMapHeight } from '../src/locations.ts';
import { photoPlacementPoint } from '../src/photo-placement.ts';
import { groundSurfaces } from '../src/ground-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(fs.readFileSync(new URL('../public/data/site.json', import.meta.url)));
const find = id => campus.features.find(feature => feature.id === id);
const tunnel = find('local/underpass'), exit = find('local/underpass-exit'), entrance = find('local/underpass-entrance');
const layout = undergroundLayout(campus.features), tunnelArea = layout.areas.get(tunnel.id), corridorArea = layout.areas.get('local/underground-corridor');
const stair = tunnel.riseStair;
const joint = tunnel.points.at(-1), routeStart = tunnel.points[0];
const routeLength = Math.hypot(joint[0] - routeStart[0], joint[1] - routeStart[1]);
const axis = [(joint[0] - routeStart[0]) / routeLength, (joint[1] - routeStart[1]) / routeLength];
const at = (distance, offset = 0) => [joint[0] - axis[0] * distance - axis[1] * offset, joint[1] - axis[1] * distance + axis[0] * offset];
const stepPoint = (index, fraction = .5, offset = 0) => {
  const progress = (index + fraction) / stair.steps;
  return [stair.from[0] + (stair.to[0] - stair.from[0]) * progress - axis[1] * offset,
    stair.from[1] + (stair.to[1] - stair.from[1]) * progress + axis[0] * offset];
};
const close = (actual, expected, description) => assert.ok(Math.abs(actual - expected) < 2e-5, `${description}: ${actual} != ${expected}`);
const fixture = areas => {
  const models = areas.map(area => undergroundDetailGeometry(area.feature, area.footprints, area.openings, area.connections));
  const meshes = models.map(model => Object.fromEntries(Object.entries(model).map(([kind, geometry]) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(); return [kind, mesh];
  })));
  const ray = (point, height, direction, distance, objects) => new THREE.Raycaster(new THREE.Vector3(point[0], height, point[1]), direction, 0, distance).intersectObjects(objects);
  return { models, meshes, ray, dispose: () => {
    models.forEach(model => Object.values(model).forEach(geometry => geometry.dispose()));
    meshes.forEach(model => Object.values(model).forEach(mesh => mesh.material.dispose()));
  } };
};
const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);

test('the photographed ascent stays before the original bend and keeps a full upper landing', () => {
  assert.ok(stair, 'The straight tunnel has the photographed upward flight');
  assert.equal(tunnel.height, -6.04);
  assert.equal(stair.bottomHeight, tunnel.height);
  assert.equal(stair.topHeight, exit.height);
  assert.equal(stair.width, tunnel.width, 'The flight fills the existing passage rather than adding a side block');
  assert.equal(stair.steps, 14);
  close(Math.hypot(...stair.to.map((n, i) => n - stair.from[i])), 4.2, 'Actual flight run');
  const rise = (stair.topHeight - stair.bottomHeight) / stair.steps;
  assert.ok(rise > .14 && rise <= .18, 'Risers are a normal stair height');
  assert.ok(4.2 / stair.steps >= .28, 'Treads have a usable depth');
  assert.deepEqual(joint, [-65, -41], 'The bend has not moved');
  const landingDistance = Math.hypot(...stair.to.map((n, i) => n - joint[i]));
  close(landingDistance, 4, 'The upper landing begins four metres before the turn centre');
  const seam = tunnelArea.openings[0];
  const shortestLanding = Math.min(...seam.map(point => (point[0] - stair.to[0]) * axis[0] + (point[1] - stair.to[1]) * axis[1]));
  assert.ok(shortestLanding >= 1.5, 'Even the short side has a complete landing before the diagonal miter');
  assert.equal(entrance.curvedStair.bottomHeight, tunnel.height, 'The opposite entrance descends to the lowered main passage');
  assert.equal(entrance.curvedStair.steps, 35);
  assert.ok((entrance.curvedStair.topHeight - entrance.curvedStair.bottomHeight) / entrance.curvedStair.steps <= .18);
  const entranceBottom = curvedStairPoint(entrance.curvedStair, 1);
  close(entranceBottom[0], routeStart[0], 'The original entrance horizontal join stays in place');
  close(entranceBottom[2], routeStart[1], 'The original entrance horizontal join stays in place');
});

test('real flat treads rise continuously and join the real exit floor with no floating or buried landing', () => {
  const model = fixture([tunnelArea, corridorArea]);
  const floorMeshes = model.meshes.map(parts => parts.floor);
  try {
    for (let index = 0; index < stair.steps; index++) {
      const expected = stair.bottomHeight + (stair.topHeight - stair.bottomHeight) * (index + 1) / stair.steps;
      for (const fraction of [.08, .5, .92]) for (const offset of [-1.2, 0, 1.2]) {
        const point = stepPoint(index, fraction, offset), hits = model.ray(point, expected + .14, down, 3, floorMeshes);
        assert.ok(hits.length, `Step ${index + 1} has a physical floor`);
        close(hits[0].point.y, expected + .045, `Step ${index + 1} is horizontal across its usable width`);
        close(undergroundFloorElevation(tunnel, point), expected, 'Photo elevation matches the physical tread');
      }
    }
    for (const distance of [9, 8.3]) {
      const point = at(distance), hits = model.ray(point, tunnel.height + .2, down, .3, floorMeshes);
      assert.ok(hits.length); close(hits[0].point.y, tunnel.height + .045, 'The lower approach joins the first riser');
    }
    for (const distance of [3.8, 3]) for (const offset of [-1.2, 0, 1.2]) {
      const point = at(distance, offset), hits = model.ray(point, exit.height + .2, down, .3, floorMeshes);
      assert.ok(hits.length); close(hits[0].point.y, exit.height + .045, 'The last step leads onto the upper landing');
    }
    const seam = tunnelArea.openings[0], normal = new THREE.Vector3(seam[1][1] - seam[0][1], 0, seam[0][0] - seam[1][0]).normalize();
    for (const fraction of [.1, .25, .5, .75, .9]) for (const side of [-1, 1]) {
      const point = seam[0].map((n, i) => n + (seam[1][i] - n) * fraction);
      const sample = [point[0] + normal.x * .2 * side, point[1] + normal.z * .2 * side];
      const hits = model.ray(sample, exit.height + .2, down, .3, floorMeshes);
      assert.ok(hits.length); close(hits[0].point.y, exit.height + .045, 'Both sides of the turn share the real upper floor');
    }
  } finally { model.dispose(); }
});

test('the complete approach, every tread, upper landing and turn have at least 2.2 metres clear under real ceilings and fittings', () => {
  const model = fixture([tunnelArea, corridorArea]);
  const obstructions = model.meshes.flatMap(parts => Object.entries(parts).filter(([kind]) => !['floor', 'green', 'tiles', 'paint', 'wood'].includes(kind)).map(([, mesh]) => mesh));
  try {
    const points = [at(14), at(11.3), at(10.5), at(9),
      ...Array.from({ length: stair.steps }, (_, index) => stepPoint(index)), at(3.8), at(3),
      exit.points[0].map((n, i) => n + (exit.points[1][i] - n) * .25)];
    for (const center of points) for (const offset of [-1.68, -.8, 0, .7, 1.68]) {
      const point = [center[0] - axis[1] * offset, center[1] + axis[0] * offset];
      const floor = undergroundFloorElevation(tunnel, point);
      const inTunnel = tunnelArea.footprints.some(shape => pointOnStairTread(point, shape.outer));
      const actualFloor = inTunnel ? floor : exit.height;
      const hits = model.ray(point, actualFloor + .055, up, 8, obstructions);
      assert.ok(hits.length, 'The walking route remains enclosed by a physical ceiling');
      assert.ok(hits[0].point.y - actualFloor - .045 >= 2.2 - 2e-5, `Headroom at ${point}: ${hits[0].point.y - actualFloor - .045}`);
    }
    const seam = tunnelArea.openings[0], normal = new THREE.Vector3(seam[1][1] - seam[0][1], 0, seam[0][0] - seam[1][0]).normalize();
    for (const fraction of [.1, .25, .5, .75, .9]) for (const height of [.2, 1.1, 2]) {
      const point = seam[0].map((n, i) => n + (seam[1][i] - n) * fraction);
      const origin = new THREE.Vector3(point[0], exit.height + .045 + height, point[1]).addScaledVector(normal, -.3);
      assert.equal(new THREE.Raycaster(origin, normal, 0, .6).intersectObjects(obstructions).length, 0, 'The turn contains no internal wall, beam or guard barrier');
    }
  } finally { model.dispose(); }
});

test('existing relative photo heights follow the lowered passage and newly picked treads without changing persisted photos', () => {
  const before = JSON.stringify(site.photos), photo = site.photos.find(item => item.title === '_DSC8295');
  assert.ok(photo);
  close(photo.cameraHeight, .3, 'The user-calibrated low shooting height is retained');
  close(photoMapHeight(photo, campus, site), undergroundFloorElevation(tunnel, [photo.position.x, photo.position.z]) + .3, 'The existing shot follows the real lowered approach');
  const model = fixture([tunnelArea]);
  try {
    for (const index of [0, 6, 13]) {
      const [x, z] = stepPoint(index), record = { ...photo, position: { x, z } };
      const expected = stair.bottomHeight + (stair.topHeight - stair.bottomHeight) * (index + 1) / stair.steps;
      close(photoMapHeight(record, campus, site), expected + .3, 'Relative shooting height follows this tread');
      const range = photoCameraHeightRange(record, campus, site);
      assert.ok(range.max >= 2.2 && range.max < 5.5, 'Editing remains within the actual local ceiling');
      const target = new THREE.Vector3(x, expected + .045, z), origin = target.clone().add(new THREE.Vector3(1.2, 7, -1));
      const direction = target.clone().sub(origin).normalize(), ray = new THREE.Ray(origin, direction);
      const visibleHit = new THREE.Raycaster(origin, direction).intersectObject(model.meshes[0].floor)[0];
      const placed = photoPlacementPoint(ray, record, campus, site);
      assert.ok(visibleHit && placed, 'A clicked stair surface produces an annotation point');
      assert.ok(Math.hypot(placed.x - visibleHit.point.x, placed.z - visibleHit.point.z) < 2e-5, 'Annotation uses the actual visible tread, not the old eye-height plane');
      close(photoMapHeight({ ...record, position: placed }, campus, site) - .3 + .045, visibleHit.point.y, 'The placed photograph stands on the clicked step');
    }
  } finally { model.dispose(); }
  assert.equal(JSON.stringify(site.photos), before, 'Derived floor changes never rewrite user photos');
});

test('the buried return and original high corridor remain unchanged and the removed ground projection stays removed after refresh', () => {
  assert.equal(exit.height, -3.8);
  assert.equal(exit.wallHeight, 3.2);
  assert.deepEqual(exit.points, [[-65, -41], [-55.31932019742438, -48.70549060222474], [-50.604970295726105, -42.782686431589866]]);
  assert.equal(corridorArea.feature.height, -3.8);
  assert.equal(corridorArea.feature.wallHeight, 6.4);
  const model = fixture([corridorArea]), parts = model.meshes[0];
  try {
    const ground = groundSurfaces(campus), surfaces = [...ground.campus, ...ground.features.values()].flat();
    for (const point of [[-64, -42], [-62, -43], [-60, -44], [-59, -46]]) {
      const hits = model.ray(point, -2.2, up, 8, [parts.ceiling]);
      assert.ok(hits.length); close(hits[0].point.y, -.72, 'The previously trimmed exit roof stays buried');
      assert.equal(model.ray(point, 4, down, 4, [parts.walls, parts.ceiling]).length, 0, 'The marked above-ground projection is not recreated');
      assert.ok(surfaces.some(shape => pointOnStairTread(point, shape.outer) && !shape.holes.some(hole => pointOnStairTread(point, hole))), 'Ground remains closed above the buried return');
    }
    const branch = corridorArea.feature.branches[0], point = branch[0].map((n, i) => (n + branch[1][i]) / 2);
    const hits = model.ray(point, -2.2, up, 8, [parts.ceiling]);
    assert.ok(hits.length); close(hits[0].point.y, 2.48, 'The original high entrance corridor roof is untouched');
  } finally { model.dispose(); }
  const corrections = JSON.parse(fs.readFileSync(new URL('../data/campus-corrections.json', import.meta.url)));
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus, 'A map refresh retains the stair and previously confirmed geometry');
});

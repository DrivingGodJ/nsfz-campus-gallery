import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { garageRampFootprint, garageRampGeometry } from '../src/garage-ramp-geometry.ts';
import { groundSurfaces } from '../src/ground-geometry.ts';
import { laboratoryBodyGeometry, laboratoryLayout } from '../src/laboratory-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { stairwellFrame, teachingStairGeometry } from '../src/teaching-stairs.ts';
import { passageFootprint, undergroundLayout } from '../src/underground-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const entrance = campus.features.find(feature => feature.id === 'local/laboratory-garage-entrance');
const laboratory = campus.buildings.find(building => building.id === 'way/855459411');
const polygon = shape => [shape.outer, ...(shape.holes || [])];
const ringArea = ring => Math.abs(ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
const area = polygons => polygons.reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((n, ring) => n + ringArea(ring), 0), 0);
const mesh = (geometry, material) => { const result = new THREE.Mesh(geometry, material); result.updateMatrixWorld(); return result; };
const surface = (shape, height, material) => {
  const outline = new THREE.Shape(shape.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  outline.holes = shape.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
  const result = new THREE.Mesh(new THREE.ShapeGeometry(outline), material);
  result.rotation.x = -Math.PI / 2; result.position.y = height; result.updateMatrixWorld(); return result;
};
function rampSample(progress, across = 0) {
  const [from, to] = entrance.points, dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
  return [from[0] + dx * progress - dz / length * across, from[1] + dz * progress + dx / length * across];
}

test('the garage ramp enters the classroom through its end facade, without occupying the neighboring corridor or adding an underground garage', () => {
  assert.ok(entrance, 'The marked garage entrance is present in the published campus data');
  assert.equal(entrance.type, 'garageEntrance');
  assert.deepEqual(entrance, corrections.features.find(feature => feature.id === entrance.id));
  assert.equal(campus.features.filter(feature => feature.type === 'garageEntrance').length, 1);
  assert.ok(!entrance.name, 'A structural entrance does not create an invisible flat photo-location target');
  const layout = laboratoryLayout(laboratory);
  for (const [point, expected] of [[entrance.points[0], layout.at(69, 7.4)], [entrance.points[1], layout.at(55.5, 7.4)]]) {
    assert.ok(Math.hypot(point[0] - expected[0], point[1] - expected[1]) < 1e-6, 'The driveway starts at the solid end facade and descends along -u into the classroom');
  }
  const footprint = polygon(garageRampFootprint(entrance));
  assert.ok(area(polygonClipping.difference(footprint, [campus.boundary])) < 1e-7);
  const threshold = polygon(passageFootprint([layout.at(69, 7.4), layout.at(68.84, 7.4)], entrance.width + .44));
  const classrooms = polygon(layout.rooms.at(-1));
  assert.ok(area(polygonClipping.difference(polygonClipping.difference(footprint, threshold), classrooms)) < 1e-7,
    'Apart from the short exterior threshold, the driveway is wholly within the classroom footprint');
  assert.ok(area(polygonClipping.difference(footprint, classrooms)) < (entrance.width + .44) * .151,
    'The entrance crosses the facade only by the 15 cm threshold, with submillimetre outline tolerance');
  assert.ok(area(polygonClipping.intersection(footprint, polygonClipping.union(...layout.walkways.map(polygon)))) < 1e-7,
    'The neighboring three-metre open corridor remains outside the garage footprint');
  assert.deepEqual(laboratory.groundFloorOpenings, [garageRampFootprint(entrance)], 'The building cuts the same footprint as the ground and retaining walls');
  const obstacles = [...campus.buildings.filter(building => building !== laboratory).map(polygon), ...campus.features.flatMap(feature => feature.outer ? [polygon(feature)]
    : feature.type === 'path' ? [polygon(passageFootprint(feature.points, feature.width || 3))] : [])];
  for (const obstacle of obstacles) assert.ok(area(polygonClipping.intersection(footprint, obstacle)) < 1e-7, 'The entrance leaves existing roads and buildings clear');
  const before = undergroundLayout(campus.features.filter(feature => feature !== entrance)), after = undergroundLayout(campus.features);
  assert.deepEqual(after, before, 'Only the entrance is added; there is no garage volume or new underground route');
});

test('the driveway slopes below ground with continuous retaining walls and a doorway at its lower end', () => {
  const parts = garageRampGeometry(entrance), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const driveway = mesh(parts.floor, material), walls = [mesh(parts.leftWall, material), mesh(parts.rightWall, material)];
  try {
    assert.ok(entrance.ramp.bottomHeight < -2 && Math.abs(entrance.ramp.topHeight - .02) < 1e-6, 'The facade entrance starts flush with the outside ground');
    for (const progress of [.01, .25, .5, .75, .99]) {
      const expected = entrance.ramp.topHeight + (entrance.ramp.bottomHeight - entrance.ramp.topHeight) * progress;
      for (const across of [-entrance.width / 2 + .15, 0, entrance.width / 2 - .15]) {
        const [x, z] = rampSample(progress, across), hits = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0)).intersectObject(driveway);
        assert.ok(hits.length, 'The sloping floor spans the usable driveway width');
        assert.ok(Math.abs(hits[0].point.y - expected) < 2e-4, 'The surface follows the descent instead of a flat or stepped patch');
      }
      for (const side of [-1, 1]) {
        const [x, z] = rampSample(progress, side * (entrance.width / 2 + .11));
        const hits = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0)).intersectObjects(walls);
        assert.ok(hits.length && Math.abs(hits[0].point.y - (entrance.ramp.topHeight + .3)) < 2e-4, 'Both retaining walls remain continuous along the whole descent');
      }
    }
    const [from, to] = entrance.points, axis = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
    const origin = new THREE.Vector3(to[0], entrance.ramp.bottomHeight + 1, to[1]).addScaledVector(axis, -1);
    assert.ok(new THREE.Raycaster(origin, axis, 0, 2).intersectObject(mesh(parts.doorway, material)).length, 'The lower end has a basement doorway, without modelling the garage beyond it');
  } finally { Object.values(parts).forEach(geometry => geometry.dispose()); material.dispose(); }
});

test('the first-storey end facade and slab open into the ramp while upper floors and the adjacent corridor remain intact', () => {
  const layout = groundSurfaces(campus), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const ground = [...layout.campus.map(shape => surface(shape, .02, material)), ...layout.background.map(shape => surface(shape, -.08, material)),
    ...[...layout.features.values()].flatMap(shapes => shapes.map(shape => surface(shape, .06, material)))];
  const before = groundSurfaces({ ...campus, features: campus.features.filter(feature => feature !== entrance) });
  const oldGround = [...before.campus.map(shape => surface(shape, .02, material)), ...before.background.map(shape => surface(shape, -.08, material))];
  const parts = garageRampGeometry(entrance), driveway = mesh(parts.floor, material);
  const info = buildingLevels(laboratory), bodies = [laboratory, { ...laboratory, groundFloorOpenings: [] }].map(building => {
    const result = new THREE.Mesh(laboratoryBodyGeometry(building, info.height, info.floorHeight, true), material);
    result.rotation.x = -Math.PI / 2; result.position.y = .12; result.updateMatrixWorld(); return result;
  });
  try {
    for (const progress of [.05, .5, .95]) for (const across of [-entrance.width / 2 + .2, 0, entrance.width / 2 - .2]) {
      const [x, z] = rampSample(progress, across), ray = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
      assert.ok(ray.intersectObjects(oldGround).length, 'This driveway previously lay beneath the solid ground');
      assert.equal(ray.intersectObjects(ground).length, 0, 'Neither the campus, background, nor another terrain face caps the underground entrance');
      assert.ok(ray.intersectObject(bodies[1]).length, 'The entrance used to be covered by the first-floor slab');
      assert.equal(ray.intersectObject(bodies[0]).length, 0, 'The first-storey slab no longer blocks the driveway');
      const hits = ray.intersectObjects([...ground, bodies[0], driveway]);
      assert.ok(hits.length && hits[0].object === driveway && hits[0].point.y < .37, 'The ramp is the first visible surface below the opening');
    }
    const [from, to] = entrance.points, axis = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize(), length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const wallRay = new THREE.Raycaster(new THREE.Vector3(from[0], 1.4, from[1]), axis, 0, length - .01);
    const oldWallHits = wallRay.intersectObject(bodies[1]);
    assert.ok(oldWallHits.length && oldWallHits[0].distance < .16, 'The exterior classroom end facade previously blocked entry');
    assert.equal(wallRay.intersectObject(bodies[0]).length, 0, 'The first-storey end facade now has a real garage portal into the classroom');
    const [x, z] = rampSample(.5);
    for (let level = 1; level < info.floors; level++) {
      const floor = level * info.floorHeight;
      const slabHits = new THREE.Raycaster(new THREE.Vector3(x, floor + 1, z), new THREE.Vector3(0, -1, 0), 0, 1).intersectObject(bodies[0]);
      assert.ok(slabHits.length && Math.abs(slabHits[0].point.y - floor - .37) < 2e-4, 'The garage opening does not cut slabs on higher storeys');
      const upperRay = new THREE.Raycaster(new THREE.Vector3(from[0], floor + 1.4, from[1]), axis, 0, length - .01);
      assert.ok(upperRay.intersectObject(bodies[0]).length, 'The upper-storey classroom wall remains above the driveway opening');
    }
    const [beforeX, beforeZ] = rampSample(-.02);
    const lip = new THREE.Raycaster(new THREE.Vector3(beforeX, 1, beforeZ), new THREE.Vector3(0, -1, 0), 0, 1).intersectObjects(ground);
    assert.ok(lip.length && Math.abs(lip[0].point.y - entrance.ramp.topHeight) < 2e-4, 'The short facade threshold joins the retained exterior ground without a step');
    const layout = laboratoryLayout(laboratory), [corridorX, corridorZ] = layout.at(66, 13.1);
    for (let level = 0; level < info.floors; level++) {
      const floor = level * info.floorHeight;
      const ray = new THREE.Raycaster(new THREE.Vector3(corridorX, floor + 1, corridorZ), new THREE.Vector3(0, -1, 0), 0, 1);
      const hits = ray.intersectObject(bodies[0]), oldHits = ray.intersectObject(bodies[1]);
      assert.ok(hits.length && oldHits.length && Math.abs(hits[0].point.y - oldHits[0].point.y) < 2e-4,
        'Every slab in the neighboring open corridor stays at its previous height');
    }
    for (const v of [4, 10.7]) {
      const point = layout.at(69, v);
      const ray = new THREE.Raycaster(new THREE.Vector3(point[0], 1.4, point[1]), axis, 0, 1);
      assert.ok(ray.intersectObject(bodies[0]).length, 'The first-storey facade beside the garage portal is retained');
    }
  } finally { [...ground, ...oldGround, ...bodies].forEach(target => target.geometry.dispose()); Object.values(parts).forEach(geometry => geometry.dispose()); material.dispose(); }
});

test('the laboratory stair ascends on the left first, with the right return absent below the half-storey landing', () => {
  const layout = laboratoryLayout(laboratory), stair = layout.stair, info = buildingLevels(laboratory);
  const halfHeight = .25 + info.floorHeight / 2, frame = stairwellFrame(stair), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const structures = [stair, { ...stair, firstFlight: 'right' }].map(item => teachingStairGeometry({ ...laboratory, stairwells: [item] }, info.sections, info.floorHeight, halfHeight));
  const models = structures.map(geometry => mesh(geometry.concrete, material));
  try {
    const u = stair.landingDepth + stair.run * .25;
    const hits = models.map(model => [-1, 1].map(side => {
      const [x, z] = frame.at(u, side * stair.width / 4);
      return new THREE.Raycaster(new THREE.Vector3(x, .12 + halfHeight + .1, z), new THREE.Vector3(0, -1, 0)).intersectObject(model);
    }));
    assert.ok(hits[0][0].length && !hits[0][1].length, 'Only the actual left flight reaches from the floor toward the half-height landing');
    assert.ok(!hits[1][0].length && hits[1][1].length, 'Changing the handedness swaps the physical flights, not just a data field');
    assert.ok(hits[0][0][0].point.y > .37 && hits[0][0][0].point.y < .12 + halfHeight, 'The sampled left tread belongs to the ascending first flight');
  } finally { structures.forEach(parts => Object.values(parts).forEach(geometry => geometry.dispose())); material.dispose(); }
});

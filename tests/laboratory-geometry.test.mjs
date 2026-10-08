import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingGeometry } from '../src/building-geometry.ts';
import { laboratoryBodyGeometry, laboratoryLayout } from '../src/laboratory-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingRailGeometry } from '../src/architecture-geometry.ts';
import { teachingStairGeometry, stairwellShaft } from '../src/teaching-stairs.ts';
import { buildingSkylightGeometry } from '../src/skylight-geometry.ts';
import { buildingFloorLineGeometry } from '../src/building-floor-lines.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459411');
const theatre = campus.buildings.find(b => b.id === 'local/theatre');
const snapshot = JSON.stringify(building);
const mesh = (geometry, extruded = false) => {
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  if (extruded) { result.rotation.x = -Math.PI / 2; result.position.y = .12; }
  result.updateMatrixWorld(); return result;
};
const cast = (target, from, to, y, limit = 100) => new THREE.Raycaster(new THREE.Vector3(from[0], y, from[1]), new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize(), 0, limit).intersectObject(target);
const down = (target, p, y) => new THREE.Raycaster(new THREE.Vector3(p[0], y, p[1]), new THREE.Vector3(0, -1, 0), 0, .8).intersectObject(target);

test('laboratory corridors connect each floor while the round enclosure and outer walls remain walls', () => {
  const { at, circleU } = laboratoryLayout(building), geometry = laboratoryBodyGeometry(building, 21.6, 3.6), target = mesh(geometry, true);
  for (let floor = 0; floor < 6; floor++) {
    const y = .12 + floor * 3.6 + 1.2;
    for (const [a, b] of [[[1, 10.2], [67, 10.2]], [[57.1, 10.2], [57.1, 55]], [[circleU, 10.2], [circleU, 29]]]) {
      const from = at(...a), to = at(...b);
      assert.equal(cast(target, from, to, y, Math.hypot(to[0] - from[0], to[1] - from[1])).length, 0, 'Blue routes and the round-room doorway are open');
    }
    assert.ok(cast(target, at(circleU, 34), at(circleU + 8, 34), y, 8).length, 'The round outline is an enclosed wall, not an open void');
    assert.ok(cast(target, at(57.1, 35), at(60, 35), y, 4).length, 'The right passage retains its outside wall');
    for (const [u, v] of [[16, 10.2], [57.1, 35], [circleU, 20]]) {
      assert.ok(down(target, at(u, v), .12 + floor * 3.6 + .4).length, 'Every blue route has a continuous floor slab');
    }
  }
  assert.ok(geometry.getAttribute('position').count / 3 < 8000);
  assert.equal(JSON.stringify(building), snapshot);
  geometry.dispose();
});

test('only floors one through four retain the white projection; upper floors have a flat wall', () => {
  for (const floorHeight of [3.6, 4.2]) {
    const { at } = laboratoryLayout(building), geometry = laboratoryBodyGeometry(building, floorHeight * 6, floorHeight), target = mesh(geometry, true);
    for (let floor = 0; floor < 6; floor++) {
      const y = .12 + floor * floorHeight + 1.5;
      assert.equal(cast(target, at(-2, 26), at(-4, 26), y, 2).length > 0, floor < 4);
      if (floor >= 4) assert.ok(cast(target, at(-2, 1.8), at(-2, .2), y, 2).length, 'A plain wall replaces the removed theatre connection');
    }
    const cut = laboratoryBodyGeometry(building, floorHeight * 3, floorHeight);
    cut.computeBoundingBox(); assert.ok(Math.abs(cut.boundingBox.max.z - floorHeight * 3) < 1e-4);
    geometry.dispose(); cut.dispose();
  }
});

test('yellow edges have guards instead of solid walls or glazing, and the green stairwell connects the floors', () => {
  const info = buildingLevels(building), layout = laboratoryLayout(building);
  const configured = { ...building, floorCorridors: layout.corridors, stairwells: [layout.stair] };
  const rails = teachingRailGeometry(configured, info.sections, info.floorHeight), body = laboratoryBodyGeometry(building, info.height, info.floorHeight);
  for (let floor = 0; floor < 6; floor++) {
    const y = .12 + floor * info.floorHeight + .25 + 1.05;
    assert.ok(cast(mesh(rails), layout.at(22, 18), layout.at(22, 15), y, 3).length, 'The open side has a guard on every floor');
    assert.equal(cast(mesh(body, true), layout.at(22, 18), layout.at(22, 15), y, 3).length, 0, 'No wall blocks the view outside');
    assert.equal(cast(mesh(body, true), layout.at(layout.stairU, 7.5), layout.at(layout.stairU, 6.1), y, 2).length, 0, 'The staircase entrance is open');
  }
  const stairs = teachingStairGeometry(configured, info.sections, info.floorHeight), shaft = stairwellShaft(layout.stair);
  assert.ok(stairs.concrete.getAttribute('position').count > 0);
  const center = shaft.outer.slice(0, 4).reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
  for (let floor = 1; floor < 6; floor++) assert.equal(down(mesh(body, true), center, .12 + floor * info.floorHeight + .4).length, 0, 'Floor slabs never plug the staircase shaft');
  assert.ok(rails.userData.photoOcclusionMask.every(n => n === 0));
  assert.deepEqual(polygonClipping.difference([layout.stair.opening.outer], [building.outer]), [], 'The staircase is wholly inside the building, with no projecting stair tower');
  assert.ok(Math.abs(layout.corridorWest - layout.circleU - layout.circleRadius - layout.roomWidth * 2) < 1e-6, 'Two complete stairwell widths separate the round room and the right corridor');
  for (let floor = 0; floor < 6; floor++) {
    const level = .12 + floor * info.floorHeight;
    for (const side of [-1, 1]) for (const v of [26.5, 28, 31, 33.5]) {
      const u = layout.circleU + side * (layout.circleRadius - .15);
      assert.ok(down(mesh(body,true),layout.at(u,v),level+.4).length, 'The full corridor width has a continuous floor where it meets the round building');
      assert.ok(cast(mesh(rails),layout.at(u,v),layout.at(u+side,v),level+.25+1.05,1).length, 'Both guards reach the round outside wall without an exposed gap');
    }
  }
  [rails, body, ...Object.values(stairs)].forEach(g => g.dispose());
});

test('the annotated front wall, recessed left staircase and right-hand wall returns follow the corrected plan', () => {
  const layout = laboratoryLayout(building), { at } = layout;
  assert.ok(Math.abs(layout.stairU + layout.roomWidth / 2 - 20.5) < .03, 'The staircase occupies the left recess next to the theatre, instead of the corridor centre');
  const body = laboratoryBodyGeometry(building, 21.6, 3.6), target = mesh(body, true);
  for (let floor = 0; floor < 6; floor++) {
    const y = .12 + floor * 3.6 + 1.5;
    assert.ok(cast(target, at(30, 7.5), at(30, 5), y, 3).length, 'The continuous black wall sits behind the blue route');
    assert.equal(cast(target, at(34.25, 10), at(34.25, 7), y, 3).length, 0, 'The previous central stairwell is removed');
    assert.ok(cast(target, at(52, 14), at(52, 18), y, 4).length, 'The inside end of the left wall band turns back at the corridor');
    assert.ok(cast(target, at(67, 16), at(67, 13), y, 3).length, 'The right wall band has the annotated end return');
  }
  body.dispose();
});

test('the white connection is part of the theatre outline, with the recess road open only on the ground floor', () => {
  const wall = building.facade.connectionWall;
  assert.ok(wall.includes(building.outer[1]) || wall.some(p => p.every((n,i) => n === building.outer[1][i])), 'The lower connecting wall reaches the annotated outer corner');
  assert.deepEqual(wall.at(-1), building.outer[11]);
  const direction = (a,b) => b.map((n,i) => n-a[i]);
  const cross = (a,b) => a[0]*b[1]-a[1]*b[0];
  const road = direction(...building.groundPassages[0].points.slice(2,4));
  const slanted = direction(wall[2],wall[3]), straight = direction(wall[3],wall[4]);
  assert.ok(Math.abs(cross(road,slanted))/(Math.hypot(...road)*Math.hypot(...slanted)) < 1e-8, 'Only the upper edge of the projecting connection is parallel to the road');
  assert.ok(Math.abs(cross(slanted,straight)) > 1, 'The projecting edge turns into a straight lower wall instead of continuing diagonally');
  const info = buildingLevels(theatre), connection = info.sections.find(p => p.id === 'laboratory-connection');
  assert.equal(connection.floors, 4);
  const main = info.sections.find(p => p.id === 'main');
  assert.deepEqual(polygonClipping.union([main.outer, ...main.holes], [connection.outer, ...connection.holes]), polygonClipping.union([theatre.outer, ...theatre.holes]));
  assert.ok(connection.outer.some(p => p[0] === building.outer[1][0] && p[1] === building.outer[1][1]));
  const { at } = laboratoryLayout(building), body = laboratoryBodyGeometry(building, 21.6, 3.6), target = mesh(body, true);
  assert.equal(building.groundPassages[0].sourcePathId, 'way/855459414');
  for (let floor = 0; floor < 6; floor++) {
    const hits = cast(target, at(5.8, 7.5), at(5.8, 5), .12 + floor * 3.6 + 2.8, 3);
    assert.equal(hits.length > 0, floor > 0, 'The existing road crosses the recess beneath the retained upper-floor wall');
  }
  const labLevels = buildingLevels(building), layout = laboratoryLayout(building);
  const rails = teachingRailGeometry({ ...building, floorCorridors: layout.corridors }, labLevels.sections, labLevels.floorHeight), guard = mesh(rails);
  for (const rise of [.5, 1.05]) for (let floor = 0; floor < 6; floor++) {
    assert.equal(cast(guard, at(2.5, 18), at(2.5, 15), .12 + floor * 3.6 + .25 + rise, 3).length > 0, floor > 0, 'Ground-floor guards leave the road open while the upper guards remain');
  }
  assert.equal(down(target, at(5.8, .4), .6).length, 0, 'No raised floor slab blocks the road at the passage');
  const theatreBodies = info.sections.map(p => buildingGeometry(p, p.height, info.floorHeight));
  const theatreGroup = new THREE.Group(); theatreBodies.forEach(g => theatreGroup.add(mesh(g, true))); theatreGroup.updateMatrixWorld();
  for (let floor = 0; floor < 6; floor++) assert.equal(cast(theatreGroup, at(-2, 26), at(-4, 26), .12 + floor * info.floorHeight + 1.5, 2).length > 0, floor < 4, 'The shared projection belongs to the lower theatre floors and is absent on floors five and six');
  theatreBodies.forEach(g => g.dispose()); body.dispose(); rails.dispose();
});

test('the transparent glass roof retains the original canopy outline and stays at the top', () => {
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus);
  const info = buildingLevels(building);
  assert.equal(building.skylights[0].outline, 'outer');
  const roofs = buildingSkylightGeometry(building, info.sections);
  assert.equal(roofs.length, 1); assert.equal(roofs[0].opacity, .24);
  const vertices = roofs[0].glass.getAttribute('position');
  const xs = building.outer.map(p => p[0]), zs = building.outer.map(p => p[1]);
  roofs[0].glass.computeBoundingBox(); const bounds = roofs[0].glass.boundingBox;
  assert.ok(Math.abs(bounds.min.x - Math.min(...xs)) < 1e-4 && Math.abs(bounds.max.z - Math.max(...zs)) < 1e-4);
  assert.ok(bounds.min.y > info.height && bounds.max.y < info.height + .3);
  assert.equal(roofs[0].glass.userData.photoOcclusionMask.length, vertices.count / 3);
  assert.equal(roofs[0].frame.userData.photoOcclusionMask.length, roofs[0].frame.index.count / 3);
  assert.equal(buildingSkylightGeometry(building, info.sections, info.floorHeight * 4).length, 0);
  const lines = buildingFloorLineGeometry(building, info.sections, info.floorHeight);
  assert.ok(lines.getAttribute('position').count > 0);
  roofs.forEach(r => { r.glass.dispose(); r.frame.dispose(); }); lines.dispose();
});

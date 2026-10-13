import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { standsArchitecture, standsStairLayout, standsBasementStairLayout } from '../src/venue-geometry.ts';
import { undergroundLayout, undergroundEntranceStairs, undergroundFloorElevation } from '../src/underground-geometry.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';

test('the stand stair descends halfway, turns back on a clear landing, then reaches the badminton approach', () => {
  const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
  const site = JSON.parse(fs.readFileSync(new URL('../public/data/site.json', import.meta.url)));
  const stand = campus.buildings.find(b => b.id === 'way/855459409'), info = buildingLevels(stand, site.buildingOverrides[stand.id]);
  const corridor = undergroundLayout(campus.features).areas.get('local/underground-corridor');
  const upper = standsStairLayout(stand), lower = standsBasementStairLayout(stand, corridor.feature.height);
  assert.deepEqual(corridor.feature.entranceStairs, lower.stairs);
  assert.deepEqual(corridor.feature.ceilingOpenings, [lower.ceilingOpening]);
  assert.deepEqual(corridor.feature.ceilingCutouts[0], { footprint: lower.roofFootprint, height: lower.landingRoofHeight });
  const flights = undergroundEntranceStairs(corridor.feature).slice(1);
  assert.deepEqual(flights.map(flight => flight.steps), [11, 11]);
  assert.equal(flights[0].bottomHeight, flights[1].topHeight);
  assert.ok(Math.abs(flights[0].bottomHeight - (flights[0].topHeight + flights[1].bottomHeight) / 2) < 1e-8, 'The turn happens halfway down');
  const axes = flights.map(flight => [(flight.to[0] - flight.from[0]) / flight.length, (flight.to[1] - flight.from[1]) / flight.length]);
  assert.ok(axes[0][0] * axes[1][0] + axes[0][1] * axes[1][1] < -.99999, 'The lower run returns in the opposite direction');
  const hall = campus.features.find(f => f.id === 'local/underground-badminton');
  for (const shape of [...flights.map(flight => flight.footprint), lower.turn]) {
    assert.deepEqual(polygonClipping.difference([shape.outer], [corridor.feature.outer]), [], 'Both flights and the turn stay inside the existing corridor');
    assert.deepEqual(polygonClipping.intersection([shape.outer], [hall.outer]), [], 'They do not consume a badminton court');
  }
  const standModel = standsArchitecture(stand, info.height, info.floorHeight);
  const corridorModel = undergroundDetailGeometry(corridor.feature, corridor.footprints, corridor.openings, corridor.connections);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = (geometry, building = false) => {
    const object = new THREE.Mesh(geometry, material);
    if (building) object.position.y = info.baseElevation;
    if (building && geometry === standModel.body) object.rotation.x = -Math.PI / 2;
    object.updateMatrixWorld(); return object;
  };
  const floorMeshes = [mesh(standModel.body, true), mesh(standModel.stairTreads, true), mesh(corridorModel.floor)];
  const obstacles = [...Object.values(standModel).map(g => mesh(g, true)), ...Object.values(corridorModel).map(g => mesh(g))];
  const ray = (point, y, direction, far, objects = obstacles) => new THREE.Raycaster(new THREE.Vector3(point[0], y, point[1]), direction, 0, far).intersectObjects(objects);
  const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
  const sample = (p, height) => {
    const floor = ray(p, height + .12, down, .25, floorMeshes)[0];
    assert.ok(floor && Math.abs(floor.point.y - height) < 1e-4, `Each turn and tread has a supporting floor: ${JSON.stringify(p)}, expected ${height}, actual ${floor?.point.y}`);
    assert.equal(ray(p, height + .06, up, 2, obstacles).length, 0, 'The walking route has two metres of headroom');
  };
  try {
    const u = (upper.u1 + upper.end) / 2;
    const turnStart = upper.at(u, upper.center), turnEnd = upper.at(u, lower.center);
    for (const t of [0, .25, .5, .75, 1]) sample(turnStart.map((n, i) => n + (turnEnd[i] - n) * t), lower.stairs[0].topHeight);
    const direction = new THREE.Vector3(turnEnd[0] - turnStart[0], 0, turnEnd[1] - turnStart[1]).normalize();
    assert.equal(ray(turnStart, lower.stairs[0].topHeight + 1.6, direction, Math.hypot(turnEnd[0] - turnStart[0], turnEnd[1] - turnStart[1])).length, 0, 'The original sidewall and the underground roof seam leave the upper turn open');
    for (const flight of flights) for (const [i, tread] of flight.treads.entries()) {
      const p = flight.at(flight.length * (i + .5) / flight.steps);
      for (const offset of [-.3, 0, .3]) sample(flight.at(flight.length * (i + .5) / flight.steps, offset), tread.height);
      assert.ok(Math.abs(undergroundFloorElevation(corridor.feature, p) + .045 - tread.height) < 1e-8, 'Photo-floor calculations follow the same actual steps');
    }
    const middleU = (lower.middle + lower.turnEnd) / 2;
    const middleStart = upper.at(middleU, lower.center), middleEnd = upper.at(middleU, lower.returnCenter);
    for (const t of [0, .25, .5, .75, 1]) {
      const p = middleStart.map((n, i) => n + (middleEnd[i] - n) * t);
      sample(p, lower.midHeight);
      assert.ok(Math.abs(undergroundFloorElevation(corridor.feature, p) + .045 - lower.midHeight) < 1e-8);
    }
    for (const [from, to] of [[flights[0].to, middleStart], [middleStart, middleEnd], [middleEnd, flights[1].from]]) {
      const dir = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize(), distance = Math.hypot(to[0] - from[0], to[1] - from[1]);
      assert.equal(ray(from, lower.midHeight + 1.6, dir, distance).length, 0, 'Walls and guards leave the full return path open');
    }
    for (let i = 0; i < 16; i++) for (const offset of [-1.1, 0, 1.1]) sample(upper.at(upper.u0 + (upper.u1 - upper.u0) * (i + .5) / 16, upper.center + offset),
      info.baseElevation + .12 + upper.top + (upper.bottom - upper.top) * (i + 1) / 16);
    const flight = flights[1], end = flight.at(flight.length + .15);
    sample(end, corridor.feature.height + .045);
    const forward = new THREE.Vector3(flight.to[0] - flight.from[0], 0, flight.to[1] - flight.from[1]).normalize();
    assert.equal(ray(flight.at(flight.length - .1), flight.bottomHeight + 1.6, forward, .3).length, 0, 'The bottom step opens directly onto the existing corridor');
  } finally {
    [...Object.values(standModel), ...Object.values(corridorModel)].forEach(g => g.dispose()); material.dispose();
  }
});

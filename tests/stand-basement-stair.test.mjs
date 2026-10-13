import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { standsArchitecture, standsStairLayout, standsBasementStairLayout } from '../src/venue-geometry.ts';
import { undergroundLayout, undergroundEntranceStairs, undergroundFloorElevation } from '../src/underground-geometry.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';

test('the stand landing turns into a clear descending flight and reaches the badminton approach at its actual floor', () => {
  const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
  const site = JSON.parse(fs.readFileSync(new URL('../public/data/site.json', import.meta.url)));
  const stand = campus.buildings.find(b => b.id === 'way/855459409'), info = buildingLevels(stand, site.buildingOverrides[stand.id]);
  const corridor = undergroundLayout(campus.features).areas.get('local/underground-corridor');
  const upper = standsStairLayout(stand), lower = standsBasementStairLayout(stand, corridor.feature.height);
  assert.deepEqual(corridor.feature.entranceStairs, [lower.stair]);
  assert.deepEqual(corridor.feature.ceilingCutouts[0], { footprint: lower.roofFootprint, height: lower.landingRoofHeight });
  const flight = undergroundEntranceStairs(corridor.feature)[1];
  assert.deepEqual(polygonClipping.difference([flight.footprint.outer], [corridor.feature.outer]), [], 'The new stair stays entirely in the approach corridor');
  const hall = campus.features.find(f => f.id === 'local/underground-badminton');
  assert.deepEqual(polygonClipping.intersection([flight.footprint.outer], [hall.outer]), [], 'It does not consume a badminton court');
  const standModel = standsArchitecture(stand, info.height, info.floorHeight);
  const corridorModel = undergroundDetailGeometry(corridor.feature, corridor.footprints, corridor.openings, corridor.connections);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = (geometry, building = false) => {
    const object = new THREE.Mesh(geometry, material);
    if (building) object.position.y = info.baseElevation;
    if (building && geometry === standModel.body) object.rotation.x = -Math.PI / 2;
    object.updateMatrixWorld(); return object;
  };
  const floorMeshes = [mesh(standModel.body, true), mesh(corridorModel.floor)];
  const obstacles = [...Object.values(standModel).map(g => mesh(g, true)), ...Object.values(corridorModel).map(g => mesh(g))];
  const ray = (point, y, direction, far, objects = obstacles) => new THREE.Raycaster(new THREE.Vector3(point[0], y, point[1]), direction, 0, far).intersectObjects(objects);
  const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
  const sample = (p, height) => {
    const floor = ray(p, height + .12, down, .25, floorMeshes)[0];
    assert.ok(floor && Math.abs(floor.point.y - height) < 1e-4, `Each turn and tread has a supporting floor: ${JSON.stringify(p)}, expected ${height}, actual ${floor?.point.y}`);
    assert.equal(ray(p, height + .06, up, 2, obstacles).length, 0, 'The walking route has two metres of headroom');
  };
  try {
    const u = (upper.u1 + upper.end) / 2, center = (lower.stair.from[0] - stand.outer[0][0]) * upper.across[0]
      + (lower.stair.from[1] - stand.outer[0][1]) * upper.across[1];
    const turnStart = upper.at(u, upper.center), turnEnd = upper.at(u, center);
    for (const t of [0, .25, .5, .75, 1]) sample(turnStart.map((n, i) => n + (turnEnd[i] - n) * t), lower.stair.topHeight);
    const direction = new THREE.Vector3(turnEnd[0] - turnStart[0], 0, turnEnd[1] - turnStart[1]).normalize();
    assert.equal(ray(turnStart, lower.stair.topHeight + 1.6, direction, Math.hypot(turnEnd[0] - turnStart[0], turnEnd[1] - turnStart[1])).length, 0, 'The original sidewall and the underground roof seam leave the turn open');
    for (const [i, tread] of flight.treads.entries()) {
      const p = flight.at(flight.length * (i + .5) / flight.steps);
      for (const offset of [-.3, 0, .3]) sample(flight.at(flight.length * (i + .5) / flight.steps, offset), tread.height);
      assert.ok(Math.abs(undergroundFloorElevation(corridor.feature, p) + .045 - tread.height) < 1e-8, 'Photo-floor calculations follow the same actual steps');
    }
    const end = flight.at(flight.length + .15);
    sample(end, corridor.feature.height + .045);
    const forward = new THREE.Vector3(flight.to[0] - flight.from[0], 0, flight.to[1] - flight.from[1]).normalize();
    assert.equal(ray(flight.at(flight.length - .1), flight.bottomHeight + 1.6, forward, .3).length, 0, 'The bottom step opens directly onto the existing corridor');
  } finally {
    [...Object.values(standModel), ...Object.values(corridorModel)].forEach(g => g.dispose()); material.dispose();
  }
});

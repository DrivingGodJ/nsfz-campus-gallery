import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GYM_ID, gymArchitecture, teachingRailGeometry } from '../src/architecture-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const teaching = campus.buildings.find(b => b.id === 'way/855459420');
const gym = campus.buildings.find(b => b.id === GYM_ID);
const bridge = campus.features.find(f => f.id === 'local/footbridge');
const vector = p => new THREE.Vector3(p[0], 0, p[1]);
const mesh = (geometry, extrusion = false) => {
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  if (extrusion) { result.rotation.x = -Math.PI / 2; result.position.y = .12; }
  result.updateMatrixWorld(); return result;
};
const dispose = model => Object.values(model).forEach(geometry => geometry.dispose());

test('walkway guard rails follow both courtyard rings, respect floor cutaways, and never hide photos', () => {
  const info = buildingLevels(teaching, site.buildingOverrides[teaching.id]);
  for (const floor of [undefined, 1, 3]) {
    const geometry = teachingRailGeometry(teaching, info.sections, info.floorHeight, floor && floor * info.floorHeight);
    const vertices = geometry.getAttribute('position');
    assert.equal(geometry.userData.photoOcclusionMask.length, vertices.count / 3);
    assert.ok(geometry.userData.photoOcclusionMask.every(value => value === 0));
    if (floor === 1) assert.equal(vertices.count, 0, 'No floating upper-floor rails remain when only the ground floor is shown');
    else {
      geometry.computeBoundingBox();
      assert.ok(geometry.boundingBox.max.y < (floor || 6) * info.floorHeight, 'Rails stay below the selected ceiling');
      for (const section of info.sections) {
        const ring = section.holes[0], middle = ring.slice(0, -1).reduce((s, p) => s.add(vector(p)), new THREE.Vector3()).divideScalar(ring.length - 1);
        for (let edge = 0; edge < ring.length - 1; edge++) {
          const target = vector(ring[edge]).lerp(vector(ring[edge + 1]), .4), direction = target.clone().sub(middle).normalize();
          const start = target.clone().addScaledVector(direction, -1); start.y = .12 + info.floorHeight + .25 + 1.05;
          const hit = new THREE.Raycaster(start, direction, 0, 1.5).intersectObject(mesh(geometry))[0];
          assert.ok(hit, 'Every side of both atriums has an upper-floor guard rail');
          assert.equal(geometry.userData.photoOcclusionMask[hit.faceIndex], 0);
        }
      }
    }
    assert.ok(vertices.count / 3 < 14000, 'Rail detail stays modest even with every floor visible');
    geometry.dispose();
  }
});

test('gym roof bows smoothly along the archived long axis without changing calibrated peak height', () => {
  for (const override of [site.buildingOverrides[gym.id], { floors: 5, floorHeight: 4.2 }]) {
    const info = buildingLevels(gym, override), model = gymArchitecture(gym, info.height, info.floorHeight, bridge);
    const roof = mesh(model.roof), [a, b] = [gym.outer[0], gym.outer[3]], across = vector(gym.outer[1]).sub(vector(a)).multiplyScalar(.5);
    const heights = [.04, .25, .5, .75, .96].map(t => {
      const point = vector(a).lerp(vector(b), t).add(across); point.y = 100;
      const hit = new THREE.Raycaster(point, new THREE.Vector3(0, -1, 0)).intersectObject(roof)[0];
      assert.ok(hit, 'Roof faces are outward-facing and cover the hall'); return hit.point.y;
    });
    assert.ok(heights[0] < heights[1] && heights[1] < heights[2]);
    assert.ok(Math.abs(heights[0] - heights[4]) < 1e-4 && Math.abs(heights[1] - heights[3]) < 1e-4);
    assert.ok(Math.abs(heights[2] - (info.height + .12)) < 1e-4, 'Peak follows current floor metadata instead of the archive’s old height');
    const point = vector(a).lerp(vector(b), .5).add(across); point.y = 2;
    assert.ok(new THREE.Raycaster(point, new THREE.Vector3(0, 1, 0)).intersectObject(roof).length, 'Underside is visible from inside');
    assert.ok(Object.values(model).reduce((n, g) => n + g.getAttribute('position').count / 3, 0) < 5000, 'No dense archive window grid or texture geometry is imported');
    dispose(model);
  }
});

test('gym bridge enters a real doorway while the adjacent wall and ground remain intact', () => {
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]), model = gymArchitecture(gym, info.height, info.floorHeight, bridge);
  const body = mesh(model.body, true), connection = bridge.connections.find(c => c.type === 'deck');
  const [a, b] = connection.points, direction = vector(b).sub(vector(a)).normalize();
  const start = vector(a); start.y = .12 + info.floorHeight + 1.6;
  assert.equal(new THREE.Raycaster(start, direction, 0, 7).intersectObject(body).length, 0, 'The bridge route has no solid facade cap');
  const beside = start.clone().add(new THREE.Vector3(direction.z, 0, -direction.x).multiplyScalar(3));
  assert.ok(new THREE.Raycaster(beside, direction, 0, 7).intersectObject(body).length, 'The entrance does not erase the neighboring facade');
  const center = vector(gym.center); center.y = 2;
  assert.ok(new THREE.Raycaster(center, new THREE.Vector3(0, -1, 0)).intersectObject(body).length, 'The hall retains its ground slab');
  dispose(model);
});

test('gym roof and upper window band disappear in a lower-floor cutaway without mutating source data', () => {
  const original = JSON.stringify([gym, site, bridge]);
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]);
  for (const floor of [1, 2]) {
    const model = gymArchitecture(gym, info.height, info.floorHeight, bridge, floor * info.floorHeight);
    assert.equal(model.roof.getAttribute('position').count, 0);
    assert.equal(model.glass.getAttribute('position').count, 0);
    model.body.computeBoundingBox();
    assert.ok(model.body.boundingBox.max.z <= floor * info.floorHeight + 1e-5, 'No upper shell remains above the selected floor');
    dispose(model);
  }
  assert.equal(JSON.stringify([gym, site, bridge]), original);
});

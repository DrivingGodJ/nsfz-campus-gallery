import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { GYM_ID, gymArchitecture } from '../src/architecture-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { GYM_WALL, gymFrame, gymStairLayout } from '../src/gym-interior.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const gym = campus.buildings.find(building => building.id === GYM_ID);
const bridge = campus.features.find(feature => feature.id === 'local/footbridge');
const frame = gymFrame(gym), layout = gymStairLayout(frame), BASE = .12;
const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0);
const at = (u, v, y) => {
  const point = frame.at(u, v);
  return new THREE.Vector3(point[0], BASE + y, point[1]);
};
const mesh = (geometry, extrusion = false) => {
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (extrusion) { object.rotation.x = -Math.PI / 2; object.position.y = BASE; }
  object.updateMatrixWorld();
  return object;
};
const dispose = (model, objects = []) => {
  objects.forEach(object => object.material.dispose());
  Object.values(model).forEach(geometry => geometry.dispose());
};
const hitAt = (object, u, v, height, direction = down, far = 1) =>
  new THREE.Raycaster(at(u, v, height), direction, 0, far).intersectObject(object)[0];
const expectFloor = (object, u, v, height, message) => {
  const hit = hitAt(object, u, v, height + .1);
  assert.ok(hit && Math.abs(hit.point.y - BASE - height) < 1e-4, message);
};

test('gym second floor covers the hall outside the stair bay and remains open to the arched roof', () => {
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]);
  const original = JSON.stringify([gym, bridge]);
  const model = gymArchitecture(gym, info.height, info.floorHeight, bridge);
  const court = mesh(model.court), stairs = mesh(model.stairs), body = mesh(model.body, true), roof = mesh(model.roof);
  try {
    // Sample the full playing-hall footprint, including both long wall edges.
    for (const u of [GYM_WALL + .03, 4, layout.bayStart / 2, layout.bayStart - .03]) {
      for (const v of [GYM_WALL + .03, frame.width / 2, frame.width - GYM_WALL - .03]) {
        expectFloor(court, u, v, info.floorHeight, 'The basketball hall has a continuous second-floor surface');
      }
    }
    assert.equal(hitAt(court, layout.bayStart + .5, frame.width / 2, info.floorHeight + .1), undefined,
      'The court floor does not fill or alter the existing stair bay');
    for (const u of [4, layout.bayStart / 2, layout.bayStart - 1]) {
      for (const v of [4, frame.width / 2, frame.width - GYM_WALL - 3.3]) {
        const eye = info.floorHeight + 1.5;
        assert.equal(hitAt(stairs, u, v, eye, up, info.height), undefined,
          'No third- or fourth-floor slab closes the space above the basketball hall');
        assert.equal(hitAt(body, u, v, eye, up, info.height), undefined,
          'The shell does not introduce an internal ceiling over the court');
        const roofHit = hitAt(roof, u, v, eye, up, info.height);
        assert.ok(roofHit && roofHit.point.y > BASE + 3 * info.floorHeight,
          'The existing arched roof is the top enclosure of the open hall');
      }
    }
    const marks = model.courtLines.getAttribute('position');
    assert.ok(marks.count > 0, 'The large second-floor hall includes visible basketball markings');
    for (let i = 0; i < marks.count; i++) {
      const [u, v] = frame.local([marks.getX(i), marks.getZ(i)]);
      assert.ok(u >= GYM_WALL && u <= layout.bayStart && v >= GYM_WALL && v <= frame.width - GYM_WALL,
        'Basketball markings stay inside the hall floor');
      assert.ok(marks.getY(i) > BASE + info.floorHeight && marks.getY(i) < BASE + info.floorHeight + .05,
        'Markings lie just above the second-floor surface');
    }
    assert.equal(JSON.stringify([gym, bridge]), original, 'The hall layout preserves the calibrated building and bridge');
  } finally { dispose(model, [court, stairs, body, roof]); }
});

test('gym third-floor spectator gallery follows the marked long wall and connects to the stair landing', () => {
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]);
  const model = gymArchitecture(gym, info.height, info.floorHeight, bridge);
  const stairs = mesh(model.stairs), glass = mesh(model.stairGlass);
  const height = 2 * info.floorHeight, innerV = frame.width - GYM_WALL - 3;
  try {
    for (const u of [GYM_WALL + .03, 4, layout.bayStart / 2, layout.bayStart - .03]) {
      for (const v of [innerV + .03, innerV + 1.5, frame.width - GYM_WALL - .03]) {
        expectFloor(stairs, u, v, height, 'The third-floor gallery spans the marked long side');
      }
      assert.equal(hitAt(stairs, u, innerV - .03, height + .1), undefined,
        'The gallery stays three metres wide and leaves the basketball hall open');
      assert.equal(hitAt(stairs, u, GYM_WALL + 1, height + .1), undefined,
        'No spectator slab is added on the unmarked track-side wall');
    }
    for (const u of [layout.bayStart - .05, layout.bayStart, layout.bayStart + .05, layout.u0 - .1]) {
      expectFloor(stairs, u, innerV + 1.5, height, 'The gallery and stair landing meet at the same height without a gap');
    }
    const towardWall = new THREE.Vector3(frame.across[0], 0, frame.across[1]);
    for (const u of [4, layout.bayStart / 2, layout.bayStart - 1]) {
      assert.ok(hitAt(glass, u, innerV - .25, height + .5, towardWall, .6),
        'The gallery inner edge has a guard facing the open basketball hall');
    }
  } finally { dispose(model, [stairs, glass]); }
});

test('gym floor cutaways remove the selected ceiling while preserving the court and gallery below it', () => {
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]);
  const galleryV = frame.width - GYM_WALL - 1.5;
  for (const floor of [1, 2, 3]) {
    const model = gymArchitecture(gym, info.height, info.floorHeight, bridge, floor * info.floorHeight);
    const stairs = mesh(model.stairs), court = mesh(model.court);
    try {
      assert.equal(model.roof.getAttribute('position').count, 0, 'The roof is removed for each selected floor');
      for (const key of ['court', 'courtLines']) {
        assert.equal(model[key].getAttribute('position').count > 0, floor >= 2,
          `${key} appears only once the second-floor hall is below the selected ceiling`);
      }
      const galleryHit = hitAt(stairs, layout.bayStart / 2, galleryV, 2 * info.floorHeight + .1);
      assert.equal(Boolean(galleryHit), floor >= 3,
        'The third-floor platform is removed as the second-floor ceiling and retained when viewing the third floor');
      if (floor >= 2) expectFloor(court, layout.bayStart / 2, frame.width / 2, info.floorHeight,
        'Removing the ceiling keeps the actual second-floor basketball floor');
      for (const [key, geometry] of Object.entries(model)) {
        if (key === 'body' || geometry.getAttribute('position').count === 0) continue;
        geometry.computeBoundingBox();
        assert.ok(geometry.boundingBox.max.y <= BASE + floor * info.floorHeight + 1e-5,
          `${key} has no floating geometry above the selected floor`);
      }
    } finally { dispose(model, [stairs, court]); }
  }
});

test('gym court and gallery follow editable floor heights and do not create floors outside the building', () => {
  for (const floorHeight of [2.8, 3.6, 4.2]) for (const floors of [1, 2, 4]) {
    const info = buildingLevels(gym, { floors, floorHeight });
    const model = gymArchitecture(gym, info.height, info.floorHeight, bridge);
    const court = mesh(model.court), stairs = mesh(model.stairs);
    try {
      assert.equal(model.court.getAttribute('position').count > 0, floors >= 2);
      if (floors >= 2) expectFloor(court, layout.bayStart / 2, frame.width / 2, floorHeight,
        'The second-floor surface tracks the editable floor height');
      const galleryHit = hitAt(stairs, layout.bayStart / 2, frame.width - GYM_WALL - 1.5, 2 * floorHeight + .1);
      assert.equal(Boolean(galleryHit), floors >= 3, 'A gallery is generated only when the building has a third floor');
      if (galleryHit) assert.ok(Math.abs(galleryHit.point.y - BASE - 2 * floorHeight) < 1e-4,
        'The spectator gallery tracks the editable third-floor height');
    } finally { dispose(model, [court, stairs]); }
  }
});

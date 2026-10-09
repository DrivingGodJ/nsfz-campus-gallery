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

test('lowering the gym preserves the absolute bridge doorway and landing while upper floors and roof move down exactly one metre', () => {
  const fixedBridge = { ...bridge, deckHeight: 5.52, levelAnchor: undefined };
  const oldGym = { ...gym, baseElevation: 3.6 }, loweredGym = { ...gym, baseElevation: 2.6 };
  const floorHeight = 3.6, height = 4 * floorHeight;
  const oldModel = gymArchitecture(oldGym, height, floorHeight, fixedBridge);
  const model = gymArchitecture(loweredGym, height, floorHeight, fixedBridge);
  const worldMesh = (geometry, base, extrusion = false) => {
    const object = mesh(geometry, extrusion); object.position.y += base; object.updateMatrixWorld(); return object;
  };
  const oldStairs = worldMesh(oldModel.stairs, 3.6), stairs = worldMesh(model.stairs, 2.6);
  const oldCourt = worldMesh(oldModel.court, 3.6), court = worldMesh(model.court, 2.6);
  const oldRoof = worldMesh(oldModel.roof, 3.6), roof = worldMesh(model.roof, 2.6);
  const bodies = [worldMesh(oldModel.body, 3.6, true), worldMesh(model.body, 2.6, true)];
  const panes = [worldMesh(oldModel.glass, 3.6), worldMesh(model.glass, 2.6)];
  const connection = fixedBridge.connections.find(c => c.type === 'deck' && c.buildingId === gym.id);
  const u = frame.local(connection.points[0])[0], middle = (layout.u0 + layout.u1) / 2;
  const rayDown = (object, u, v, y) => {
    const p = frame.at(u, v);
    return new THREE.Raycaster(new THREE.Vector3(p[0], y + .1, p[1]), down, 0, .5).intersectObject(object)[0];
  };
  try {
    for (const object of [oldStairs, stairs]) {
      const hit = rayDown(object, u, 3, 5.52);
      assert.ok(hit && Math.abs(hit.point.y - 5.52) < 1e-4, 'Both entrance platforms meet the unchanged bridge exactly');
    }
    for (const [object, base] of [[oldCourt, 3.6], [court, 2.6]]) {
      const hit = rayDown(object, layout.bayStart / 2, frame.width / 2, base + BASE + floorHeight);
      assert.ok(hit && Math.abs(hit.point.y - base - BASE - floorHeight) < 1e-4);
    }
    const oldUpper = rayDown(oldStairs, middle, 3, 3.6 + BASE + 1.5 * floorHeight);
    const upper = rayDown(stairs, middle, 3, 2.6 + BASE + 1.5 * floorHeight);
    assert.ok(oldUpper && upper && Math.abs(oldUpper.point.y - upper.point.y - 1) < 1e-4,
      'The next half-floor platform follows the building, rather than the fixed bridge');
    const unchangedUpper = geometry => {
      const positions = geometry.getAttribute('position'), result = [];
      for (let i = 0; i < positions.count; i++) if (positions.getY(i) > BASE + 4.7) {
        result.push(positions.getX(i), positions.getY(i), positions.getZ(i));
      }
      return result;
    };
    for (const key of ['stairs', 'stairRails', 'stairGlass']) {
      assert.deepEqual(unchangedUpper(model[key]), unchangedUpper(oldModel[key]),
        `${key} above the first flights keeps the original relative geometry, so world height changes by precisely one metre`);
    }
    oldRoof.geometry.computeBoundingBox(); roof.geometry.computeBoundingBox();
    assert.deepEqual(model.roof.getAttribute('position').array, oldModel.roof.getAttribute('position').array,
      'The roof keeps its shape and local height');
    assert.ok(Math.abs(oldRoof.geometry.boundingBox.max.y + 3.6 - roof.geometry.boundingBox.max.y - 2.6 - 1) < 1e-6);

    for (let i = 0; i < bodies.length; i++) {
      const p = frame.at(u, -1), direction = new THREE.Vector3(...[frame.across[0], 0, frame.across[1]]);
      const atHeight = (object, y) => new THREE.Raycaster(new THREE.Vector3(p[0], y, p[1]), direction, 0, 1.5).intersectObject(object);
      for (const y of [5.62, 7.12, 9.02]) {
        assert.equal(atHeight(bodies[i], y).length, 0, 'The complete exterior doorway remains at its original absolute height');
        assert.equal(atHeight(panes[i], y).length, 0, 'Glazing does not block that doorway');
      }
      for (const y of [5.42, 9.22]) assert.ok(atHeight(panes[i], y).length,
        'The glazing immediately below and above fixes both doorway boundaries at the original world heights');
    }
    for (const [a, b, v0, v1, bottom, top, steps] of [
      [middle + layout.gap / 2, layout.u1, layout.near, layout.far, .16, 2.8, 15],
      [layout.u0, middle - layout.gap / 2, layout.far, layout.near, 2.8, 3.6, 5]
    ]) for (let step = 0; step < steps; step++) {
      const y = 2.6 + BASE + bottom + (top - bottom) * (step + 1) / steps;
      const hit = rayDown(stairs, (a + b) / 2, v0 + (v1 - v0) * (step + .5) / steps, y);
      assert.ok(hit && Math.abs(hit.point.y - y) < 1e-4, 'Each of the 15/5 first-flight treads matches the actual rise');
    }
  } finally {
    dispose(oldModel, [oldStairs, oldCourt, oldRoof, ...bodies.slice(0, 1), ...panes.slice(0, 1)]);
    dispose(model, [stairs, court, roof, ...bodies.slice(1), ...panes.slice(1)]);
  }
});

test('a 2.8 metre gym floor meets the fixed bridge with a flat return and usable headroom without degenerate stair runs', () => {
  const loweredGym = { ...gym, baseElevation: 2.6 }, fixedBridge = { ...bridge, deckHeight: 5.52, levelAnchor: undefined };
  const floorHeight = 2.8, middle = (layout.u0 + layout.u1) / 2;
  for (const floors of [1, 2, 4]) {
    const height = floorHeight * floors, model = gymArchitecture(loweredGym, height, floorHeight, fixedBridge);
    const stairs = mesh(model.stairs);
    const objects = ['body', 'stairs', 'glass', 'frame', 'stairGlass', 'stairRails'].map(key => mesh(model[key], key === 'body'));
    try {
      if (floors === 1) assert.equal(model.stairs.getAttribute('position').count, 0, 'A one-floor gym does not invent upper flights');
      else {
        expectFloor(stairs, middle, 3, 2.8, 'The fixed bridge has its full-width entry platform');
        for (const v of [layout.far + .1, 7, layout.near - .1]) {
          expectFloor(stairs, (layout.u0 + middle - layout.gap / 2) / 2, v, 2.8,
            'The zero-rise return is a continuous flat connection to the second floor');
        }
        for (const offset of [-.8, 0, .8]) {
          const p = frame.at(middle + offset, -1);
          const ray = new THREE.Raycaster(new THREE.Vector3(p[0], BASE + 2.8 + 2.2, p[1]),
            new THREE.Vector3(frame.across[0], 0, frame.across[1]), 0, 4);
          assert.equal(ray.intersectObjects(objects).length, 0, 'Upper landings preserve at least 2.2 metres of entry headroom');
        }
      }
      for (const [key, geometry] of Object.entries(model)) {
        const positions = geometry.getAttribute('position');
        assert.ok(positions.array.every(Number.isFinite), `${key} has finite geometry at the coincident landing height`);
        if (['stairs', 'stairRails', 'stairGlass'].includes(key) && positions.count) {
          geometry.computeBoundingBox();
          assert.ok(geometry.boundingBox.max.y <= BASE + height + 1e-5, `${key} stays inside the modeled floor count`);
        }
      }
    } finally { dispose(model, [stairs, ...objects]); }
  }
});

test('cutaways at the fixed bridge landing remove its ceiling slab and flat return exactly at the boundary', () => {
  const loweredGym = { ...gym, baseElevation: 2.6 }, fixedBridge = { ...bridge, deckHeight: 5.52, levelAnchor: undefined };
  const floorHeight = 2.8, middle = (layout.u0 + layout.u1) / 2;
  for (const ceiling of [2.79, 2.8, 2.81, 5.6]) {
    const model = gymArchitecture(loweredGym, 4 * floorHeight, floorHeight, fixedBridge, ceiling), stairs = mesh(model.stairs);
    try {
      assert.equal(Boolean(hitAt(stairs, middle, 3, 2.9, down, .3)), ceiling > 2.8,
        'The selected ceiling removes the landing slab, including its underside');
      assert.equal(Boolean(hitAt(stairs, (layout.u0 + middle - layout.gap / 2) / 2, 7, 2.9, down, .3)), ceiling > 2.8,
        'The flat return has the same exact cutaway boundary as the entry landing');
      for (const [key, geometry] of Object.entries(model)) {
        const positions = geometry.getAttribute('position');
        assert.ok(positions.array.every(Number.isFinite), `${key} stays finite around the cut boundary`);
        if (key === 'body' || !positions.count) continue;
        geometry.computeBoundingBox();
        assert.ok(geometry.boundingBox.max.y <= BASE + ceiling + 1e-5, `${key} has no remaining detail above the selected ceiling`);
      }
    } finally { dispose(model, [stairs]); }
  }
});

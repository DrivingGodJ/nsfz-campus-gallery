import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { classroomWindowLayout } from '../src/teaching-classrooms.ts';
import { classroomGlazingGeometry } from '../src/architecture-geometry.ts';
import { STAND_OFFICE_ID, standOfficeGeometry, standOfficeOpenings, standOfficeStairLayout, standOfficeWindows } from '../src/stand-office-geometry.ts';
import { STANDS_ID, standsArchitecture, standsFrame } from '../src/venue-geometry.ts';
import { bridgeLayout } from '../src/bridge-geometry.ts';
import { bridgeNetGeometry } from '../src/bridge-net-geometry.ts';
import { undergroundSkylights, undergroundEntranceStair } from '../src/underground-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const office = campus.buildings.find(building => building.id === STAND_OFFICE_ID), info = buildingLevels(office);
const dispose = model => Object.values(model).forEach(geometry => geometry.dispose());
function mesh(geometry, extrusion = false) {
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (extrusion) { object.rotation.x = -Math.PI / 2; object.position.y = .12; }
  object.updateMatrixWorld(); return object;
}
function ray(object, point, normal, y) {
  const origin = new THREE.Vector3(point[0] - normal[0] * .6, .12 + y, point[1] - normal[1] * .6);
  return new THREE.Raycaster(origin, new THREE.Vector3(normal[0], 0, normal[1]), 0, 1.2).intersectObject(object);
}

test('DSC06875 office glazing persists on the photographed face in two rows only, with actual wall apertures', () => {
  const config = office.classroomWindows, layout = standOfficeStairLayout(office);
  assert.deepEqual(config, corrections.buildings.find(building => building.id === STAND_OFFICE_ID).classroomWindows);
  assert.deepEqual(config.facadeLines, [[office.outer[0], office.outer[1]]]);
  const original = classroomWindowLayout([[office.outer]], config, info.height, info.floorHeight), windows = standOfficeWindows(office, info.height, info.floorHeight);
  assert.equal(original.length, 16);
  assert.equal(windows.length, 18, 'Only the pane at each new front entry is divided');
  assert.deepEqual([...new Set(windows.map(window => Math.floor(window.bottom / info.floorHeight) + 1))], [2, 3]);
  const openings = standOfficeOpenings(office, info.height, info.floorHeight);
  assert.equal(openings.length, windows.length + 3, 'Three entry apertures are additional doors, never glass');
  const geometry = buildingGeometry(info.sections[0], info.height, info.floorHeight, [], [], [], config, [], [], false, openings), body = mesh(geometry, true);
  try {
    const [window] = windows, point = [(window.from[0] + window.to[0]) / 2, (window.from[1] + window.to[1]) / 2];
    assert.equal(ray(body, point, layout.inward, (window.bottom + window.top) / 2).length, 0, 'Window sits in an open wall rather than over opaque masonry');
    assert.ok(ray(body, point, layout.inward, 1.6).length, 'Unconfirmed bottom-row masonry stays solid');
    const back = [(office.outer[2][0] + office.outer[3][0]) / 2, (office.outer[2][1] + office.outer[3][1]) / 2];
    assert.ok(ray(body, back, layout.inward.map(value => -value), info.floorHeight + 1.6).length, 'Unphotographed rear face stays solid');
    const glazing = classroomGlazingGeometry(windows, config), panes = mesh(glazing.glass);
    try {
      assert.equal(glazing.glass.attributes.position.count / 6, windows.length, 'Door entries receive no panes');
      for (const door of openings.slice(windows.length)) {
        const center = [(door.from[0] + door.to[0]) / 2, (door.from[1] + door.to[1]) / 2], y = (door.bottom + door.top) / 2;
        assert.equal(ray(body, center, layout.inward, y).length, 0, 'Floor landing joins an open front entry');
        assert.equal(ray(panes, center, layout.inward, y).length, 0, 'Window glass does not seal a new front entry');
      }
      const station = p => (p[0] - layout.front[0]) * layout.along[0] + (p[1] - layout.front[1]) * layout.along[1];
      assert.deepEqual(windows.filter(window => station(window.from) > 5.2), original.filter(window => station(window.from) > 5.2), 'All panes beyond the first bay are unchanged');
    } finally { dispose(glazing); panes.material.dispose(); }
  } finally { geometry.dispose(); body.material.dispose(); }
});

test('extended office meets the athletics edge without covering the right-half roof glazing or its doorway', () => {
  const corridor = campus.features.find(feature => feature.id === 'local/underground-corridor');
  const [from, to] = corridor.points, length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const right = [-(to[1] - from[1]) / length, (to[0] - from[0]) / length];
  for (const point of office.outer.slice(1, 3)) {
    const side = (point[0] - from[0]) * right[0] + (point[1] - from[1]) * right[1];
    assert.ok(Math.abs(side) < 1e-7, 'The complete end wall reaches the platform edge');
  }
  assert.deepEqual(office.outer[0], [-71.13283412142542, -80.86820063867947], 'The stand-side stair anchor stays put');
  const solid = [[office.outer]];
  for (const light of undergroundSkylights(corridor).slice(0, 1)) {
    assert.equal(polygonClipping.intersection(solid, [[light.outer]]).length, 0, 'Daylight still reaches the right-half glass');
  }
  assert.equal(polygonClipping.intersection(solid, [[undergroundEntranceStair(corridor).footprint.outer]]).length, 0, 'The existing entrance remains unobstructed');
});

test('external white switchbacks reach each raised floor and the office roof with connected landings', () => {
  const layout = standOfficeStairLayout(office), model = standOfficeGeometry(office, info.height, info.floorHeight), concrete = mesh(model.concrete);
  const [x, z] = layout.at(.65, 0), down = y => new THREE.Raycaster(new THREE.Vector3(x, .12 + y + .15, z), new THREE.Vector3(0, -1, 0), 0, .3).intersectObject(concrete);
  try {
    for (const height of [.25, info.floorHeight + .25, 2 * info.floorHeight + .25, info.height]) {
      assert.ok(down(height).length, `Landing exists at ${height} m`);
      assert.ok(Math.abs(down(height)[0].point.y - .12 - height) < 1e-4);
    }
    const wallConnection = layout.at(.65, layout.stair.width / 2);
    assert.ok((wallConnection[0] - layout.front[0]) * layout.inward[0] + (wallConnection[1] - layout.front[1]) * layout.inward[1] > 0, 'Landings overlap the front wall instead of leaving a gap');
    assert.ok(layout.stair.axis[0] * layout.along[0] + layout.stair.axis[1] * layout.along[1] > .9999, 'Flights run along the front facade rather than the short end');
    const positions = model.concrete.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i) - layout.front[0], z = positions.getZ(i) - layout.front[1];
      assert.ok(x * layout.inward[0] + z * layout.inward[1] < .0401, 'The stair projects outside the front facade');
      assert.ok(x * layout.along[0] + z * layout.along[1] > .6, 'The stair stays inside the office end and never occupies the stand');
    }
    assert.ok(Object.values(model).reduce((sum, geometry) => sum + geometry.attributes.position.count / 3, 0) < 5000, 'A batched detail rather than hundreds of separate meshes');
  } finally { dispose(model); concrete.material.dispose(); }
});

test('office stairs and roof guards obey every cutaway ceiling and do not hide photo markers', () => {
  for (const floor of [1, 2, 3]) {
    const height = floor * info.floorHeight, model = standOfficeGeometry(office, info.height, info.floorHeight, height);
    try {
      for (const geometry of Object.values(model)) {
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          assert.ok(Number.isFinite(positions.getX(i)) && Number.isFinite(positions.getY(i)) && Number.isFinite(positions.getZ(i)));
          assert.ok(positions.getY(i) <= .12 + height + 1e-4, 'No slab, tread, post or bar survives above the selected ceiling');
        }
        assert.equal(geometry.userData.photoOcclusionMask.length, positions.count / 3);
        assert.ok(geometry.userData.photoOcclusionMask.every(value => value === 0));
      }
      const positions = model.rails.attributes.position;
      assert.ok(Array.from({ length: positions.count }, (_, i) => positions.getY(i)).every(y => y < .12 + info.height), 'Roof guard rails vanish in the top-floor cutaway');
    } finally { dispose(model); }
  }
});

test('front office stair and landings do not intersect the footbridge or field-facing net', () => {
  const layout = standOfficeStairLayout(office), half = layout.stair.width / 2, length = layout.stair.landingDepth * 2 + layout.stair.run;
  const outline = [layout.at(0, -half - .08), layout.at(length, -half - .08), layout.at(length, half + .04), layout.at(0, half + .04)];
  outline.push(outline[0]);
  const bridge = campus.features.find(feature => feature.id === 'local/footbridge'), structure = bridgeLayout(bridge, bridge.height);
  assert.equal(polygonClipping.intersection([outline], structure.footprint.map(shape => [shape.outer, ...shape.holes])).length, 0, 'No bridge deck or connection occupies the stair footprint');
  const net = bridgeNetGeometry(bridge, structure.railChains), positions = net.attributes.position;
  try {
    const stairBounds = new THREE.Box2().setFromPoints(outline.map(point => new THREE.Vector2(...point)));
    const netBounds = new THREE.Box2().setFromPoints(Array.from({ length: positions.count }, (_, i) => new THREE.Vector2(positions.getX(i), positions.getZ(i))));
    assert.ok(positions.count > 0);
    assert.equal(stairBounds.intersectsBox(netBounds), false, 'Field-side wire net remains clear of the office stairs');
  } finally { net.dispose(); }
});

test('moving the white stair to the front restores all stand-end structure without moving seats', () => {
  const stands = campus.buildings.find(building => building.id === STANDS_ID), levels = buildingLevels(stands), frame = standsFrame(stands);
  assert.equal((stands.cutouts || []).length, 0, 'No stair pocket remains in the stands');
  assert.equal((corrections.buildings.find(building => building.id === STANDS_ID).cutouts || []).length, 0);
  const model = standsArchitecture(stands, levels.height, levels.floorHeight), original = standsArchitecture({ ...stands, cutouts: [] }, levels.height, levels.floorHeight);
  const objects = Object.entries(model).map(([kind, geometry]) => mesh(geometry, kind === 'body'));
  const down = (objects, u, v) => { const [x, z] = frame.at(u, v); return new THREE.Raycaster(new THREE.Vector3(x, 25, z), new THREE.Vector3(0, -1, 0), 0, 30).intersectObjects(objects); };
  try {
    for (const u of [97.8, 98.5, 99.3]) for (const v of [.95, 3.5, 6.6]) assert.ok(down(objects, u, v).length, `Former stair pocket ${u}/${v} has its stand structure restored`);
    const tiers = ['tiersBlue', 'tiersGreen', 'tiersRed'];
    for (const [u, v] of [[98.5, 8.5], [95.5, 4.5], [45, 4.5]]) {
      const before = down(tiers.map(kind => mesh(original[kind])), u, v)[0], after = down(tiers.map(kind => mesh(model[kind])), u, v)[0];
      assert.ok(before && after, 'Seat beside or behind the stair slot remains present');
      assert.ok(before.point.distanceTo(after.point) < 1e-5, 'Every untouched terrace retains its exact height and location');
    }
    assert.ok(Object.values(model).reduce((sum, geometry) => sum + geometry.attributes.position.count / 3, 0) < 7000);
  } finally { dispose(model); dispose(original); objects.forEach(object => object.material.dispose()); }
});

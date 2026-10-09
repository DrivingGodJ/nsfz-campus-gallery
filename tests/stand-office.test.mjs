import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { classroomWindowLayout } from '../src/teaching-classrooms.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { STAND_OFFICE_ID, standOfficeGeometry, standOfficeOpenings, standOfficeStairLayout } from '../src/stand-office-geometry.ts';
import { STANDS_ID, standsArchitecture, standsFrame } from '../src/venue-geometry.ts';

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
  const windows = classroomWindowLayout([[office.outer]], config, info.height, info.floorHeight);
  assert.equal(windows.length, 14);
  assert.deepEqual([...new Set(windows.map(window => Math.floor(window.bottom / info.floorHeight) + 1))], [2, 3]);
  const openings = standOfficeOpenings(office, info.height, info.floorHeight);
  assert.equal(openings.length, windows.length + 3, 'Three entry apertures are additional doors, never glass');
  const geometry = buildingGeometry(info.sections[0], info.height, info.floorHeight, [], [], [], config, [], [], false, openings), body = mesh(geometry, true);
  try {
    const [window] = windows, point = [(window.from[0] + window.to[0]) / 2, (window.from[1] + window.to[1]) / 2];
    assert.equal(ray(body, point, layout.stair.axis, (window.bottom + window.top) / 2).length, 0, 'Window sits in an open wall rather than over opaque masonry');
    assert.ok(ray(body, point, layout.stair.axis, 1.6).length, 'Unconfirmed bottom-row masonry stays solid');
    const back = [(office.outer[2][0] + office.outer[3][0]) / 2, (office.outer[2][1] + office.outer[3][1]) / 2];
    assert.ok(ray(body, back, layout.stair.axis.map(value => -value), info.floorHeight + 1.6).length, 'Unphotographed rear face stays solid');
    for (const door of openings.slice(windows.length)) {
      assert.equal(ray(body, [(door.from[0] + door.to[0]) / 2, (door.from[1] + door.to[1]) / 2], layout.along, (door.bottom + door.top) / 2).length, 0, 'Floor landing joins a usable office entry');
    }
    const glazing = teachingWindowGeometry(office, info.sections, info.floorHeight);
    try { assert.equal(glazing.glass.attributes.position.count / 6, windows.length, 'Door entries receive no panes'); } finally { dispose(glazing); }
  } finally { geometry.dispose(); body.material.dispose(); }
});

test('external white switchbacks reach each raised floor and the office roof with connected landings', () => {
  const layout = standOfficeStairLayout(office), model = standOfficeGeometry(office, info.height, info.floorHeight), concrete = mesh(model.concrete);
  const [x, z] = layout.at(.65, 0), down = y => new THREE.Raycaster(new THREE.Vector3(x, .12 + y + .15, z), new THREE.Vector3(0, -1, 0), 0, .3).intersectObject(concrete);
  try {
    for (const height of [.25, info.floorHeight + .25, 2 * info.floorHeight + .25, info.height]) {
      assert.ok(down(height).length, `Landing exists at ${height} m`);
      assert.ok(Math.abs(down(height)[0].point.y - .12 - height) < 1e-4);
    }
    const wallConnection = layout.at(.65, -layout.stair.width / 2);
    assert.ok((wallConnection[0] - layout.front[0]) * layout.along[0] + (wallConnection[1] - layout.front[1]) * layout.along[1] > 0, 'Landings overlap the short wall instead of leaving a gap');
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

test('only the white stair pocket removes stand structure; rear seats stay in place and the slot gains guards', () => {
  const stands = campus.buildings.find(building => building.id === STANDS_ID), levels = buildingLevels(stands), frame = standsFrame(stands);
  assert.equal(stands.cutouts.length, 1, 'The explicit approved stair pocket is persisted');
  assert.deepEqual(stands.cutouts, corrections.buildings.find(building => building.id === STANDS_ID).cutouts);
  const model = standsArchitecture(stands, levels.height, levels.floorHeight), original = standsArchitecture({ ...stands, cutouts: [] }, levels.height, levels.floorHeight);
  const objects = Object.entries(model).map(([kind, geometry]) => mesh(geometry, kind === 'body'));
  const down = (objects, u, v) => { const [x, z] = frame.at(u, v); return new THREE.Raycaster(new THREE.Vector3(x, 25, z), new THREE.Vector3(0, -1, 0), 0, 30).intersectObjects(objects); };
  try {
    for (const u of [97.8, 98.5, 99.3]) for (const v of [.95, 3.5, 6.6]) {
      assert.equal(down(objects, u, v).length, 0, `Stair pocket ${u}/${v} contains no stand slab, wall, seat or rail`);
    }
    const tiers = ['tiersBlue', 'tiersGreen', 'tiersRed'];
    for (const [u, v] of [[98.5, 8.5], [95.5, 4.5], [45, 4.5]]) {
      const before = down(tiers.map(kind => mesh(original[kind])), u, v)[0], after = down(tiers.map(kind => mesh(model[kind])), u, v)[0];
      assert.ok(before && after, 'Seat beside or behind the stair slot remains present');
      assert.ok(before.point.distanceTo(after.point) < 1e-5, 'Every untouched terrace retains its exact height and location');
    }
    const [x, z] = frame.at(97.42, 4.5), guard = mesh(model.rails);
    assert.ok(new THREE.Raycaster(new THREE.Vector3(x, 25, z), new THREE.Vector3(0, -1, 0), 0, 30).intersectObject(guard).length, 'The exposed slot edge has a protective handrail');
    assert.ok(Object.values(model).reduce((sum, geometry) => sum + geometry.attributes.position.count / 3, 0) < 7000);
  } finally { dispose(model); dispose(original); objects.forEach(object => object.material.dispose()); }
});

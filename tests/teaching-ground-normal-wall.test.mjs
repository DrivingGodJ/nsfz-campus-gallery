import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(item => item.id === 'way/855459420');
const info = buildingLevels(building, site.buildingOverrides[building.id]);
const main = info.sections.find(section => section.id === 'main');
const BASE = .12;
function mesh(geometry) {
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  object.updateMatrixWorld(); return object;
}
function model(selectedFloor) {
  const cutawayHeight = selectedFloor && selectedFloor * info.floorHeight;
  const bodies = info.sections.map(section => {
    const geometry = buildingGeometry(section, Math.min(section.height, cutawayHeight ?? Infinity), info.floorHeight,
      building.groundPassages, building.floorCorridors.filter(item => item.partId === section.id),
      building.stairwells.filter(item => item.partId === section.id), building.classroomWindows,
      building.solidCores.filter(item => item.partId === section.id), building.cutouts.filter(item => item.partId === section.id),
      selectedFloor !== undefined);
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, BASE, 0); return mesh(geometry);
  });
  const glazing = teachingWindowGeometry(building, info.sections, info.floorHeight, cutawayHeight);
  const glass = mesh(glazing.glass), frames = mesh(glazing.frames);
  return { bodies, glass, frames, dispose: () => [...bodies, glass, frames].forEach(object => {
    object.geometry.dispose(); object.material.dispose();
  }) };
}
function segment(from, to) {
  const a = new THREE.Vector3(from[0], 0, from[1]), b = new THREE.Vector3(to[0], 0, to[1]);
  const direction = b.clone().sub(a).normalize();
  return { a, b, normal: new THREE.Vector3(-direction.z, 0, direction.x) };
}
function crossing(line, fraction, rise, halfWidth = .45) {
  const point = line.a.clone().lerp(line.b, fraction); point.y = BASE + rise;
  return new THREE.Raycaster(point.addScaledVector(line.normal, -halfWidth), line.normal, 0, halfWidth * 2);
}

test('both first-floor roads remain clear across their full usable width with ordinary classroom walls outside them', () => {
  const original = JSON.stringify(building);
  assert.deepEqual(building.groundPassages.map(item => [item.sourcePathId, item.width]), [
    ['way/1233313444', 4], ['way/1233313441', 4],
  ], 'Both surveyed four-metre roads remain in their established order');
  const wing = info.sections.find(section => section.id === 'sixth-floor-wing');
  const normal = segment(wing.outer[25], wing.outer[26]);
  const besideRoad = segment(wing.outer[35], wing.outer[36]);
  for (const selectedFloor of [undefined, 1]) {
    const object = model(selectedFloor);
    try {
      for (const passage of building.groundPassages) {
        const line = segment(...passage.points), direction = line.b.clone().sub(line.a).normalize();
        for (const offset of [-passage.width * .49, -passage.width * .25, 0, passage.width * .25, passage.width * .49]) {
          for (const rise of [.65, 1.6, 3]) {
            const origin = line.a.clone().addScaledVector(direction, -2).addScaledVector(line.normal, offset);
            origin.y = BASE + rise;
            assert.equal(new THREE.Raycaster(origin, direction, 0, line.a.distanceTo(line.b) + 4)
              .intersectObjects([...object.bodies, object.glass, object.frames]).length, 0,
              `The road ${passage.sourcePathId} stays clear at offset ${offset}, height ${rise}`);
          }
        }
      }
      for (const rise of [.65, 1.6, 3]) {
        assert.ok(crossing(normal, .1, rise).intersectObjects(object.bodies).length,
          'The ordinary classroom facade retains its wall jamb beyond the road');
        assert.ok(crossing(besideRoad, .1, rise).intersectObjects([...object.bodies, object.glass]).length,
          'Opening the road leaves its adjoining ordinary classroom facade enclosed by masonry or its real window');
      }
      assert.ok(crossing(normal, .5, .65).intersectObjects(object.bodies).length,
        'The ordinary classroom facade retains its sill masonry beyond the road');
      for (const rise of [1.6, 3]) {
        const ray = crossing(normal, .5, rise);
        assert.equal(ray.intersectObjects(object.bodies).length, 0, 'The preserved ordinary window has a real masonry aperture');
        assert.ok(ray.intersectObject(object.glass).length, 'The ordinary window remains beyond the road');
      }
    } finally { object.dispose(); }
  }
  assert.equal(JSON.stringify(building), original, 'Geometry preserves saved building and opening data');
});

test('the first-floor classroom is enclosed by its new recessed road-side wall and window without extending that wall upstairs', () => {
  const passage = building.groundPassages.find(item => item.sourcePathId === 'way/1233313441');
  assert.equal(passage.recessClassrooms, true, 'The confirmed road has an explicit recessed classroom enclosure');
  const axis = segment(...passage.points);
  const side = { ...axis,
    a: axis.a.clone().addScaledVector(axis.normal, passage.width / 2),
    b: axis.b.clone().addScaledVector(axis.normal, passage.width / 2),
  };
  const original = JSON.stringify(building);
  for (const selectedFloor of [undefined, 1]) {
    const object = model(selectedFloor);
    try {
      for (const fraction of [.25, .4, .55]) {
        assert.ok(crossing(side, fraction, .65).intersectObjects(object.bodies).length,
          `The west road edge has real first-floor sill masonry at t=${fraction}`);
      }
      for (const rise of [1.6, 3]) {
        const ray = crossing(side, .4, rise);
        assert.equal(ray.intersectObjects(object.bodies).length, 0, 'The new recessed window has a real wall aperture');
        assert.ok(ray.intersectObject(object.glass).length, 'The road-side classroom retains an actual pane across its new opening');
      }
      if (selectedFloor) continue;
      for (let floor = 2; floor <= main.floors; floor++) for (const rise of [.65, 1.6, 3]) {
        assert.equal(crossing(side, .4, (floor - 1) * info.floorHeight + rise)
          .intersectObjects([...object.bodies, object.glass, object.frames]).length, 0,
          `The new ground wall and glazing do not move the original upper classroom boundary on floor ${floor}`);
      }
    } finally { object.dispose(); }
  }
  assert.equal(JSON.stringify(building), original, 'Recessed-wall geometry preserves saved data');
});

test('the open ground corner and roads do not remove the complete upper-floor room or its shared end wall', () => {
  const room = building.solidCores.find(core => core.partId === main.id && Math.abs(core.outer[0][0] - 89.47396089486412) < 1e-6);
  assert.ok(room);
  const object = model();
  try {
    for (let edge = 0; edge < room.outer.length - 1; edge++) {
      const ray = crossing(segment(room.outer[edge], room.outer[edge + 1]), .5, 1.6);
      assert.equal(ray.intersectObjects([...object.bodies, object.glass, object.frames]).length, 0,
        `The former corner room remains unenclosed on its other first-floor edge ${edge}`);
    }
    const shared = segment(room.outer[3], room.outer[4]);
    for (let floor = 2; floor <= main.floors; floor++) {
      const base = (floor - 1) * info.floorHeight;
      assert.ok(crossing(shared, .5, base + .65).intersectObjects(object.bodies).length,
        `The upper room shared-end sill remains on floor ${floor}`);
      const pane = crossing(shared, .5, base + 1.6);
      assert.equal(pane.intersectObjects(object.bodies).length, 0, `Floor ${floor} keeps the ordinary upper-end window aperture`);
      assert.ok(pane.intersectObject(object.glass).length, `Floor ${floor} keeps its upper-end window above the ground road`);
    }
  } finally { object.dispose(); }
});

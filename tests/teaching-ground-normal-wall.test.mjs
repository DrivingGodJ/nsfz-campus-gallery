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

test('the first-floor shared classroom end has its normal wall and windows while the outside corridor stays open', () => {
  const shared = segment(main.outer[0], main.outer[20]);
  const original = JSON.stringify(building);
  for (const selectedFloor of [undefined, 1]) {
    const object = model(selectedFloor);
    try {
      for (const fraction of [.05, .7]) for (const rise of [.65, 1.6, 3]) {
        assert.ok(crossing(shared, fraction, rise).intersectObjects(object.bodies).length,
          `The original end-wall jamb remains at t=${fraction}, height ${rise}`);
      }
      for (const fraction of [.2, .5]) {
        assert.ok(crossing(shared, fraction, .65).intersectObjects(object.bodies).length,
          'The normal classroom end has a masonry window sill');
        for (const rise of [1.6, 3]) {
          const ray = crossing(shared, fraction, rise);
          assert.equal(ray.intersectObjects(object.bodies).length, 0, 'The ordinary end window retains a real wall aperture');
          assert.ok(ray.intersectObject(object.glass).length, 'The former road opening is enclosed by its normal glass pane');
        }
      }
      // The shared end is 11.364 m long: its final 3 m belong to the outside
      // corridor, rather than the classroom. A full-length cap would block it.
      for (const fraction of [.78, .86, .94]) for (const rise of [.65, 1.6, 3]) {
        assert.equal(crossing(shared, fraction, rise, 1.2).intersectObjects([...object.bodies, object.glass, object.frames]).length, 0,
          `The outside corridor crosses the shared end at t=${fraction}, height ${rise}`);
      }
    } finally { object.dispose(); }
  }
  assert.equal(JSON.stringify(building), original, 'Geometry preserves saved building and opening data');
});

test('restoring the normal shared wall does not create a first-floor corner room or obstruct the retained road', () => {
  const room = building.solidCores.find(core => core.partId === main.id && Math.abs(core.outer[0][0] - 89.47396089486412) < 1e-6);
  assert.ok(room);
  const object = model();
  try {
    for (let edge = 0; edge < 5; edge++) {
      const ray = crossing(segment(room.outer[edge], room.outer[edge + 1]), .5, 1.6);
      assert.equal(ray.intersectObjects([...object.bodies, object.glass, object.frames]).length, 0,
        `The former corner room remains unenclosed on its other first-floor edge ${edge}`);
    }
    const passage = building.groundPassages.find(item => item.sourcePathId === 'way/1233313444');
    assert.ok(passage);
    const line = segment(...passage.points), direction = line.b.clone().sub(line.a).normalize();
    for (const offset of [-passage.width * .45, 0, passage.width * .45]) {
      const origin = line.a.clone().addScaledVector(direction, -2).addScaledVector(line.normal, offset);
      origin.y = BASE + 1.6;
      assert.equal(new THREE.Raycaster(origin, direction, 0, line.a.distanceTo(line.b) + 4)
        .intersectObjects([...object.bodies, object.glass, object.frames]).length, 0,
      'The retained teaching-building road remains open across its full usable width');
    }
  } finally { object.dispose(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingRailGeometry, teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { stairwellFrame } from '../src/teaching-stairs.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420');
const stair = building.stairwells.find(s => s.partId === 'main' && s.internal);
const frame = stairwellFrame(stair);
const point = (u, v, y) => { const [x, z] = frame.at(u, v); return new THREE.Vector3(x, y, z); };
const across = new THREE.Vector3(frame.across[0], 0, frame.across[1]);
const along = new THREE.Vector3(frame.along[0], 0, frame.along[1]);
const mesh = (geometry, body = false) => {
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (body) { result.rotation.x = -Math.PI / 2; result.position.y = .12; }
  result.updateMatrixWorld(); return result;
};

function model(selectedFloor, floorHeight = 3.6) {
  const info = buildingLevels(building, { floorHeight });
  const section = info.sections.find(part => part.id === 'main');
  const height = Math.min(section.height, (selectedFloor ?? section.floors) * floorHeight);
  const bodies = buildingGeometry(section, height, floorHeight, building.groundPassages,
    building.floorCorridors.filter(c => c.partId === section.id), building.stairwells.filter(s => s.partId === section.id),
    building.classroomWindows, building.solidCores.filter(c => c.partId === section.id), building.cutouts.filter(c => c.partId === section.id), !!selectedFloor);
  const windows = teachingWindowGeometry(building, [section], floorHeight, selectedFloor && height);
  const rails = teachingRailGeometry(building, [section], floorHeight, selectedFloor && height);
  const objects = { body: mesh(bodies, true), glass: mesh(windows.glass), frames: mesh(windows.frames), rails: mesh(rails) };
  return { info, shown: selectedFloor ?? section.floors, objects,
    dispose: () => Object.values(objects).forEach(object => { object.geometry.dispose(); object.material.dispose(); }) };
}

test('the teaching east stair side joins the outer wall as opaque masonry on every occupied floor and cutaway', () => {
  const saved = corrections.buildings.find(b => b.id === building.id);
  assert.deepEqual(saved.solidCores, building.solidCores, 'Refreshes retain the same joined masonry');
  assert.deepEqual(saved.classroomWindows, building.classroomWindows, 'Refreshes retain the same opaque facade');
  for (const [selectedFloor, floorHeight] of [[undefined, 3.6], [1, 3.6], [3, 3.6], [5, 3.6], [undefined, 4.2]]) {
    const current = model(selectedFloor, floorHeight);
    for (let floor = 0; floor < current.shown; floor++) {
      for (const u of [-2.5, -.01, .01, 1.4, 3, 4.8, 6.1, 6.4]) for (const rise of [.55, 1.6, 3.3]) {
        const y = .12 + floor * floorHeight + rise;
        const outside = new THREE.Raycaster(point(u, 3.6, y), across.clone().negate(), 0, .9);
        const hit = outside.intersectObject(current.objects.body)[0];
        assert.ok(hit && hit.distance > .5 && hit.distance < .6, 'A continuous solid face follows the existing building end exactly');
        assert.equal(hit.object.geometry.userData.photoOcclusionMask[hit.faceIndex], 1, 'The joined side is opaque building masonry');
        assert.equal(outside.intersectObjects([current.objects.glass, current.objects.frames, current.objects.rails]).length, 0, 'No glass, frame or old corridor end guard remains on the solid side');
        const inside = new THREE.Raycaster(point(u, 2.2, y), across, 0, .9).intersectObject(current.objects.body)[0];
        if (u <= 6.1) assert.ok(inside && Math.abs(inside.distance - .25) < 1e-4, `The former narrow gap becomes one solid wall, continuous with the stair enclosure: ${selectedFloor}/${floor}/${u}/${rise}, hit ${inside?.distance}`);
      }
      const y = .12 + floor * floorHeight + 1.6;
      for (const u of [-2.8, -1.5, -.2, .7]) {
        const landing = new THREE.Raycaster(point(u, 0, y), new THREE.Vector3(0, -1, 0)).intersectObject(current.objects.body)[0];
        assert.ok(landing && Math.abs(landing.point.y - (.12 + floor * floorHeight + .25)) < 1e-4, 'The new wall leaves a fully triangulated floor through the corridor and stair landing');
      }
      const seam = new THREE.Raycaster(point(-2.5, 2.6, y), along, 0, 8.9);
      assert.equal(seam.intersectObject(current.objects.body).length, 0, 'The joined corridor and stair wall has no internal cap or seam');
      const entry = new THREE.Raycaster(point(-1.5, 0, y), along, 0, 2.5);
      assert.equal(entry.intersectObject(current.objects.body).length, 0, 'The stair entry stays open onto the three-metre corridor');
      const aisle = new THREE.Raycaster(point(-1.5, -4, y), across, 0, 6.4);
      assert.equal(aisle.intersectObject(current.objects.body).length, 0, 'The enclosure does not obstruct the existing corridor');
    }
    current.dispose();
  }
});

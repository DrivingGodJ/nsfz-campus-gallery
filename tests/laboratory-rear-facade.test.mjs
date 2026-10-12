import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { laboratoryBodyGeometry, laboratoryLayout, laboratoryWindows } from '../src/laboratory-geometry.ts';
import { laboratoryRearLayout, laboratoryRearOpenings, laboratoryRearFacadeGeometry } from '../src/laboratory-rear-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459411');
const before = JSON.stringify(building), info = buildingLevels(building, site.buildingOverrides[building.id]);
const faces = laboratoryRearLayout(building), openings = laboratoryRearOpenings(building, info.height, info.floorHeight);
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const body = laboratoryBodyGeometry(building, info.height, info.floorHeight), walls = new THREE.Mesh(body, material);
walls.rotation.x = -Math.PI / 2; walls.position.y = .12; walls.updateMatrixWorld();
const detail = laboratoryRearFacadeGeometry(building, info.height, info.floorHeight);
const opaque = new THREE.Group();
for (const kind of ['stone', 'brick', 'metal']) opaque.add(new THREE.Mesh(detail[kind], material));
opaque.updateMatrixWorld();
const cast = (target, face, station, y) => {
  const a = face.at(station, .5), b = face.at(station, -.6);
  return new THREE.Raycaster(new THREE.Vector3(a[0], .12 + y, a[1]), new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize(), 0, 1.1).intersectObject(target, true);
};
test.after(() => { body.dispose(); Object.values(detail).forEach(g => g.dispose()); material.dispose(); });

test('new windows occupy only the two photo-confirmed rear wall planes and keep the calibrated stair separate', () => {
  assert.deepEqual(faces.map(face => [face.from, face.to]), [[building.outer[11], building.outer[10]], [building.outer[9], building.outer[8]]]);
  assert.ok(faces.every(face => face.outside[1] > .98), 'Both elevations face north towards the office');
  assert.equal(faces[1].start, 3.8 + .28 * 2);
  assert.equal(laboratoryWindows(building, info.height, info.floorHeight).length, 1, 'The separately observed sixth-floor stair pane retains its allowlist');
  assert.equal(openings.length, 77, 'Six storeys of photographed bays omit the existing ground passage bay');
  assert.equal(openings.filter(opening => opening.spring !== undefined).length, 12);
});

test('all rear panes have actual through-openings, with masonry above and beside the rounded ground arches', () => {
  for (const opening of openings) {
    const face = faces[opening.face], y = opening.spring === undefined ? (opening.bottom + opening.top) / 2 : opening.spring;
    assert.equal(cast(walls, face, opening.center, y).length, 0, 'Glass cannot be placed over an intact wall');
    assert.equal(cast(opaque, face, opening.center, y).length, 0, 'The brick surround and skin keep the actual opening clear');
    assert.ok([-1, 1].some(side => cast(walls, face, opening.center + side * (opening.width / 2 + .35), y).length), 'The masonry pier stays solid on the side clear of the existing ground passage');
    if (opening.spring !== undefined) {
      const radius = opening.width / 2;
      assert.equal(cast(walls, face, opening.center, opening.top - .06).length, 0, 'The arched crown is a true opening');
      assert.ok(cast(walls, face, opening.center + radius * .86, opening.spring + radius * .8).length, 'The upper corners are masonry rather than rectangular holes');
      assert.ok(cast(walls, face, opening.center, opening.bottom - .15).length, 'The stone plinth below the opening stays solid');
    }
  }
});

test('rear details leave the ground road and lower stair wall intact, while upper panes retain the same real stair aperture', () => {
  const passageStation = faces[0].bay * 1.5;
  assert.equal(cast(walls, faces[0], passageStation, 1.5).length, 0, 'The existing four-metre passage still passes through the laboratory');
  assert.equal(cast(opaque, faces[0], passageStation, 1.5).length, 0, 'Pilasters and cladding do not seal the passage');
  assert.equal(cast(opaque, faces[0], passageStation, .4).length, 0, 'Continuous ventilation louvres are interrupted at the road opening');
  const stairStation = faces[1].start / 2;
  for (let floor = 0; floor < 5; floor++) assert.ok(cast(walls, faces[1], stairStation, floor * info.floorHeight + 1.5).length, 'Unknown lower stair windows remain masonry');
  assert.equal(cast(walls, faces[1], stairStation, 5 * info.floorHeight + 1.8).length, 0, 'The original calibrated sixth-floor stair window remains open');
  const { at, stairU } = laboratoryLayout(building);
  const a = at(stairU, 13), b = at(stairU, 10.7), direction = new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize();
  for (let floor = 0; floor < 6; floor++) assert.equal(new THREE.Raycaster(new THREE.Vector3(a[0], .12 + floor * info.floorHeight + 1.5, a[1]), direction, 0, 2.3).intersectObject(walls).length, 0, 'The stair entrance and existing circulation remain open');
});

test('facade detail remains clipped, batched, nonblocking for glazing, and independent of saved campus data', () => {
  assert.ok(body.attributes.position.count / 3 < 30000, 'Arch cut layers retain the existing wall triangle budget');
  assert.equal(body.userData.photoOcclusionMask.length, body.attributes.position.count / 3);
  for (const kind of ['glass', 'frames', 'joints', 'metal']) {
    assert.ok(detail[kind].attributes.position.count > 0);
    assert.ok(detail[kind].userData.photoOcclusionMask.every(n => n === 0), 'Transparent panes and thin members must not mask archive photos');
  }
  for (const floor of [1, 2, 4, 6]) {
    const cut = laboratoryRearFacadeGeometry(building, info.height, info.floorHeight, floor * info.floorHeight);
    for (const geometry of Object.values(cut)) {
      geometry.computeBoundingBox();
      assert.ok(geometry.boundingBox.max.y <= .12 + floor * info.floorHeight + 1e-4, 'No facade detail protrudes into a hidden storey');
      geometry.dispose();
    }
  }
  assert.equal(JSON.stringify(building), before, 'Adding geometry never changes saved data, stairs, route calibration, or unrelated buildings');
});

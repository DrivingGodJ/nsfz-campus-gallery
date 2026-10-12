import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { WEST_COLONNADE_ID, westColonnadeFaces, westColonnadeGeometry } from '../src/west-colonnade-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(building => building.id === WEST_COLONNADE_ID), info = buildingLevels(building, site.buildingOverrides[building.id]);
function meshes(model) {
  return Object.values(model).map(geometry => { const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld(); return mesh; });
}
function dispose(model, objects) { Object.values(model).forEach(geometry => geometry.dispose()); objects.forEach(object => object.material.dispose()); }

test('photographed western gallery has open bays, stone balusters and connected slabs on all five storeys', () => {
  const original = JSON.stringify(building), faces = westColonnadeFaces(building), model = westColonnadeGeometry(building, info.height, info.floorHeight), objects = meshes(model);
  const [face] = faces, station = (face.stations[0] + face.stations[1]) / 2;
  const forward = (u, y) => {
    const [x, z] = face.at(u, -.3);
    return new THREE.Raycaster(new THREE.Vector3(x, .12 + y, z), new THREE.Vector3(face.inward[0], 0, face.inward[1]), 0, 1.2).intersectObjects(objects);
  };
  const [x, z] = face.at(station, 2);
  const upward = y => new THREE.Raycaster(new THREE.Vector3(x, .12 + y, z), new THREE.Vector3(0, 1, 0), 0, info.floorHeight + .3).intersectObjects(objects);
  try {
    assert.equal(info.floors, 5);
    assert.ok(faces.every(face => face.length > 20));
    for (let floor = 0; floor < info.floors; floor++) {
      const y = floor * info.floorHeight;
      assert.equal(forward(station, y + 1.7).length, 0, 'No opaque wall or invented glazing fills a photographed open bay');
      assert.ok(forward(face.stations[1], y + 1.7).length, 'Square structural pier remains beside each bay');
      assert.ok(forward(station, y + 1.26).length, 'Continuous pale guard cap spans each bay');
      const ceiling = upward(y + 1.7)[0];
      assert.ok(ceiling);
      const expected = floor === info.floors - 1 ? info.height - .25 : (floor + 1) * info.floorHeight;
      assert.ok(Math.abs(ceiling.point.y - .12 - expected) < 1e-4, 'Every floor has its ceiling slab in the intact model');
    }
    assert.ok(model.rails.userData.photoOcclusionMask.every(value => value === 0), 'Fine decorative balusters do not hide photo markers');
    assert.equal(Object.keys(model).length, 4, 'Dark brick piers have one separate material batch');
    model.brick.computeBoundingBox();
    assert.ok(Math.abs(model.brick.boundingBox.min.y - .12 - info.floorHeight - .25) < 1e-4, 'Grey brick piers start on floor two; bottom piers remain pale stone');
    assert.ok(Object.values(model).reduce((count, geometry) => count + geometry.attributes.position.count / 3, 0) < 20000, 'All details use four static batches');
    assert.equal(JSON.stringify(building), original, 'Existing campus footprint and height data remain untouched');
  } finally { dispose(model, objects); }
});

test('the bottom gallery admits the lower ramp while the same upper-floor bay retains its guard', () => {
  const face = westColonnadeFaces(building).find(face => Math.hypot(face.to[0] - building.outer[1][0], face.to[1] - building.outer[1][1]) < 1e-6);
  assert.ok(face);
  const u = (face.stations.at(-2) + face.stations.at(-1)) / 2, [x, z] = face.at(u, -.3);
  const model = westColonnadeGeometry(building, info.height, info.floorHeight), objects = meshes(model);
  const across = y => new THREE.Raycaster(new THREE.Vector3(x, .12 + y, z), new THREE.Vector3(face.inward[0], 0, face.inward[1]), 0, 1.2).intersectObjects(objects);
  try {
    assert.equal(across(1.26).length, 0, 'No stone cap or balusters close the lower ramp entrance');
    assert.ok(across(info.floorHeight + 1.26).length, 'Upper storey still has its continuous balustrade');
  } finally { dispose(model, objects); }
});

test('every selected floor keeps its walkable floor and piers while its ceiling and every higher floor disappear', () => {
  const [face] = westColonnadeFaces(building), station = (face.stations[0] + face.stations[1]) / 2, [x, z] = face.at(station, 2);
  for (let floor = 1; floor <= info.floors; floor++) {
    const cut = floor * info.floorHeight, model = westColonnadeGeometry(building, info.height, info.floorHeight, cut), objects = meshes(model), y = .12 + (floor - 1) * info.floorHeight + 1.7;
    try {
      assert.equal(new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, 1, 0), 0, info.height).intersectObjects(objects).length, 0, 'Selected gallery is open to the sky');
      const down = new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0), 0, info.floorHeight).intersectObjects(objects)[0];
      assert.ok(down);
      assert.ok(Math.abs(down.point.y - (.12 + (floor - 1) * info.floorHeight + .25)) < 1e-4);
      for (const geometry of Object.values(model)) {
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          assert.ok(Number.isFinite(positions.getX(i)) && Number.isFinite(positions.getY(i)) && Number.isFinite(positions.getZ(i)));
          assert.ok(positions.getY(i) <= .12 + cut + 1e-4);
        }
      }
    } finally { dispose(model, objects); }
  }
});

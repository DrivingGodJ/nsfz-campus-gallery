import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { gymArchitecture } from '../src/architecture-geometry.ts';
import { gymFrame, gymStairLayout } from '../src/gym-interior.ts';
import { gymDetailGeometry, STANDS_ID, standsArchitecture, standsFrame, THEATRE_ID, theatreInteriorGeometry, theatreInteriorLayout } from '../src/venue-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const stands = campus.buildings.find(building => building.id === STANDS_ID);
const theatre = campus.buildings.find(building => building.id === THEATRE_ID);
const gym = campus.buildings.find(building => building.id === 'local/gymnasium');
const dispose = model => Object.values(model).forEach(geometry => geometry.dispose());
function mesh(geometry, extrusion = false) {
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (extrusion) { object.rotation.x = -Math.PI / 2; object.position.y = .12; }
  object.updateMatrixWorld(); return object;
}
function down(objects, [x, z], above = 30, distance = 40) {
  return new THREE.Raycaster(new THREE.Vector3(x, above, z), new THREE.Vector3(0, -1, 0), 0, distance).intersectObjects(objects);
}
function finiteAndClipped(model, ceiling) {
  for (const [key, geometry] of Object.entries(model)) {
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) {
      assert.ok(Number.isFinite(vertices.getX(i)) && Number.isFinite(vertices.getY(i)) && Number.isFinite(vertices.getZ(i)));
      assert.ok((key === 'body' ? vertices.getZ(i) : vertices.getY(i) - .12) <= ceiling + 1e-4, `${key} stays under the selected ceiling`);
    }
  }
}

test('stands have real ascending terraces, clear stair aisles, a partial canopy, and rooms beneath', () => {
  const original = JSON.stringify(stands), info = buildingLevels(stands, site.buildingOverrides[stands.id]), frame = standsFrame(stands);
  const model = standsArchitecture(stands, info.height, info.floorHeight), tiers = ['tiersBlue', 'tiersGreen', 'tiersRed'].map(key => mesh(model[key]));
  const front = down(tiers, frame.at(frame.length * .4, 2.25))[0], back = down(tiers, frame.at(frame.length * .4, frame.width - .6))[0];
  assert.ok(front && back && back.point.y > front.point.y + 2, 'The seating rises toward the back instead of retaining a box roof');
  const aisle = down(tiers, frame.at(frame.length * .53, frame.width / 2));
  assert.equal(aisle.length, 0, 'Colour seating blocks leave the stair aisle free');
  assert.ok(down([mesh(model.frames)], frame.at(frame.length * .53, frame.width / 2)).length, 'The free aisle has stair treads');
  assert.ok(down([mesh(model.canopy)], frame.at(frame.length / 2, frame.width / 2)).length);
  assert.equal(down([mesh(model.canopy)], frame.at(frame.length * .9, frame.width / 2)).length, 0, 'The canopy covers the photographed middle only');
  const body = mesh(model.body, true), origin = frame.at(frame.length * .4, frame.width / 2);
  assert.equal(new THREE.Raycaster(new THREE.Vector3(origin[0], 1.6, origin[1]), new THREE.Vector3(frame.along[0], 0, frame.along[1]), 0, 3).intersectObject(body).length, 0, 'Ground housing is hollow');
  const entry = frame.at(frame.length * .5, -1);
  assert.equal(new THREE.Raycaster(new THREE.Vector3(entry[0], 1.6, entry[1]), new THREE.Vector3(frame.across[0], 0, frame.across[1]), 0, 1.5).intersectObjects([body, mesh(model.glass)]).length, 0, 'A glass window never closes a room doorway');
  const towerEye = frame.at(1.55, -1), towerRay = new THREE.Raycaster(new THREE.Vector3(towerEye[0], .12 + info.floorHeight + 1.2, towerEye[1]), new THREE.Vector3(frame.across[0], 0, frame.across[1]), 0, 1.6);
  assert.ok(towerRay.intersectObject(body).length, 'Unconfirmed tower faces remain solid above the seating level');
  assert.equal(towerRay.intersectObject(mesh(model.glass)).length, 0, 'No guessed tower glazing is added');
  assert.ok(Object.values(model).reduce((sum, geometry) => sum + geometry.getAttribute('position').count / 3, 0) < 7000);
  assert.equal(JSON.stringify(stands), original);
  dispose(model);
});

test('venue details disappear above selected floors and never add photo-marker obstruction', () => {
  for (const [building, create] of [[stands, standsArchitecture], [theatre, theatreInteriorGeometry], [gym, gymDetailGeometry]]) {
    const info = buildingLevels(building, site.buildingOverrides[building.id]);
    for (const floor of [1, 2, 3]) {
      const model = create(building, info.height, info.floorHeight, floor * info.floorHeight);
      finiteAndClipped(model, floor * info.floorHeight);
      for (const [key, geometry] of Object.entries(model)) if (key !== 'body') {
        assert.equal(geometry.userData.photoOcclusionMask.length, geometry.getAttribute('position').count / 3);
        assert.ok(geometry.userData.photoOcclusionMask.every(value => value === 0));
      }
      if (floor === 1 && building.id !== STANDS_ID) assert.equal(Object.values(model).reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0), 0, 'No second-storey furniture floats in the ground-floor slice');
      if (floor <= 2 && building.id === STANDS_ID) assert.equal(model.canopy.getAttribute('position').count, 0);
      if (building.id === gym.id) assert.equal(model.lattice.getAttribute('position').count, 0, 'Roof trusses leave with the ceiling');
      dispose(model);
    }
  }
});

test('the second-floor theatre slice exposes raked seat rows and stage without moving its hall or terrace', () => {
  const original = JSON.stringify(theatre), info = buildingLevels(theatre), layout = theatreInteriorLayout(theatre, info.floorHeight);
  const model = theatreInteriorGeometry(theatre, info.height, info.floorHeight, 2 * info.floorHeight);
  const section = info.sections.find(section => section.id === 'main');
  const body = buildingGeometry(section, 2 * info.floorHeight, info.floorHeight, theatre.groundPassages,
    theatre.floorCorridors.filter(corridor => corridor.partId === 'main'), [], undefined, [], [], true);
  const room = mesh(body, true), furnishing = Object.values(model).map(geometry => mesh(geometry));
  const near = down(furnishing, layout.at(0, layout.firstRadius + .25))[0], back = down(furnishing, layout.at(0, layout.firstRadius + 12 * layout.rowDepth + .25))[0];
  assert.ok(near && back && back.point.y > near.point.y + .9, 'Back rows rise above the near rows');
  const stage = down([mesh(model.wood)], layout.at(0, 2))[0];
  assert.ok(stage && Math.abs(stage.point.y - (.12 + layout.floor + .45)) < 1e-4);
  const visible = down([room, ...furnishing], layout.at(0, 12));
  assert.ok(visible.length && visible[0].object !== room, 'The existing cutaway wall shell reveals actual auditorium geometry');
  assert.equal(model.rails.getAttribute('position').count, 0, 'The overhead balcony disappears with the second-floor ceiling');
  for (const corridor of theatre.floorCorridors) for (const [x, z] of corridor.points) {
    assert.equal(down(furnishing, [x, z], 2 * info.floorHeight + .12).length, 0, 'Furniture never projects into the confirmed hall');
  }
  assert.equal(JSON.stringify(theatre), original);
  assert.ok(Object.values(model).reduce((sum, geometry) => sum + geometry.getAttribute('position').count / 3, 0) < 13000);
  body.dispose(); dispose(model);
});

test('gym baskets and viewing benches stay on their actual levels while the basketball hall stays open', () => {
  const info = buildingLevels(gym, site.buildingOverrides[gym.id]), frame = gymFrame(gym), { bayStart } = gymStairLayout(frame);
  const model = gymDetailGeometry(gym, info.height, info.floorHeight), architecture = gymArchitecture(gym, info.height, info.floorHeight);
  model.blue.computeBoundingBox();
  assert.ok(Math.abs(model.blue.boundingBox.min.y - (.12 + info.floorHeight)) < 1e-4, 'Mobile basket bases rest directly on the playing floor');
  const courtLength = Math.min(28, bayStart - .38 - 4), center = (.38 + bayStart) / 2;
  for (const sign of [-1, 1]) {
    const rimU = center + sign * (courtLength / 2 - courtLength * 1.575 / 28);
    const rim = down([mesh(model.metal)], frame.at(rimU + .23, frame.width / 2), 10)[0];
    assert.ok(rim && Math.abs(rim.point.y - (.12 + info.floorHeight + 3.072)) < .012, 'The basket hoop aligns with the existing painted court centre');
  }
  const benches = down([mesh(model.blue)], frame.at(10, frame.width - .8))[0];
  assert.ok(benches && Math.abs(benches.point.y - (.12 + 2 * info.floorHeight + .46)) < .01, 'Benches belong to the third-floor gallery');
  const court = frame.at(bayStart / 2, frame.width / 2);
  assert.equal(down([mesh(model.blue), mesh(model.metal), mesh(model.glass)], court, 10).length, 0, 'The middle of the double-height basketball hall stays empty');
  assert.ok(down([mesh(architecture.court)], court, 10).length, 'Existing second-floor playing surface remains intact');
  assert.ok(model.lattice.getAttribute('position').count > 0);
  const vertices = model.screens.getAttribute('position'), normals = model.screens.getAttribute('normal');
  for (let i = 0; i < vertices.count; i += 3) {
    const a = new THREE.Vector3().fromBufferAttribute(vertices, i), b = new THREE.Vector3().fromBufferAttribute(vertices, i + 1), c = new THREE.Vector3().fromBufferAttribute(vertices, i + 2);
    const outward = new THREE.Vector3().fromBufferAttribute(normals, i);
    assert.ok(b.sub(a).cross(c.sub(a)).normalize().dot(outward) > .999, 'Reflected gym boxes retain outward winding and lighting');
  }
  assert.ok(Object.values(model).reduce((sum, geometry) => sum + geometry.getAttribute('position').count / 3, 0) < 4000);
  dispose(model); dispose(architecture);
});

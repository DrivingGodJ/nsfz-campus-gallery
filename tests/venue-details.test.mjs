import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { gymArchitecture } from '../src/architecture-geometry.ts';
import { gymFrame, gymStairLayout } from '../src/gym-interior.ts';
import { sportsGroundPlatformLayers } from '../src/sports-ground-geometry.ts';
import { undergroundLayout, undergroundCeilingSections } from '../src/underground-geometry.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';
import { gymDetailGeometry, STANDS_ID, standsArchitecture, standsFrame, standsStairLayout, THEATRE_ID, theatreInteriorGeometry, theatreInteriorLayout } from '../src/venue-geometry.ts';

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
  assert.ok(down([mesh(model.canopy)], frame.at(frame.length * .85, frame.width / 2)).length, 'The canopy shifts toward the adjoining office');
  assert.equal(down([mesh(model.canopy)], frame.at(frame.length * .27, frame.width / 2)).length, 0, 'The old opposite-end canopy area is uncovered');
  assert.equal(down([mesh(model.canopy)], frame.at(frame.length * .96, frame.width / 2)).length, 0, 'The roof remains partial rather than covering all seats');
  const body = mesh(model.body, true), origin = frame.at(frame.length * .4, frame.width / 2);
  assert.equal(new THREE.Raycaster(new THREE.Vector3(origin[0], 1.6, origin[1]), new THREE.Vector3(frame.along[0], 0, frame.along[1]), 0, 3).intersectObject(body).length, 0, 'Ground housing is hollow');
  const entry = frame.at(frame.length * .5, -1);
  assert.equal(new THREE.Raycaster(new THREE.Vector3(entry[0], 1.6, entry[1]), new THREE.Vector3(frame.across[0], 0, frame.across[1]), 0, 1.5).intersectObjects([body, mesh(model.glass)]).length, 0, 'A glass window never closes a room doorway');
  assert.ok(Object.values(model).reduce((sum, geometry) => sum + geometry.getAttribute('position').count / 3, 0) < 7000);
  assert.equal(JSON.stringify(stands), original);
  dispose(model);
});

test('stands extend their seats, platform and guardrails to the end without an upper tower', () => {
  const info = buildingLevels(stands, site.buildingOverrides[stands.id]), frame = standsFrame(stands);
  for (const cutoff of [undefined, 2 * info.floorHeight]) {
    const model = standsArchitecture(stands, info.height, info.floorHeight, cutoff);
    try {
      const tiers = ['tiersBlue', 'tiersGreen', 'tiersRed'].map(key => mesh(model[key]));
      const platform = mesh(model.frames), rails = mesh(model.rails), body = mesh(model.body, true);
      for (const u of [.35, 3.1, 5.9]) {
        const front = down(tiers, frame.at(u, 2.25))[0], back = down(tiers, frame.at(u, frame.width - .6))[0];
        assert.ok(front && back && back.point.y > front.point.y + 2, 'Ascending seats fill the former tower area');
        assert.ok(down([platform], frame.at(u, .95)).length, 'The front platform reaches the same end');
        assert.ok(down([rails], frame.at(u, .1)).length, 'The front guardrail continues across the former tower area');
        if (cutoff === undefined) assert.ok(down([rails], frame.at(u, frame.width - .12)).length, 'The rear guardrail also reaches the end');
      }
      assert.ok(down([rails], frame.at(.2, frame.width / 2)).length, 'The exposed end of the rising terraces has a side guardrail');
      const positions = model.body.getAttribute('position');
      for (let i = 0; i < positions.count; i++) assert.ok(positions.getZ(i) <= info.floorHeight + 1e-4, 'The ground housing cannot generate a tower above the seating level');
      const formerTower = frame.at(3.1, frame.width / 2);
      assert.ok(down([body], formerTower)[0].point.y <= .12 + info.floorHeight + 1e-4);
    } finally { dispose(model); }
  }
});

test('the office-side stand passage opens to the outside and turns right beneath the seats', () => {
  const original = JSON.stringify(stands), info = buildingLevels(stands, site.buildingOverrides[stands.id]), frame = standsFrame(stands);
  for (const cutoff of [undefined, info.floorHeight, 2 * info.floorHeight]) {
    const model = standsArchitecture(stands, info.height, info.floorHeight, cutoff);
    try {
      const body = mesh(model.body, true), objects = [body, mesh(model.glass), mesh(model.frames), mesh(model.rails)];
      const ray = (u, v, y, direction, distance) => {
        const p = frame.at(u, v);
        return new THREE.Raycaster(new THREE.Vector3(p[0], y, p[1]), new THREE.Vector3(direction[0], 0, direction[1]), 0, distance).intersectObjects(objects);
      };
      const entrance = frame.length - 3.85;
      const photo = site.photos.find(photo => photo.title === '_DSC1046'), heading = photo.heading * Math.PI / 180;
      const sightline = new THREE.Raycaster(new THREE.Vector3(photo.position.x, 1.6, photo.position.z), new THREE.Vector3(Math.sin(heading), 0, -Math.cos(heading)), 0, 40);
      assert.equal(sightline.intersectObject(body).length, 0, 'The photographed sightline still reaches outside through the corrected opening or adjacent glazing');
      assert.equal(ray(entrance, -1, 1.6, frame.across, 3).length, 0, 'The broad front entrance remains open');
      for (const offset of [-3, 0, 3]) assert.equal(ray(entrance + offset, -1, 1.6, frame.across, frame.width + 2).length, 0, 'The entire rear opening faces the field gate directly, without glass or a wall across it');
      const corridor = standsStairLayout(stands).v0 - .6;
      assert.equal(ray(entrance, corridor, 1.6, frame.along.map(value => -value), 15).length, 0, 'The room-side walkway reaches the stair head when turning right');
      assert.ok(ray(entrance, frame.width - 1, .5, frame.across, 2).length, 'The rear opening retains its low parapet');
      assert.ok(ray(frame.length * .905, -1, 1.6, frame.across, 2).length, 'The adjoining room window remains beside the entrance');
      const returnWall = ray(entrance, 2, 1.6, frame.along.map(value => -value), 6);
      assert.ok(returnWall.length, 'A side wall separates the adjoining room from the open passage');
      for (const [u, v] of [[entrance, 1], [entrance, corridor], [entrance - 10, corridor]]) {
        const floor = down([body], frame.at(u, v), 1.6, 2)[0];
        assert.ok(floor && Math.abs(floor.point.y - .32) < 1e-4, 'The entrance and right turn keep a continuous walkable floor');
      }
      if (cutoff !== info.floorHeight) {
        const ceiling = down([body], frame.at(entrance, 1))[0];
        assert.ok(ceiling && Math.abs(ceiling.point.y - (.12 + info.floorHeight)) < 1e-4, 'The seating deck remains above the new passage');
      }
    } finally { dispose(model); }
  }
  assert.equal(JSON.stringify(stands), original, 'The calibrated outline and photo positions are unchanged');
});

test('the glazed stand stair hall descends to a real open low-ground exit', () => {
  const info = buildingLevels(stands, site.buildingOverrides[stands.id]), layout = standsStairLayout(stands);
  const model = standsArchitecture(stands, info.height, info.floorHeight), body = mesh(model.body, true), steps = mesh(model.stairTreads);
  try {
    const first = down([steps], layout.at(layout.u0 + .1, layout.center))[0];
    const last = down([steps], layout.at(layout.u1 - .1, layout.center))[0];
    assert.ok(first && last && first.point.y > last.point.y + 2.4, 'A full flight descends toward the office-side end');
    assert.ok(Math.abs(last.point.y + info.baseElevation - .12) < 1e-4, 'The last tread meets low ground instead of a floating platform');
    const objects = [body, steps, mesh(model.stairFrames), mesh(model.glass)];
    const door = layout.at((layout.u1 + layout.end) / 2, layout.width - .5);
    const exit = new THREE.Raycaster(new THREE.Vector3(door[0], .12 - info.baseElevation + 1.6, door[1]), new THREE.Vector3(layout.across[0], 0, layout.across[1]), 0, 2).intersectObjects(objects);
    assert.equal(exit.length, 0, 'The lower doorway reaches outside without a pane or wall in the door');
    const head = down([body], layout.at(layout.u0 - .3, layout.center), 1.6, 2)[0];
    assert.ok(head && Math.abs(head.point.y - .32) < 1e-4, 'The upper corridor meets the stair head on the retained floor');
    const shaft = down([body], layout.at((layout.u0 + layout.u1) / 2, layout.center), 1.6, 4);
    assert.equal(shaft.length, 0, 'The old upper slab no longer seals the descending flight');
  } finally { dispose(model); }
});

test('the built stand stair shaft clears the actual podium and underground sports roof', () => {
  const layout = standsStairLayout(stands), track = campus.features.find(feature => feature.type === 'runningTrack');
  const areas = undergroundLayout(campus.features).areas;
  const room = areas.get('local/underground-badminton'), corridor = areas.get('local/underground-corridor');
  assert.deepEqual(polygonClipping.difference([layout.footprint.outer], [corridor.feature.ceilingCutouts[0].footprint.outer]), [], 'The enlarged turning landing retains the entire fixed stand shaft');
  const sideHall = [layout.at(layout.u0 - .2, layout.v0 - .2), layout.at(layout.end + .2, layout.v0 - .2),
    layout.at(layout.end + .2, layout.width + .02), layout.at(layout.u0 - .2, layout.width + .02)];
  assert.deepEqual(polygonClipping.intersection([room.feature.outer], [[...sideHall, sideHall[0]]]), [], 'The stair and its sidewalls do not invade the moved badminton hall');
  assert.ok(undergroundCeilingSections(room.feature, room.footprints, room.openings).every(section => section.height === room.feature.wallHeight), 'The entire badminton hall keeps its full ceiling clearance');
  const roofs = [room, corridor].map(area => undergroundDetailGeometry(area.feature, area.footprints, area.openings, area.connections));
  const podium = sportsGroundPlatformLayers(track, campus.features).map(layer => {
    const geometry = buildingGeometry(layer.shape, layer.top - layer.bottom, 3.6);
    const object = mesh(geometry, true); object.position.y = layer.bottom; object.updateMatrixWorld(); return object;
  });
  try {
    const above = roofs.flatMap(roof => Object.entries(roof).filter(([key]) => key !== 'floor' && key !== 'green' && key !== 'paint').map(([, geometry]) => mesh(geometry)));
    const p = layout.at((layout.u0 + layout.u1) / 2, layout.center);
    const hits = down([...above, ...podium], p, 4.2, 4.2);
    assert.ok(hits.every(hit => hit.point.y < .12), 'No podium slab, sports roof, beam or pipe obstructs the flight above its low-ground floor');
    const doorway = layout.at((layout.u1 + layout.end) / 2, layout.width - .5);
    const exit = new THREE.Raycaster(new THREE.Vector3(doorway[0], 1.6, doorway[1]), new THREE.Vector3(layout.across[0], 0, layout.across[1]), 0, 2).intersectObjects([...above, ...podium]);
    assert.equal(exit.length, 0, 'The lower rear exit also clears the underlying sports enclosure');
  } finally { roofs.forEach(dispose); podium.forEach(object => object.geometry.dispose()); }
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

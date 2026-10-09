import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingGeometry, buildingCoreFootprint, passageShape } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { classroomWindowLayout } from '../src/teaching-classrooms.ts';
import { teachingElevatorGeometry, teachingRailGeometry, teachingWindowGeometry } from '../src/architecture-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420');
const connector = building.floorCorridors.find(c => 'points' in c);
const vector = p => new THREE.Vector3(p[0], 0, p[1]);
function model(floor, override) {
  const info = buildingLevels(building, override);
  const bodies = info.sections.map(section => {
    const geometry = buildingGeometry(section, Math.min(section.height, floor ? floor * info.floorHeight : section.height), info.floorHeight,
      building.groundPassages, building.floorCorridors.filter(c => c.partId === section.id), building.stairwells.filter(s => s.partId === section.id), building.classroomWindows, building.solidCores.filter(c => c.partId === section.id), building.cutouts.filter(c => c.partId === section.id));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = .12; mesh.updateMatrixWorld(); return mesh;
  });
  return { info, bodies, dispose: () => bodies.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); }) };
}

test('the marked blue passage opens on every floor, with no concrete or glass across the corridor', () => {
  for (const floor of [undefined, 1, 3]) {
    const { info, bodies, dispose } = model(floor);
    const details = teachingWindowGeometry(building, info.sections, info.floorHeight, floor && floor * info.floorHeight);
    const glass = new THREE.Mesh(details.glass, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); glass.updateMatrixWorld();
    for (let level = 0; level < (floor || info.sections[0].floors); level++) {
      for (let edge = 0; edge < connector.points.length - 1; edge++) {
        const a = vector(connector.points[edge]), b = vector(connector.points[edge + 1]), direction = b.clone().sub(a).normalize();
        const inward = new THREE.Vector3(-direction.z, 0, direction.x), length = a.distanceTo(b);
        for (const depth of [.2, 1.5, 2.8]) {
          const start = a.clone().addScaledVector(inward, depth).addScaledVector(direction, .35); start.y = .12 + (level + .5) * info.floorHeight;
          const ray = new THREE.Raycaster(start, direction, 0, length - .7);
          assert.equal(ray.intersectObjects(bodies).length, 0, 'Both sides of the three-metre route are open, including its return into the atrium');
          assert.equal(ray.intersectObject(glass).length, 0, 'No glazing closes the corridor or its end return');
        }
        for (const t of [.2, .5, .8]) for (const y of [-1, 1]) {
          const point = a.clone().lerp(b, t).addScaledVector(inward, 1.5); point.y = .12 + (level + .5) * info.floorHeight;
          const hit = new THREE.Raycaster(point, new THREE.Vector3(0, y, 0), 0, info.floorHeight).intersectObjects(bodies)[0];
          assert.ok(hit, 'The blue corridor keeps a complete floor and ceiling');
          assert.equal(hit.object.geometry.userData.photoOcclusionMask[hit.faceIndex], 0, 'Open corridor slabs do not hide photos');
        }
      }
      // Follow the passage back into the atrium, beside the shorter elevator.
      const direction = vector(connector.points[1]).sub(vector(connector.points[0])).normalize();
      const inward = new THREE.Vector3(-direction.z, 0, direction.x);
      const turn = vector(connector.points[0]).addScaledVector(direction, 1.6).addScaledVector(inward, 1.5);
      turn.y = .12 + (level + .5) * info.floorHeight;
      const ray = new THREE.Raycaster(turn, direction.negate(), 0, 4);
      assert.equal(ray.intersectObjects(bodies).length, 0, 'The shorter elevator leaves the turn back into the atrium open');
      assert.equal(ray.intersectObject(glass).length, 0);
    }
    for (const geometry of Object.values(details)) geometry.dispose(); glass.material.dispose(); dispose();
  }
});

test('the observation elevator has no concrete sides or intermediate floors while adjacent classrooms remain enclosed', () => {
  const { info, bodies, dispose } = model();
  const shaft = building.solidCores[0], center = vector(shaft.outer[0]).lerp(vector(shaft.outer[2]), .5);
  for (let floor = 0; floor < info.sections[0].floors; floor++) {
    center.y = .12 + (floor + .5) * info.floorHeight;
    for (let edge = 0; edge < shaft.outer.length - 1; edge++) {
      const target = vector(shaft.outer[edge]).lerp(vector(shaft.outer[edge + 1]), .5); target.y = center.y;
      assert.equal(new THREE.Raycaster(center, target.clone().sub(center).normalize(), 0, center.distanceTo(target) + .1).intersectObjects(bodies).length, 0, 'Glass replaces the complete concrete elevator enclosure');
    }
    const roof = new THREE.Raycaster(center, new THREE.Vector3(0, 1, 0)).intersectObjects(bodies)[0];
    assert.ok(Math.abs(roof.point.y - (.12 + info.sections[0].height - .25)) < 1e-4, 'The shaft stays open through intermediate floors');
    const start = new THREE.Vector3(135, .12 + floor * info.floorHeight + .55, 42);
    const first = new THREE.Raycaster(start, new THREE.Vector3(0, 0, 1), 0, 9).intersectObjects(bodies)[0];
    assert.ok(first && first.distance < 4.2, 'The red facade is a classroom wall again, rather than an open three-metre corridor');
    const end = new THREE.Vector3(160, start.y, 48);
    assert.ok(new THREE.Raycaster(end, new THREE.Vector3(-1, 0, 0), 0, 6).intersectObjects(bodies).length, 'The entire red end of the classroom row stays enclosed');
  }
  const section = info.sections[0], solids = building.solidCores.filter(c => c.partId === section.id);
  const core = buildingCoreFootprint(section, building.groundPassages, building.floorCorridors.filter(c => c.partId === section.id), building.stairwells.filter(c => c.partId === section.id), solids, building.cutouts.filter(c => c.partId === section.id));
  const classroomPoint = [[[139.9, 45.9], [140.1, 45.9], [140.1, 46.1], [139.9, 46.1], [139.9, 45.9]]];
  assert.ok(polygonClipping.intersection(core, classroomPoint).length, 'The red classroom remains a room, rather than becoming part of the open route');
  const windows = classroomWindowLayout(core, building.classroomWindows, section.height, info.floorHeight, [], solids.map(c => [c.outer, ...c.holes]));
  assert.ok(windows.every(w => !polygonClipping.intersection(w.cut, [shaft.outer]).length), 'Classroom windows do not overlap the dedicated elevator glazing');
  const down = new THREE.Raycaster(new THREE.Vector3(center.x, 100, center.z), new THREE.Vector3(0, -1, 0)).intersectObjects(bodies)[0];
  assert.equal(down.object.geometry.userData.photoOcclusionMask[down.faceIndex], 1, 'The elevator roof remains a solid photo occluder');
  dispose();
});

test('observation elevator glass covers every side with double doors facing the corridor at each floor', () => {
  const shaft = building.solidCores[0], origin = vector(shaft.outer[3]), end = vector(shaft.outer[4]);
  const along = end.clone().sub(origin).normalize(), inward = new THREE.Vector3(-along.z, 0, along.x);
  const middle = origin.clone().lerp(end, .5), original = JSON.stringify(building);
  for (const selectedFloor of [undefined, 1, 3]) for (const floorHeight of [3.6, 4.2]) {
    const info = buildingLevels(building, { floors: 7, floorHeight }), shown = selectedFloor || info.sections[0].floors;
    const details = teachingElevatorGeometry(building, info.sections, floorHeight, selectedFloor && selectedFloor * floorHeight);
    const objects = Object.fromEntries(Object.entries(details).map(([key, geometry]) => {
      const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld(); return [key, mesh];
    }));
    assert.equal(shaft.elevator.doorEdge, 3, 'Doors face the continuous atrium corridor on the left of the shaft');
    for (let floor = 0; floor < shown; floor++) {
      const y = .12 + floor * floorHeight + 1.3;
      for (let edge = 0; edge < 4; edge++) {
        const a = vector(shaft.outer[edge]), b = vector(shaft.outer[edge + 1]), direction = b.clone().sub(a).normalize();
        const normal = new THREE.Vector3(-direction.z, 0, direction.x), point = a.clone().lerp(b, .35).addScaledVector(normal, -.2); point.y = y;
        const ray = new THREE.Raycaster(point, normal, 0, .4);
        assert.ok(ray.intersectObjects([objects.glass, objects.doors]).length, 'All four sides contain transparent panes');
        assert.equal(ray.intersectObject(objects.doors).length > 0, edge === 3, 'Only the corridor-facing side contains a door');
      }
      const seam = middle.clone().addScaledVector(inward, -.2); seam.y = y;
      assert.ok(new THREE.Raycaster(seam, inward, 0, .4).intersectObject(objects.frames).length, 'The two sliding leaves have a slim vertical meeting seam');
      const leaf = seam.clone().addScaledVector(along, .3);
      assert.equal(new THREE.Raycaster(leaf, inward, 0, .4).intersectObject(objects.frames).length, 0, 'No horizontal bar crosses the middle of a door');
    }
    for (const geometry of Object.values(details)) {
      geometry.computeBoundingBox();
      assert.ok(geometry.boundingBox.max.y < .12 + shown * floorHeight, 'Glazing and doors stop below selected-floor cutaways');
      assert.ok(geometry.userData.photoOcclusionMask.every(value => value === 0), 'Transparent elevator details do not hide photo markers');
      geometry.dispose();
    }
    Object.values(objects).forEach(mesh => mesh.material.dispose());
  }
  assert.equal(JSON.stringify(building), original, 'Generating elevator details keeps the calibrated footprint unchanged');
});

test('the blue strip opens the last three metres of the north classroom end, leaving the rest enclosed', () => {
  const section = building.parts.find(part => part.id === 'main');
  const a = vector(section.outer[9]), b = vector(section.outer[10]), direction = b.clone().sub(a).normalize();
  const inward = new THREE.Vector3(-direction.z, 0, direction.x);
  for (const selectedFloor of [undefined, 1, 3]) {
    const { info, bodies, dispose } = model(selectedFloor);
    for (let floor = 0; floor < (selectedFloor || section.floors || building.floors); floor++) {
      for (const distance of [4, 6, 9]) {
        const point = b.clone().addScaledVector(direction, -distance).addScaledVector(inward, -.5); point.y = .12 + floor * info.floorHeight + .55;
        const hit = new THREE.Raycaster(point, inward, 0, 4).intersectObjects(bodies)[0];
        assert.ok(hit && Math.abs(hit.distance - .5) < 1e-4, 'The unmarked classroom facade keeps its original boundary');
      }
      const point = b.clone().addScaledVector(direction, -1.5).addScaledVector(inward, -.5); point.y = .12 + (floor + .5) * info.floorHeight;
      assert.equal(new THREE.Raycaster(point, inward, 0, 4).intersectObjects(bodies).length, 0, 'The blue strip has an open end, rather than a classroom wall');
    }
    dispose();
  }
});

test('the straight corridor keeps removed bays empty while a thin wall links the elevator and classrooms on every floor', () => {
  const shaft = building.solidCores[0].outer, section = building.parts.find(part => part.id === 'main');
  const origin = vector(section.outer[11]), across = vector(section.outer[10]).sub(origin).normalize();
  const along = new THREE.Vector3(-across.z, 0, across.x);
  const at = (u, v) => origin.clone().addScaledVector(across, u).addScaledVector(along, v);
  const local = p => { const delta = vector(p).sub(origin); return [delta.dot(across), delta.dot(along)]; };
  const corners = shaft.slice(0, 4).map(local);
  assert.ok(corners.every(([u,v]) => u >= -3.161 && u <= .001 && v >= .599 && v <= 3.001), 'The elevator occupies the red area above old A, on the left of old B');
  assert.ok(Math.abs(corners[1][0] - corners[0][0] - 3.16) < 1e-6);
  assert.ok(Math.abs(corners[3][1] - corners[0][1] - 2.4) < 1e-6);
  assert.ok(connector.points.every(p => local(p)[1] < -3.32 && local(p)[1] > -3.35), 'The corridor continues the neighbouring facade without its old 34 cm step');
  assert.equal(connector.slabInfill, undefined, 'The removed right-hand platform is not recreated by an infill');
  const wall = building.solidCores[2], wallWidth = vector(wall.outer[2]).distanceTo(vector(wall.outer[1]));
  assert.ok(wallWidth < .01, 'Blanking the existing wall must not add another elevator-sized volume');
  const connection = building.solidCores[3].outer.map(local);
  assert.ok(Math.abs(connection[1][0] - connection[0][0] - .28) < 1e-6, 'The new connection is an ordinary 28 cm wall');
  assert.ok(Math.abs(connection[0][1] - 3) < 1e-6 && connection[2][1] > 5.89, 'The wall joins the elevator to the lower classroom row');
  for (const selectedFloor of [undefined, 1, 3]) {
    const { info, bodies, dispose } = model(selectedFloor);
    const windows = teachingWindowGeometry(building, info.sections, info.floorHeight, selectedFloor && selectedFloor * info.floorHeight);
    const glass = new THREE.Mesh(windows.glass, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); glass.updateMatrixWorld();
    for (let floor = 0; floor < (selectedFloor || info.sections[0].floors); floor++) {
      const y = .12 + (floor + .5) * info.floorHeight;
      for (const [u,v] of [[2.5,1.5],[-1.5,4.2],[-1.5,.3]]) {
        const point = at(u,v); point.y = y;
        for (const direction of [new THREE.Vector3(0,1,0),new THREE.Vector3(0,-1,0),across]) {
          assert.equal(new THREE.Raycaster(point,direction,0,direction.y ? 100 : .8).intersectObjects(bodies).length, 0, 'Black areas lose their walls, floors and roof rather than only their facade');
          assert.equal(new THREE.Raycaster(point,direction,0,direction.y ? 100 : .8).intersectObject(glass).length, 0, 'No glass floats over the removed bays');
        }
      }
      // The requested wall bridges the removed bay and continues the classroom wall.
      for (const v of [3.1, 4.2, 5.7, 8, 12]) {
        const start = at(-3.7,v); start.y = y;
        const ray = new THREE.Raycaster(start, across, 0, 1.2), hit = ray.intersectObjects(bodies)[0];
        assert.ok(hit && hit.distance < .6, 'The marked black line is a continuous concrete wall');
        assert.equal(ray.intersectObject(glass).length, 0, 'The black wall has no leftover glazing');
        const inner = at(-2.4,v); inner.y = y;
        const reverse = new THREE.Raycaster(inner, across.clone().negate(), 0, 1.2).intersectObjects(bodies)[0];
        assert.ok(reverse && reverse.distance > .45, 'The wall retains ordinary classroom wall thickness');
      }
    }
    const top = at(-3.03, 4.2); top.y = 100;
    const cap = new THREE.Raycaster(top, new THREE.Vector3(0, -1, 0)).intersectObjects(bodies)[0];
    const height = selectedFloor ? selectedFloor * info.floorHeight : info.sections[0].height;
    assert.ok(cap && Math.abs(cap.point.y - height - .12) < 1e-4, 'The connecting wall remains sealed at the roof and selected-floor cutaways');
    assert.equal(cap.object.geometry.userData.photoOcclusionMask[cap.faceIndex], 1, 'The wall cap is opaque');
    for (const geometry of Object.values(windows)) geometry.dispose(); glass.material.dispose(); dispose();
  }
});

test('the exposed return has rails from the second floor, without blocking either end of the connection', () => {
  const info = buildingLevels(building), geometry = teachingRailGeometry(building, info.sections, info.floorHeight);
  const rail = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); rail.updateMatrixWorld();
  for (const edges of connector.railEdges) for (let edge = 0; edge < edges.length - 1; edge++) {
    const [a, b] = [edges[edge], edges[edge + 1]], direction = vector(b).sub(vector(a)).normalize();
    const normal = new THREE.Vector3(-direction.z, 0, direction.x);
    for (let floor = 0; floor < info.sections[0].floors; floor++) for (const t of [.1, .5, .9]) {
      const point = vector(a).lerp(vector(b), t).addScaledVector(normal, -.5); point.y = .12 + floor * info.floorHeight + .25 + 1.05;
      const hits = new THREE.Raycaster(point, normal, 0, 1).intersectObject(rail);
      assert.equal(hits.length > 0, floor > 0, 'The straight corridor end and its exposed front are guarded on every upper floor');
    }
  }
  geometry.dispose(); rail.material.dispose();
});

test('the classroom front has no rails while the newly opened blue end is guarded above the ground floor', () => {
  const info = buildingLevels(building), geometry = teachingRailGeometry(building, info.sections, info.floorHeight);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld();
  const section = building.parts.find(part => part.id === 'main');
  const a = vector(section.outer[9]), b = vector(section.outer[10]), length = a.distanceTo(b), direction = b.clone().sub(a).normalize();
  const normal = new THREE.Vector3(-direction.z, 0, direction.x);
  assert.ok(connector.railEdges[0].length >= 3, 'The side guard turns around the exposed end, without extending along the classroom front');
  for (let level = 0; level < info.sections[0].floors; level++) for (const along of [length * .2, length * .4, length * .6]) {
    const point = a.clone().addScaledVector(direction, along).addScaledVector(normal, -.5);
    point.y = .12 + level * info.floorHeight + .25 + 1.05;
    assert.equal(new THREE.Raycaster(point, normal, 0, 1).intersectObject(mesh).length, 0, 'No horizontal rail or post crosses the marked front edge');
  }
  geometry.dispose(); mesh.material.dispose();
});

test('classroom windows are actual openings with transparent panes, opaque sills and intact floor slabs', () => {
  const { info, bodies, dispose } = model();
  const grounds = building.groundPassages.map(p => { const shape = passageShape(p); return [shape.outer, ...shape.holes]; });
  for (const [index, section] of info.sections.entries()) {
    const core = buildingCoreFootprint(section, building.groundPassages, building.floorCorridors.filter(c => c.partId === section.id), building.stairwells.filter(s => s.partId === section.id), building.solidCores.filter(s => s.partId === section.id), building.cutouts.filter(s => s.partId === section.id));
    const enclosures = [...building.solidCores.filter(s => s.partId === section.id).map(s => [s.outer, ...s.holes]), ...building.stairwells.filter(s => s.partId === section.id && s.internal).map(s => [s.opening.outer, ...s.opening.holes])];
    const windows = classroomWindowLayout(core, building.classroomWindows, section.height, info.floorHeight, grounds, enclosures);
    assert.ok(windows.length > section.floors * 5, 'Both wings receive repeated windows on all floors');
    for (const window of windows) {
      const along = vector(window.to).sub(vector(window.from)).normalize(), normal = new THREE.Vector3(-along.z, 0, along.x);
      const point = vector(window.from).lerp(vector(window.to), .4); point.y = .12 + (window.bottom + window.top) / 2;
      const ray = new THREE.Raycaster(point.clone().addScaledVector(normal, -.17), normal, 0, .34);
      assert.equal(ray.intersectObject(bodies[index]).length, 0, 'The glass replaces concrete through the complete wall thickness');
    }
    const window = windows.find(w => Math.abs(w.bottom - info.floorHeight * 2 - building.classroomWindows.sill) < 1e-6);
    const along = vector(window.to).sub(vector(window.from)).normalize(), normal = new THREE.Vector3(-along.z, 0, along.x);
    const point = vector(window.from).lerp(vector(window.to), .4); point.y = .12 + info.floorHeight * 2 + .55;
    assert.ok(new THREE.Raycaster(point.clone().addScaledVector(normal, -.17), normal, 0, .34).intersectObject(bodies[index]).length, 'Concrete sill remains below the glazing');
  }
  const modelWindows = teachingWindowGeometry(building, info.sections, info.floorHeight);
  for (const geometry of Object.values(modelWindows)) {
    assert.ok(geometry.attributes.position.count > 0);
    assert.ok(geometry.userData.photoOcclusionMask.every(value => value === 0), 'Glass and slim frames do not block photo markers'); geometry.dispose();
  }
  dispose();
});

test('window geometry respects floor cutaways and different floor heights without coplanar duplicate faces', () => {
  for (const floor of [1, 3]) for (const floorHeight of [3.6, 4.2]) {
    const { info, bodies, dispose } = model(floor, { floors: 7, floorHeight });
    const details = teachingWindowGeometry(building, info.sections, info.floorHeight, floor * floorHeight);
    for (const geometry of Object.values(details)) {
      geometry.computeBoundingBox(); assert.ok(geometry.boundingBox.max.y < .12 + floor * floorHeight, 'No pane or frame floats above the selected floor'); geometry.dispose();
    }
    for (const body of bodies) {
      const triangles = new Set(), p = body.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        const key = [0, 1, 2].map(j => [p.getX(i + j), p.getY(i + j), p.getZ(i + j)].map(n => n.toFixed(5)).join(',')).sort().join(';');
        assert.ok(!triangles.has(key), 'Jambs and floor caps have no overlapping triangles'); triangles.add(key);
      }
    }
    dispose();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingGeometry, buildingCoreFootprint, passageShape } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { classroomWindowLayout } from '../src/teaching-classrooms.ts';
import { teachingRailGeometry, teachingWindowGeometry } from '../src/architecture-geometry.ts';

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

test('only the blue side passage opens on every floor, with no concrete or glass across the corridor', () => {
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
      // Traverse the inside of the corner instead of testing disconnected strips.
      const turn = vector(connector.points[1]); turn.y = .12 + (level + .5) * info.floorHeight;
      assert.equal(new THREE.Raycaster(turn.clone().add(new THREE.Vector3(-2, 0, 1)), new THREE.Vector3(0, 0, 1), 0, 4).intersectObjects(bodies).length, 0);
    }
    for (const geometry of Object.values(details)) geometry.dispose(); glass.material.dispose(); dispose();
  }
});

test('the green elevator stays solid while the red classroom row is no longer cut through', () => {
  const { info, bodies, dispose } = model();
  const shaft = building.solidCores[0], center = vector(shaft.outer[0]).lerp(vector(shaft.outer[2]), .5);
  for (let floor = 0; floor < info.sections[0].floors; floor++) {
    center.y = .12 + (floor + .5) * info.floorHeight;
    for (const direction of [new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)]) {
      assert.ok(new THREE.Raycaster(center, direction, 0, 5).intersectObjects(bodies).length, 'All elevator sides are opaque on every floor');
    }
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
  assert.ok(windows.every(w => !polygonClipping.intersection(w.cut, [shaft.outer]).length), 'No pane or window opening is placed in the elevator');
  const down = new THREE.Raycaster(new THREE.Vector3(center.x, 100, center.z), new THREE.Vector3(0, -1, 0)).intersectObjects(bodies)[0];
  assert.equal(down.object.geometry.userData.photoOcclusionMask[down.faceIndex], 1, 'The elevator roof remains a solid photo occluder');
  dispose();
});

test('the black projecting piece is removed completely, through all walls, floors and roof', () => {
  for (const selectedFloor of [undefined, 1, 3]) {
    const { bodies, dispose } = model(selectedFloor);
    const cut = building.cutouts[0].outer, a = vector(cut[0]), b = vector(cut[2]);
    for (const t of [.25, .5, .75]) {
      const point = a.clone().lerp(b, t); point.y = 100;
      assert.equal(new THREE.Raycaster(point, new THREE.Vector3(0, -1, 0)).intersectObjects(bodies).length, 0, 'No column, floor patch or roof patch remains in the black area');
    }
    dispose();
  }
});

test('the exposed return has rails from the second floor, without blocking either end of the connection', () => {
  const info = buildingLevels(building), geometry = teachingRailGeometry(building, info.sections, info.floorHeight);
  const rail = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); rail.updateMatrixWorld();
  const [a, b] = connector.railEdges[0], direction = vector(b).sub(vector(a)).normalize();
  const normal = new THREE.Vector3(-direction.z, 0, direction.x);
  for (let floor = 0; floor < info.sections[0].floors; floor++) {
    const point = vector(a).lerp(vector(b), .4).addScaledVector(normal, -.5); point.y = .12 + floor * info.floorHeight + .25 + 1.05;
    const hits = new THREE.Raycaster(point, normal, 0, 1).intersectObject(rail);
    assert.equal(hits.length > 0, floor > 0, 'Ground floor stays open; every upper floor has an edge guard rail');
  }
  geometry.dispose(); rail.material.dispose();
});

test('the marked front face has no guard rails on any floor while the side corridor retains them', () => {
  const info = buildingLevels(building), geometry = teachingRailGeometry(building, info.sections, info.floorHeight);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld();
  const a = vector(connector.points[0]), b = vector(connector.points[1]), length = a.distanceTo(b), direction = b.clone().sub(a).normalize();
  const normal = new THREE.Vector3(-direction.z, 0, direction.x);
  assert.equal(connector.railEdges[0].length, 2, 'Only the side edge has a railing route');
  for (let level = 0; level < info.sections[0].floors; level++) for (const along of [length * .2, length * .5, length * .8]) {
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
    const windows = classroomWindowLayout(core, building.classroomWindows, section.height, info.floorHeight, grounds, building.solidCores.filter(s => s.partId === section.id).map(s => [s.outer, ...s.holes]));
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

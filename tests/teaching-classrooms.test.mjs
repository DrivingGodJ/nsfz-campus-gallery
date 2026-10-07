import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
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
      building.groundPassages, building.floorCorridors.filter(c => c.partId === section.id), building.stairwells.filter(s => s.partId === section.id), building.classroomWindows);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = .12; mesh.updateMatrixWorld(); return mesh;
  });
  return { info, bodies, dispose: () => bodies.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); }) };
}

test('the marked large-atrium return connects at full walking width to the front corridor on every floor', () => {
  for (const floor of [undefined, 1, 3]) {
    const { info, bodies, dispose } = model(floor);
    const direction = vector(connector.points[1]).sub(vector(connector.points[0])).normalize();
    const length = vector(connector.points[1]).distanceTo(vector(connector.points[0]));
    const normal = new THREE.Vector3(direction.z, 0, -direction.x);
    for (let level = 0; level < (floor || info.sections[0].floors); level++) {
      for (const offset of [-1.35, 0, 1.35]) {
        const start = vector(connector.points[0]).addScaledVector(normal, offset).addScaledVector(direction, .3); start.y = .12 + (level + .5) * info.floorHeight;
        assert.equal(new THREE.Raycaster(start, direction, 0, length - .4).intersectObjects(bodies).length, 0, 'No wall or corner plug interrupts either edge of the three-metre connection');
      }
      for (const t of [.15, .5, .8]) for (const y of [-1, 1]) {
        const point = vector(connector.points[0]).lerp(vector(connector.points[1]), t); point.y = .12 + (level + .5) * info.floorHeight;
        const hit = new THREE.Raycaster(point, new THREE.Vector3(0, y, 0), 0, info.floorHeight).intersectObjects(bodies)[0];
        assert.ok(hit, 'The connection keeps a complete floor and ceiling');
        assert.equal(hit.object.geometry.userData.photoOcclusionMask[hit.faceIndex], 0, 'Connection slabs do not hide photos taken in the corridor');
      }
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

test('classroom windows are actual openings with transparent panes, opaque sills and intact floor slabs', () => {
  const { info, bodies, dispose } = model();
  const grounds = building.groundPassages.map(p => { const shape = passageShape(p); return [shape.outer, ...shape.holes]; });
  for (const [index, section] of info.sections.entries()) {
    const core = buildingCoreFootprint(section, building.groundPassages, building.floorCorridors.filter(c => c.partId === section.id), building.stairwells.filter(s => s.partId === section.id));
    const windows = classroomWindowLayout(core, building.classroomWindows, section.height, info.floorHeight, grounds);
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

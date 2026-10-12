import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingRailGeometry, teachingWindowGeometry } from '../src/architecture-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420');
const info = buildingLevels(building, site.buildingOverrides[building.id]);
const wing = info.sections.find(section => section.id === 'sixth-floor-wing');
const [a, b] = [wing.outer[7], wing.outer[8]];
const direction = new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize();
const inward = new THREE.Vector3(-direction.z, 0, direction.x);
const point = (t, depth, y) => new THREE.Vector3(a[0], y, a[1]).lerp(new THREE.Vector3(b[0], y, b[1]), t).addScaledVector(inward, depth);
const mesh = (geometry, extrusion = false) => {
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (extrusion) { object.rotation.x = -Math.PI / 2; object.position.y = .12; }
  object.updateMatrixWorld(); return object;
};
const dispose = objects => objects.forEach(object => { object.geometry.dispose(); object.material.dispose(); });

test('the library-facing wing has open upper balconies and no first-floor slab across the removed strip', () => {
  for (const floor of [undefined, 1, 3, 6]) {
    const height = Math.min(wing.height, (floor || wing.floors) * info.floorHeight);
    const body = mesh(buildingGeometry(wing, height, info.floorHeight, building.groundPassages,
      building.floorCorridors.filter(c => c.partId === wing.id), building.stairwells.filter(s => s.partId === wing.id),
      building.classroomWindows, building.solidCores.filter(c => c.partId === wing.id), building.cutouts.filter(c => c.partId === wing.id), !!floor), true);
    try {
      for (let level = 0; level < (floor || wing.floors); level++) for (const t of [.06, .5, .75, .94]) {
        const y = .12 + level * info.floorHeight + .5;
        const wall = new THREE.Raycaster(point(t, -1, y), inward, 0, 5).intersectObject(body)[0];
        assert.ok(wall && Math.abs(wall.distance - 4) < 1e-4, 'The retained classroom wall is three metres behind the original facade');
        for (const depth of [.2, 1.5, 2.8]) {
          const floorHit = new THREE.Raycaster(point(t, depth, y), new THREE.Vector3(0, -1, 0), 0, .7).intersectObject(body)[0];
          if (level === 0) assert.equal(floorHit, undefined, 'The full first-floor strip has no remaining building slab');
          else assert.ok(floorHit && Math.abs(floorHit.point.y - (.12 + level * info.floorHeight + .25)) < 1e-4, 'Every upper balcony keeps its continuous floor');
          const ceiling = new THREE.Raycaster(point(t, depth, y), new THREE.Vector3(0, 1, 0), 0, info.floorHeight).intersectObject(body)[0];
          if (floor && level === floor - 1) assert.equal(ceiling, undefined, 'A selected floor remains open from above');
          else assert.ok(ceiling, 'The balcony ceiling and roof remain intact');
        }
      }
    } finally { dispose([body]); }
  }
});

test('blue guards protect floors two through six and glazing never closes the balcony strip', () => {
  const rails = mesh(teachingRailGeometry(building, info.sections, info.floorHeight));
  const windows = teachingWindowGeometry(building, info.sections, info.floorHeight);
  const glass = mesh(windows.glass);
  try {
    for (let level = 0; level < wing.floors; level++) {
      for (const end of [0, 1]) {
        const ray = new THREE.Raycaster(point(end === 0 ? -.06 : 1.06, 1.5, .12 + level * info.floorHeight + 1.3), direction.clone().multiplyScalar(end === 0 ? 1 : -1), 0, 2);
        if (level === 0) assert.equal(ray.intersectObject(rails).length, 0);
        else assert.ok(ray.intersectObject(rails).length, 'Both exposed balcony ends have return guards');
      }
      for (const t of [.2, .5, .8]) {
        const railY = .12 + level * info.floorHeight + .25 + 1.05;
        const guard = new THREE.Raycaster(point(t, -1, railY), inward, 0, 1.5).intersectObject(rails)[0];
        if (level === 0) assert.equal(guard, undefined, 'The removed first-floor strip has no guard across it');
        else assert.ok(guard, 'The exterior balcony edge is guarded on every upper floor');
        const windowY = .12 + level * info.floorHeight + 1.8;
        assert.equal(new THREE.Raycaster(point(t, -1, windowY), inward, 0, 3.8).intersectObject(glass).length, 0, 'All glass is behind the open balcony rather than along the old facade');
      }
      for (const [start, end] of [[.04, .18], [.52, .96]]) {
        const routeStart = point(start, 1.5, .12 + (level + .5) * info.floorHeight);
        assert.equal(new THREE.Raycaster(routeStart, direction, 0, Math.hypot(b[0] - a[0], b[1] - a[1]) * (end - start)).intersectObject(glass).length, 0, 'The balcony walkway stays open beside the semicircular bay');
      }
    }
  } finally { dispose([rails, glass]); windows.frames.dispose(); }
});

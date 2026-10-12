import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { solidCoreWindowLayout } from '../src/teaching-classrooms.ts';
import { teachingRailGeometry, teachingWindowGeometry } from '../src/architecture-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420');
const info = buildingLevels(building, site.buildingOverrides[building.id]);
const wing = info.sections.find(s => s.id === 'sixth-floor-wing');
const bay = building.solidCores.find(c => c.partId === wing.id && c.classroomWindows?.facadeLines?.[0]?.length === 33);
const corridor = building.floorCorridors.find(c => c.partId === wing.id && c.edge === 7);
const [right, left] = wing.outer.slice(7, 9);
const length = Math.hypot(right[0] - left[0], right[1] - left[1]);
const along = new THREE.Vector3(right[0] - left[0], 0, right[1] - left[1]).normalize();
const outward = new THREE.Vector3(-along.z, 0, along.x);
const station = .65 * length;
const point = (u, v, y) => new THREE.Vector3(left[0], y, left[1]).addScaledVector(along, station + u).addScaledVector(outward, v);
const mesh = (geometry, extrusion = false) => {
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (extrusion) { object.rotation.x = -Math.PI / 2; object.position.y = .12; }
  object.updateMatrixWorld(); return object;
};
const body = floor => mesh(buildingGeometry(wing, floor ? floor * info.floorHeight : wing.height, info.floorHeight, building.groundPassages,
  building.floorCorridors.filter(c => c.partId === wing.id), building.stairwells.filter(s => s.partId === wing.id), building.classroomWindows,
  building.solidCores.filter(c => c.partId === wing.id), building.cutouts.filter(c => c.partId === wing.id), !!floor), true);
const dispose = objects => objects.forEach(object => { object.geometry.dispose(); object.material.dispose(); });
const cast = (object, u, v, y, direction, distance) => new THREE.Raycaster(point(u, v, y), direction, 0, distance).intersectObject(object)[0];

test('the library-facing bay is a three-metre semicircle rooted in the body and tangent to the balcony edge', () => {
  assert.ok(bay, 'The marked semicircular classroom bay is saved');
  assert.equal(wing.floors, 6);
  assert.deepEqual(corridor.footprint.holes, [bay.outer], 'The removed strip excludes the new room rather than cutting away its ground floor');
  const center = point(0, -3, 0), arc = bay.classroomWindows.facadeLines[0];
  for (const [x, z] of arc) assert.ok(Math.abs(new THREE.Vector3(x, 0, z).distanceTo(center) - 3) < 1e-9);
  for (const [index, u, v] of [[0, 3, -3], [16, 0, 0], [32, -3, -3]]) {
    const expected = point(u, v, 0);
    assert.ok(Math.hypot(arc[index][0] - expected.x, arc[index][1] - expected.z) < 1e-9, 'Both roots meet the recessed facade and the tip meets its outer guard line');
  }
  assert.deepEqual(bay.openEdges, [33]);
  assert.ok(Math.hypot(bay.outer[33][0] - point(-3, -3.28, 0).x, bay.outer[33][1] - point(-3, -3.28, 0).z) < 1e-9);
  assert.equal(bay.startFloor, undefined, 'The bay starts at ground level');
  assert.equal(bay.endFloor, undefined, 'The bay reaches the six-floor wing roof');
});

test('all six bay floors join the main room without a hidden root wall or floor slit, including cutaways', () => {
  for (const floor of [undefined, 1, 3, 6]) {
    const shell = body(floor), floors = floor || wing.floors;
    try {
      for (let level = 0; level < floors; level++) {
        const y = .12 + level * info.floorHeight, slabTop = y + .25;
        for (const u of [-2.6, 0, 2.6]) {
          assert.equal(cast(shell, u, -3.8, y + 1.6, outward, 1.1), undefined, 'A real opening connects the main room to the semicircle');
          for (const v of [-3.4, -3.29, -3.27, -3.05, -2.95]) {
            const hit = cast(shell, u, v, slabTop + .15, new THREE.Vector3(0, -1, 0), .3);
            assert.ok(hit && Math.abs(hit.point.y - slabTop) < 1e-4, 'The root has continuous floor across the exact attachment seam');
          }
        }
        const bayFloor = cast(shell, 0, -1, slabTop + .15, new THREE.Vector3(0, -1, 0), .3);
        assert.ok(bayFloor && Math.abs(bayFloor.point.y - slabTop) < 1e-4, 'The bay has a floor even inside the removed ground strip');
        for (const u of [-5, 5]) {
          const hit = cast(shell, u, -1.5, slabTop + .15, new THREE.Vector3(0, -1, 0), .3);
          if (!level) assert.equal(hit, undefined, 'The old first-floor strip remains removed beside the bay');
          else assert.ok(hit && Math.abs(hit.point.y - slabTop) < 1e-4, 'Both adjacent upper balconies retain their floor');
        }
      }
      const roof = cast(shell, 0, -1, .12 + floors * info.floorHeight + .1, new THREE.Vector3(0, -1, 0), .5);
      if (floor) assert.equal(roof, undefined, 'The selected top floor stays open from above');
      else assert.ok(roof && Math.abs(roof.point.y - .12 - wing.height) < 1e-4, 'The rounded room ends at the same roof as the six-floor wing');
    } finally { dispose([shell]); }
  }
});

test('curved glazing has real apertures on every floor while blue guards stay outside the bay', () => {
  const shell = body(), glazing = teachingWindowGeometry(building, info.sections, info.floorHeight);
  const glass = mesh(glazing.glass), frames = mesh(glazing.frames), rails = mesh(teachingRailGeometry(building, info.sections, info.floorHeight));
  const windows = solidCoreWindowLayout([bay], wing.height, info.floorHeight);
  try {
    for (let level = 0; level < wing.floors; level++) {
      const y = .12 + level * info.floorHeight;
      const window = windows.filter(w => w.bottom >= level * info.floorHeight && w.bottom < (level + 1) * info.floorHeight)[15];
      assert.ok(window, 'Every floor receives the subdivided curved window run');
      const center = new THREE.Vector3((window.from[0] + window.to[0]) / 2, y + 1.8, (window.from[1] + window.to[1]) / 2);
      const tangent = new THREE.Vector3(window.to[0] - window.from[0], 0, window.to[1] - window.from[1]).normalize();
      const normal = new THREE.Vector3(-tangent.z, 0, tangent.x), start = center.clone().addScaledVector(normal, -.5);
      const aperture = new THREE.Raycaster(start, normal, 0, 1);
      assert.equal(aperture.intersectObject(shell).length, 0, 'Glass replaces a real curved-wall opening');
      assert.ok(aperture.intersectObject(glass).length, 'A pane fills the curved aperture');
      for (const u of [-2.6, 0, 2.6]) {
        const root = new THREE.Raycaster(point(u, -3.8, y + 1.8), outward, 0, 1.1);
        assert.equal(root.intersectObjects([glass, frames, rails]).length, 0, 'No generic glazing, frame or rail closes the room root');
      }
      assert.equal(cast(rails, 0, -.5, y + 1.3, outward, 1), undefined, 'The balcony guard is trimmed where the curved room touches it');
      for (const u of [-5, 5]) {
        const guard = cast(rails, u, 1, y + 1.3, outward.clone().negate(), 1.5);
        if (!level) assert.equal(guard, undefined);
        else assert.ok(guard, 'The blue guard remains beside the bay on all five upper balconies');
      }
    }
  } finally { dispose([shell, glass, frames, rails]); }
});

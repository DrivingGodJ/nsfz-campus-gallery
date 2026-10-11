import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { libraryAnnexWindowsConfig } from '../src/campus-exterior-geometry.ts';
import { buildingColors } from '../src/building-colors.ts';
import { classroomWindowLayout, confirmedFacade } from '../src/teaching-classrooms.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const library = campus.buildings.find(building => building.id === 'way/855459419');

test('the green annex curtain wall opens its confirmed faces while preserving the main library windows', () => {
  const original = JSON.stringify(library), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const legacy = { ...library.classroomWindows, facadeLines: [library.outer.slice(1, 4), ...library.classroomWindows.facadeLines.slice(1)] };
  const colors = buildingColors(library);
  assert.equal(colors.glass, '#aec2c0', 'The main library retains its light glass finish');
  assert.equal(colors.frame, '#e2e3da', 'The main library retains its pale window frames');
  assert.notEqual(colors.annexGlass, colors.glass, 'The green curtain wall has its own glass finish');
  assert.notEqual(colors.annexFrame, colors.frame, 'Annex mullions cannot recolor the main library frames');
  try {
    for (const floorHeight of [3.6, 4.2]) for (const annexFloors of [2, 3]) {
      const info = buildingLevels(library, { floors: 5, floorHeight, partFloors: { 'curved-annex': annexFloors } });
      const main = info.sections.find(section => section.id === 'main'), annex = info.sections.find(section => section.id === 'curved-annex');
      const config = libraryAnnexWindowsConfig(library, floorHeight);
      assert.equal(config.facadeLines, library.classroomWindows.facadeLines, 'The annex retains exactly its recorded facade evidence');
      assert.deepEqual(classroomWindowLayout([[main.outer]], library.classroomWindows, main.height, floorHeight),
        classroomWindowLayout([[main.outer]], legacy, main.height, floorHeight), 'The newly confirmed annex faces do not add or change a main-building pane');
      for (const cutoff of [undefined, floorHeight, 2 * floorHeight]) {
        const height = Math.min(annex.height, cutoff ?? Infinity), windows = classroomWindowLayout([[annex.outer]], config, height, floorHeight);
        const geometry = buildingGeometry(annex, height, floorHeight, [], [], [], config, [], [], cutoff !== undefined && cutoff <= annex.height);
        const glazing = teachingWindowGeometry({ ...library, classroomWindows: config }, [annex], floorHeight, cutoff);
        const body = new THREE.Mesh(geometry, material), glass = new THREE.Mesh(glazing.glass, material);
        body.rotation.x = -Math.PI / 2; body.position.y = .12; body.updateMatrixWorld(); glass.updateMatrixWorld();
        try {
          assert.equal(glazing.glass.getAttribute('position').count / 3, windows.length * 2, 'Each real aperture has exactly one glazing pane');
          assert.ok(windows.length > 0);
          const area = annex.outer.slice(1).reduce((sum, point, i) => sum + annex.outer[i][0] * point[1] - point[0] * annex.outer[i][1], 0), seen = new Set();
          for (const window of windows) {
            const dx = window.to[0] - window.from[0], dz = window.to[1] - window.from[1], length = Math.hypot(dx, dz);
            const normal = new THREE.Vector3(area > 0 ? dz / length : -dz / length, 0, area > 0 ? -dx / length : dx / length);
            const boundary = point => [point[0] + normal.x * config.wallThickness / 2, point[1] + normal.z * config.wallThickness / 2];
            const edge = library.outer.slice(0, -1).findIndex((from, i) => confirmedFacade(boundary(window.from), boundary(window.to), [{ from, to: library.outer[i + 1] }]));
            assert.ok([14, 0, 1, 2].includes(edge), 'The curtain wall is confined to the four photographed annex faces');
            seen.add(edge);
            assert.ok(window.top <= height && window.top <= annexFloors * floorHeight, 'Main-building floor overrides cannot create higher annex glass');
            const floor = Math.floor(window.bottom / floorHeight);
            assert.ok(Math.abs(window.bottom - (floor * floorHeight + .3)) < 1e-7 && Math.abs(window.top - ((floor + 1) * floorHeight - .35)) < 1e-7,
              'The photographed curtain wall leaves only its narrow sill and floor band');
            const ray = y => new THREE.Raycaster(new THREE.Vector3((window.from[0] + window.to[0]) / 2, .12 + y, (window.from[1] + window.to[1]) / 2).addScaledVector(normal, .7), normal.clone().negate(), 0, 1.4);
            const through = ray((window.bottom + window.top) / 2);
            assert.equal(through.intersectObject(body).length, 0, 'The tall green pane opens through the real annex wall');
            assert.ok(through.intersectObject(glass).length, 'The shared curtain pane fills its actual aperture');
            assert.ok(ray(floor * floorHeight + .1).intersectObject(body).length, 'Concrete remains between the storeys');
          }
          assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 14], 'The curve and both adjoining front faces receive their confirmed glazing');
        } finally { geometry.dispose(); Object.values(glazing).forEach(part => part.dispose()); }
      }
    }
  } finally { material.dispose(); }
  assert.equal(JSON.stringify(library), original, 'Curtain-wall rendering never overwrites main-building calibration or footprint data');
});

test('annex curtain glazing remains evidence-gated when the configured faces are missing or explicitly unknown', () => {
  const sections = buildingLevels(library).sections.filter(section => section.id === 'curved-annex');
  for (const classroomWindows of [undefined, { ...library.classroomWindows, facadeLines: [] }, { ...library.classroomWindows, facadeLines: [library.outer.slice(3, 6)] }]) {
    const building = { ...library, classroomWindows }, config = libraryAnnexWindowsConfig(building, 3.6);
    const panes = teachingWindowGeometry({ ...building, classroomWindows: config }, sections, 3.6);
    try {
      assert.equal(panes.glass.getAttribute('position').count, 0, 'Absent annex evidence cannot add fallback curtain glass');
      assert.equal(panes.frames.getAttribute('position').count, 0, 'An unconfirmed wall cannot acquire guessed mullions');
    } finally { Object.values(panes).forEach(part => part.dispose()); }
  }
});

test('the library keeps its full footprint and five-storey main body with a three-storey curved annex', () => {
  assert.deepEqual(applyCampusCorrections(campus, corrections).buildings.find(building => building.id === library.id), library);
  const [main, annex] = library.parts;
  assert.deepEqual(polygonClipping.union([main.outer], [annex.outer]), polygonClipping.union([library.outer]));
  assert.deepEqual(polygonClipping.intersection([main.outer], [annex.outer]), []);
  assert.deepEqual([main.outer[0], main.outer.at(-2)], [annex.outer.at(-2), annex.outer[0]], 'Both volumes meet along the same exact seam');
  assert.deepEqual(buildingLevels(library).sections.map(section => section.floors), [5, 3]);

  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  try {
    for (const floorHeight of [3.6, 4.2]) for (const selectedFloor of [undefined, 3, 4]) {
      const info = buildingLevels(library, { floors: 5, floorHeight });
      const cutoff = selectedFloor === undefined ? undefined : selectedFloor * floorHeight;
      for (const section of info.sections) {
        const height = Math.min(section.height, cutoff ?? section.height);
        const cutaway = cutoff !== undefined && cutoff <= section.height + 1e-6;
        const geometry = buildingGeometry(section, height, floorHeight, [], [], [], undefined, [], [], cutaway);
        const body = new THREE.Mesh(geometry, material);
        body.rotation.x = -Math.PI / 2; body.position.y = .12; body.updateMatrixWorld();
        const point = section.id === 'main' ? [50, 128] : [50, 104];
        const hit = new THREE.Raycaster(new THREE.Vector3(point[0], 100, point[1]), new THREE.Vector3(0, -1, 0)).intersectObject(body)[0];
        const expectedTop = .12 + (cutaway ? (selectedFloor - 1) * floorHeight + .25 : section.height);
        assert.ok(hit && Math.abs(hit.point.y - expectedTop) < 1e-4, 'The annex ends at its third-floor roof, which is removed only when its own top storey is selected');
        geometry.dispose();
      }
    }
  } finally { material.dispose(); }
});

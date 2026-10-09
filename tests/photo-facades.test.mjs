import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry, buildingCoreFootprint } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { dormitoryBodyGeometry, dormitoryProfile, cafeteriaBodyGeometry, cafeteriaLowerProfile, cafeteriaUpperWindows, cafeteriaStairStrip } from '../src/facade-geometry.ts';
import { laboratoryBodyGeometry, laboratoryWindows } from '../src/laboratory-geometry.ts';
import { classroomWindowLayout } from '../src/teaching-classrooms.ts';
import { classroomGlazingGeometry, teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { photoFacadeDetailGeometry, teachingRoundCanopyAnchor } from '../src/photo-facade-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const ids = ['way/855459411', 'way/1233313434', 'way/1233313431', 'way/855459419', 'way/1233313430', 'way/1233313436', 'way/1233313437', 'way/1233313435', 'local/unknown-west-corner', 'way/855459421', 'way/1277841229', 'local/stand-office', 'local/theatre'];
const bodies = (building, info, cutoff) => info.sections.map(section => {
  const height = Math.min(section.height, cutoff ?? Infinity), cutaway = cutoff !== undefined && cutoff <= section.height + 1e-6;
  if (building.facade?.type === 'laboratory') return laboratoryBodyGeometry(building, height, info.floorHeight, cutaway);
  if (building.facade?.type === 'dormitory') return dormitoryBodyGeometry(building, height, info.floorHeight, cutaway);
  if (building.facade?.type === 'cafeteria') return cafeteriaBodyGeometry(building, height, info.floorHeight, cutaway);
  return buildingGeometry(section, height, info.floorHeight, building.groundPassages,
    building.floorCorridors?.filter(c => c.partId === section.id), building.stairwells?.filter(s => s.partId === section.id), building.classroomWindows,
    building.solidCores?.filter(c => c.partId === section.id), building.cutouts?.filter(c => c.partId === section.id), cutaway);
});
const mesh = geometry => {
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  result.rotation.x = -Math.PI / 2; result.position.y = .12; result.updateMatrixWorld(); return result;
};
const dispose = geometries => geometries.forEach(geometry => geometry.dispose());

test('all thirteen photo facade configurations generate finite real bodies through normal and selected-floor views', () => {
  let fullTriangles = 0;
  for (const id of ids) {
    const building = campus.buildings.find(b => b.id === id), original = JSON.stringify(building);
    assert.ok(building.classroomWindows, `${id} keeps its saved facade calibration`);
    for (const floorHeight of [2.4, 3.6, 4.2]) {
      const info = buildingLevels(building, { ...site.buildingOverrides[id], floorHeight });
      for (const cutoff of [undefined, floorHeight, Math.min(info.height, 3 * floorHeight)]) {
        const geometries = bodies(building, info, cutoff);
        try {
          for (const [index, geometry] of geometries.entries()) {
            const p = geometry.getAttribute('position');
            assert.ok(p.count > 0, `${id} has a body after clipping`);
            for (let i = 0; i < p.count; i++) {
              assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)), `${id} has no unstable clipping coordinates`);
              assert.ok(p.getZ(i) <= Math.min(cutoff ?? Infinity, info.sections[index].height) + .0001, 'No upper floor or ceiling returns above a photo cut');
            }
            if (cutoff === undefined && floorHeight === 3.6) fullTriangles += p.count / 3;
          }
        } finally { dispose(geometries); }
      }
    }
    assert.equal(JSON.stringify(building), original, 'No generating path changes hand-calibrated model data');
  }
  assert.ok(fullTriangles < 180000, `The thirteen windowed bodies stay below 180k triangles (${fullTriangles})`);
});

test('small curved chords carry windows while short square returns stay solid', () => {
  const ring = Array.from({ length: 65 }, (_, i) => [Math.cos(i * Math.PI / 32) * 4, Math.sin(i * Math.PI / 32) * 4]);
  ring[ring.length - 1] = ring[0];
  const config = { wallThickness: .28, bayWidth: 4, windowWidth: 2.8, sill: .9, top: 2.8, columns: 2, transom: .35 };
  const windows = classroomWindowLayout([[ring]], config, 3.6, 3.6);
  assert.ok(windows.length > 6, 'Rounded bays no longer disappear because each source chord is under 3.2m');
  assert.ok(windows.reduce((n, window) => n + window.mullions.length, 0) < windows.length, 'A curve has logical bay columns, not a forest of posts at every chord');
  assert.deepEqual(classroomWindowLayout([[[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]]], config, 3.6, 3.6), [], 'A short return at a square corner is not misidentified as a curved window run');
  const glass = classroomGlazingGeometry(windows, config);
  try {
    assert.equal(glass.glass.getAttribute('position').count / 3, windows.length * 2, 'Thin glazing uses two faces rather than a twelve-face box');
    assert.ok(glass.frames.getAttribute('position').count / 3 <= (windows.length * 3 + windows.reduce((n, window) => n + window.mullions.length, 0)) * 6,
      'Repeated frames omit invisible end caps while keeping the front and side edges');
    assert.ok(Object.values(glass).every(geometry => geometry.userData.photoOcclusionMask.every(value => value === 0)));
  } finally { dispose(Object.values(glass)); }
});

test('laboratory, dormitory and curved lower cafeteria windows penetrate the real walls, with concrete sills retained', () => {
  for (const id of ids.slice(0, 3)) {
    const building = campus.buildings.find(b => b.id === id), info = buildingLevels(building, { ...site.buildingOverrides[id], floorHeight: 3.6 });
    const shape = building.facade.type === 'dormitory' ? dormitoryProfile(building).shape : building.facade.type === 'cafeteria' ? cafeteriaLowerProfile(building).shape : building;
    const config = building.facade.type === 'cafeteria' ? { ...building.classroomWindows, bayWidth: 2.5, windowWidth: 2.35, sill: .2, top: 3.25, columns: 1 } : building.classroomWindows;
    const windows = building.facade.type === 'laboratory' ? laboratoryWindows(building, info.height, 3.6)
      : classroomWindowLayout([[shape.outer, ...shape.holes]], config, info.height, 3.6);
    const geometry = bodies(building, info)[0], target = mesh(geometry);
    const upper = windows.filter(w => w.bottom >= 3.6 && w.top < 7.2 && Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]) > .2);
    try {
      assert.ok(upper.length > 5, 'An entire upper floor receives evidence-based bays');
      for (const window of upper.filter((_, i) => i % Math.max(1, Math.floor(upper.length / 12)) === 0)) {
        const a = new THREE.Vector3(window.from[0], .12 + (window.bottom + window.top) / 2, window.from[1]);
        const b = new THREE.Vector3(window.to[0], a.y, window.to[1]), direction = b.clone().sub(a).normalize(), normal = new THREE.Vector3(-direction.z, 0, direction.x);
        const start = a.lerp(b, .5).addScaledVector(normal, -.55);
        assert.equal(new THREE.Raycaster(start, normal, 0, 1.1).intersectObject(target).length, 0, 'Light can pass through the aperture instead of hitting a box hidden behind its pane');
        start.y = .12 + 3.6 + .4;
        // Cafeteria's low curtain wall starts above the thin floor slab, whereas
        // the classroom bands have solid masonry below their higher sill.
        if (building.facade.type !== 'cafeteria') assert.ok(new THREE.Raycaster(start, normal, 0, 1.1).intersectObject(target).length, 'Concrete remains below the opening');
      }
    } finally { geometry.dispose(); target.material.dispose(); }
  }
});

test('the photographed teaching roof canopy is fitted to the actual round bay and disappears with selected-floor ceilings', () => {
  const building = campus.buildings.find(b => b.id === 'way/855459420'), info = buildingLevels(building, site.buildingOverrides[building.id]);
  const wing = info.sections.find(part => part.id === 'sixth-floor-wing'), anchor = teachingRoundCanopyAnchor(wing);
  for (const index of [12, 15, 18]) assert.ok(Math.abs(Math.hypot(wing.outer[index][0] - anchor.center[0], wing.outer[index][1] - anchor.center[1]) - anchor.inner) < 1e-8, 'Both shoulders and the outer curved bay share the canopy centre');
  const shifted = { ...wing, outer: wing.outer.map(([x, z]) => [x + 11, z - 4]) }, moved = teachingRoundCanopyAnchor(shifted);
  assert.ok(Math.abs(moved.center[0] - anchor.center[0] - 11) < 1e-8 && Math.abs(moved.center[1] - anchor.center[1] + 4) < 1e-8, 'Moving the approved part also moves its roof framing');
  for (const cutoff of [undefined, 3.6, 3 * 3.6, 6 * 3.6]) {
    const details = photoFacadeDetailGeometry(building, info.sections, info.floorHeight, cutoff);
    try {
      assert.equal(details.glass.getAttribute('position').count > 0, cutoff === undefined, 'The large canopy is removed with ceilings, even on the uppermost selected floor');
      for (const geometry of Object.values(details)) {
        assert.ok(geometry.userData.photoOcclusionMask.every(value => value === 0), 'Roof trim adds no photo-marker occlusion layer');
        const p = geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) assert.ok(Number.isFinite(p.getX(i) + p.getY(i) + p.getZ(i)));
      }
    } finally { dispose(Object.values(details)); }
  }
});

test('the cafeteria central tall strip has its own true openings and stone surround, rather than glass pasted over a wall', () => {
  const building = campus.buildings.find(b => b.facade?.type === 'cafeteria'), info = buildingLevels(building, { ...site.buildingOverrides[building.id], floorHeight: 3.6 });
  const strip = cafeteriaStairStrip(building), upperHeight = info.height - 7.2, windows = cafeteriaUpperWindows(building, upperHeight, 3.6);
  const direction = new THREE.Vector3(-strip.normal[0], 0, -strip.normal[1]), geometry = cafeteriaBodyGeometry(building, info.height, 3.6), target = mesh(geometry);
  const central = windows.filter(window => window.mullions?.length === 3 && Math.hypot(window.from[0] - strip.from[0], window.from[1] - strip.from[1]) < .2);
  try {
    assert.ok(central.length >= 2, 'The strip continues through the upper floors under the preserved floor count');
    for (const window of central) {
      const eye = new THREE.Vector3(strip.center[0], .12 + 7.2 + (window.bottom + window.top) / 2, strip.center[1]).addScaledVector(direction, -.6);
      assert.equal(new THREE.Raycaster(eye, direction, 0, 1.2).intersectObject(target).length, 0, 'The masonry behind each central light is actually removed');
      eye.y = .12 + 7.2 + Math.floor(window.bottom / 3.6) * 3.6 + .13;
      assert.ok(new THREE.Raycaster(eye, direction, 0, 1.2).intersectObject(target).length, 'Thin floor bands remain between lights');
    }
    const details = photoFacadeDetailGeometry(building, info.sections, 3.6);
    try {
      assert.ok(details.accent.getAttribute('position').count > 0, 'The photographed red brick spandrels flank the central white arch');
      assert.ok(details.stone.getAttribute('position').count / 3 < 10000, 'The stone framing stays in the facade detail budget');
    } finally { dispose(Object.values(details)); }
  } finally { geometry.dispose(); target.material.dispose(); }
});

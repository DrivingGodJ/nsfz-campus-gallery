import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry, buildingCoreFootprint } from '../src/building-geometry.ts';
import { stairwellFrame, stairwellShaft, teachingStairGeometry } from '../src/teaching-stairs.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { solidCoreWindowLayout } from '../src/teaching-classrooms.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420');
const stair = building.stairwells.find(s => s.partId === 'sixth-floor-wing');
const enclosure = building.solidCores.find(s => s.partId === stair.partId && s.classroomWindows?.columns === 5);
const room = building.solidCores.find(s => s.partId === stair.partId && s.classroomWindows?.facadeLines?.[0]?.[0]?.[0] === enclosure.classroomWindows.facadeLines[0][1][0]);
const frame = stairwellFrame(stair);
const point = (u, v, y) => { const [x, z] = frame.at(u, v); return new THREE.Vector3(x, y, z); };
const mesh = (geometry, body = false) => {
  const model = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (body) { model.rotation.x = -Math.PI / 2; model.position.y = .12; }
  model.updateMatrixWorld(); return model;
};
const down = (model, origin) => new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObject(model)[0];
const body = (info, selectedFloor) => {
  const section = info.sections.find(s => s.id === stair.partId), height = selectedFloor ? selectedFloor * info.floorHeight : section.height;
  return buildingGeometry(section, height, info.floorHeight, building.groundPassages,
    building.floorCorridors.filter(c => c.partId === section.id), [stair], building.classroomWindows,
    building.solidCores.filter(c => c.partId === section.id), building.cutouts.filter(c => c.partId === section.id), !!selectedFloor);
};

test('the wing flights rise from the corridor toward the window, left first and right on return, through six floors to the roof', () => {
  const [a, b] = enclosure.classroomWindows.facadeLines[0], tangent = new THREE.Vector2(b[0] - a[0], b[1] - a[1]).normalize();
  assert.ok(Math.abs(frame.along[0] * tangent.x + frame.along[1] * tangent.y) < 1e-8, 'Flights run perpendicular to the window facade');
  assert.ok(frame.along[0] > .9, 'The first ascent heads from the corridor landing toward the exterior window');
  assert.equal(stair.firstFlight, 'left');
  assert.equal(clip.difference([stairwellShaft(stair).outer], [enclosure.outer]).length, 0);
  for (const override of [site.buildingOverrides[building.id], { floors: 5, floorHeight: 4.2 }]) {
    const info = buildingLevels(building, override), section = info.sections.find(s => s.id === stair.partId);
    assert.equal(section.floors, 6);
    const geometry = teachingStairGeometry({ ...building, stairwells: [stair] }, info.sections, info.floorHeight), model = mesh(geometry.concrete);
    for (let level = 0; level < section.floors; level++) for (let i = 0; i < stair.stepsPerFlight; i++) {
      const fraction = (i + .5) / stair.stepsPerFlight, rise = (i + 1) * info.floorHeight / 2 / stair.stepsPerFlight;
      const bottom = .12 + level * info.floorHeight + .25;
      const lower = down(model, point(stair.landingDepth + fraction * stair.run, -.7, bottom + info.floorHeight / 2 + .1));
      const upper = down(model, point(stair.landingDepth + stair.run * (1 - fraction), .7, bottom + info.floorHeight + .1));
      assert.ok(lower && Math.abs(lower.point.y - bottom - rise) < 1e-4, 'Left treads ascend toward the window, including the sixth-floor flight');
      assert.ok(upper && Math.abs(upper.point.y - bottom - info.floorHeight / 2 - rise) < 1e-4, 'Right treads return to the next floor or roof landing');
    }
    Object.values(geometry).forEach(g => g.dispose()); model.material.dispose();
  }
});

test('the windowed stair room stays separate from its neighbor and clear of the original courtyard corridor', () => {
  const info = buildingLevels(building, site.buildingOverrides[building.id]), section = info.sections.find(s => s.id === stair.partId);
  const shape = body(info), model = mesh(shape, true), [a, b] = enclosure.classroomWindows.facadeLines[0];
  const tangent = new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize();
  const partition = new THREE.Vector3(b[0], 0, b[1]).add(new THREE.Vector3(frame.along[0], 0, frame.along[1]).multiplyScalar(-2));
  for (let floor = 0; floor < 6; floor++) {
    const origin = partition.clone().addScaledVector(tangent, -.6); origin.y = .12 + floor * info.floorHeight + 1.8;
    assert.ok(new THREE.Raycaster(origin, tangent, 0, 1.2).intersectObject(model).length, 'Every storey keeps a solid separating wall');
  }
  const far = stair.landingDepth * 2 + stair.run;
  const half = stair.width / 2;
  const rectangle = [frame.at(0, -half), frame.at(far, -half), frame.at(far, half), frame.at(0, half), frame.at(0, -half)];
  const originalRooms = buildingCoreFootprint(section, building.groundPassages,
    building.floorCorridors.filter(c => c.partId === section.id), [],
    building.solidCores.filter(c => c.partId === section.id && c !== enclosure && c !== room), building.cutouts.filter(c => c.partId === section.id));
  assert.equal(clip.difference([rectangle], originalRooms).length, 0, 'Flights stay inside the original room without occupying the corridor');
  const windows = solidCoreWindowLayout([enclosure], section.height, info.floorHeight);
  assert.equal(windows.length, 6);
  assert.equal(windows[0].mullions.length, 6, 'Five window columns have six vertical frame lines');
  const glazing = teachingWindowGeometry(building, info.sections, info.floorHeight), frames = mesh(glazing.frames), glass = mesh(glazing.glass);
  const window = windows[2], center = new THREE.Vector3((window.from[0] + window.to[0]) / 2, .12 + window.bottom + (window.top - window.bottom) * .28, (window.from[1] + window.to[1]) / 2);
  const inward = new THREE.Vector3(-frame.along[0], 0, -frame.along[1]), origin = center.clone().addScaledVector(inward, -1);
  assert.ok(new THREE.Raycaster(origin, inward, 0, 1.5).intersectObject(frames).length, 'The photographed low horizontal transom is actually rendered');
  assert.equal(new THREE.Raycaster(origin, inward, 0, 1.5).intersectObject(model).length, 0, 'The stair window aperture is clear of concrete');
  const ordinary = solidCoreWindowLayout([room], section.height, info.floorHeight)[2];
  const ordinaryCenter = new THREE.Vector3((ordinary.from[0] + ordinary.to[0]) / 2, .12 + ordinary.bottom + .5, (ordinary.from[1] + ordinary.to[1]) / 2).addScaledVector(inward, -1);
  assert.ok(new THREE.Raycaster(ordinaryCenter, inward, 0, 1.5).intersectObject(glass).length, 'The neighboring room keeps its ordinary exterior window');
  shape.dispose(); model.material.dispose(); Object.values(glazing).forEach(g => g.dispose()); frames.material.dispose(); glass.material.dispose();
});

test('only the stair enclosure protrudes above the sixth-floor roof, with an open shaft and a usable roof exit', () => {
  const info = buildingLevels(building, site.buildingOverrides[building.id]), section = info.sections.find(s => s.id === stair.partId);
  const geometry = body(info), model = mesh(geometry, true), roof = .12 + section.height;
  const top = down(model, point(.4, 0, roof + 5));
  assert.ok(top && Math.abs(top.point.y - roof - stair.roofAccess.height) < 1e-4, 'The small top room covers only the stair room');
  const landing = down(model, point(.4, 0, roof + 1));
  assert.ok(landing && Math.abs(landing.point.y - roof - .25) < 1e-4, 'The roof landing meets the final flight');
  const shaft = down(model, point(2, 0, roof + .15));
  assert.ok(shaft && Math.abs(shaft.point.y - .37) < 1e-4, 'The original roof slab does not cap the ascent');
  const center = room.outer.slice(0, -1).reduce((p, q) => [p[0] + q[0] / 4, p[1] + q[1] / 4], [0, 0]);
  const neighbor = down(model, new THREE.Vector3(center[0], roof + 5, center[1]));
  assert.ok(neighbor && Math.abs(neighbor.point.y - roof) < 1e-4, 'The adjacent room retains its original roof height');
  const forward = new THREE.Vector3(frame.along[0], 0, frame.along[1]);
  for (const edge of stair.roofAccess.openEdges) {
    const [a, b] = [enclosure.outer[edge], enclosure.outer[edge + 1]];
    const exit = new THREE.Vector3((a[0] + b[0]) / 2, roof + 1.3, (a[1] + b[1]) / 2);
    assert.equal(new THREE.Raycaster(exit.addScaledVector(forward, -.6), forward, 0, 1.2).intersectObject(model).length, 0, 'The whole rear side stays open at the roof landing');
  }
  const vertices = geometry.getAttribute('position');
  const bounds = enclosure.outer.reduce((b, p) => [Math.min(b[0], p[0]), Math.max(b[1], p[0]), Math.min(b[2], p[1]), Math.max(b[3], p[1])], [Infinity, -Infinity, Infinity, -Infinity]);
  for (let i = 0; i < vertices.count; i++) if (vertices.getZ(i) > section.height + 1e-4) {
    assert.ok(vertices.getX(i) >= bounds[0] - 1e-4 && vertices.getX(i) <= bounds[1] + 1e-4 && -vertices.getY(i) >= bounds[2] - 1e-4 && -vertices.getY(i) <= bounds[3] + 1e-4, 'No neighboring building volume rises above the roof');
  }
  geometry.dispose(); model.material.dispose();
  for (const floor of [3, 6]) {
    const cut = body(info, floor), structure = teachingStairGeometry({ ...building, stairwells: [stair] }, info.sections, info.floorHeight, floor * info.floorHeight);
    cut.computeBoundingBox(); assert.ok(cut.boundingBox.max.z <= floor * info.floorHeight + 1e-4, 'The top room disappears in a floor cutaway');
    Object.values(structure).forEach(g => { g.computeBoundingBox(); assert.ok(g.boundingBox.max.y <= .12 + floor * info.floorHeight + 1e-4); g.dispose(); }); cut.dispose();
  }
});

test('the whole corridor-facing wall is absent on every floor, and both flights reach the side walls', () => {
  const info = buildingLevels(building, site.buildingOverrides[building.id]), geometry = body(info), model = mesh(geometry, true);
  const forward = new THREE.Vector3(frame.along[0], 0, frame.along[1]);
  const structure = teachingStairGeometry({ ...building, stairwells: [stair] }, info.sections, info.floorHeight), steps = mesh(structure.concrete);
  assert.deepEqual(enclosure.openEdges, [0, 4], 'Both segments of the rear wall are removed');
  for (let level = 0; level < 6; level++) {
    const floor = .12 + level * info.floorHeight + .25;
    for (const edge of enclosure.openEdges) for (const t of [.15, .5, .85]) for (const height of [1.3, 2.65]) {
      const [a, b] = [enclosure.outer[edge], enclosure.outer[edge + 1]];
      const entry = new THREE.Vector3(a[0] + (b[0] - a[0]) * t, floor + height, a[1] + (b[1] - a[1]) * t);
      assert.equal(new THREE.Raycaster(entry.addScaledVector(forward, -.6), forward, 0, 1.2).intersectObject(model).length, 0, 'No wall or lintel blocks any part of the rear opening');
    }
    for (const u of [-.2, .3, .7, 1.2]) for (const v of [-2, -1, 0, 1, 2]) {
      const landing = down(model, point(u, v, floor + 1.1));
      assert.ok(landing && Math.abs(landing.point.y - floor) < 1e-4, 'The corridor and both flights share a continuous floor landing');
    }
    for (const side of [-1, 1]) {
      const u = stair.landingDepth + stair.run * .35, v = side * (stair.width / 2 - .05);
      assert.ok(down(steps, point(u, v, floor + info.floorHeight + .1)), 'Each flight has a tread at its outer wall edge');
      const direction = new THREE.Vector3(...[frame.across[0] * side, 0, frame.across[1] * side]);
      assert.ok(new THREE.Raycaster(point(u, v, floor + 1.3), direction, 0, .15).intersectObject(model).length, 'The flight edge meets its side wall without a walking gap');
    }
  }
  geometry.dispose(); model.material.dispose(); Object.values(structure).forEach(g => g.dispose()); steps.material.dispose();
});

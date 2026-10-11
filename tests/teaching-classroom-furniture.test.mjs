import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { CLASSROOM_BAYS, classroomAt, teachingClassroomFurniture, teachingClassroomInterior } from '../src/teaching-classroom-furniture.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const teaching = campus.buildings.find(building => building.id === 'way/855459420');
const info = buildingLevels(teaching, site.buildingOverrides[teaching.id]);
const dispose = model => Object.values(model).forEach(geometry => geometry.dispose());
function insideRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
function inside(x, z, area) { return area.some(([outer, ...holes]) => insideRing(x, z, outer) && !holes.some(hole => insideRing(x, z, hole))); }
function mesh(geometry) { const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); object.updateMatrixWorld(); return object; }
function bounds(geometry, size = 36) {
  const positions = geometry.getAttribute('position'), result = [];
  for (let start = 0; start < positions.count; start += size) {
    const box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = start; i < start + size; i++) {
      const x = positions.getX(i), z = positions.getZ(i), point = [.9868974432552757 * x - .16134880382636804 * z, positions.getY(i), .16134880382636804 * x + .9868974432552757 * z];
      for (let axis = 0; axis < 3; axis++) { box.min[axis] = Math.min(box.min[axis], point[axis]); box.max[axis] = Math.max(box.max[axis], point[axis]); }
    }
    result.push({ ...box, center: box.min.map((value, axis) => (value + box.max[axis]) / 2) });
  }
  return result;
}

test('every chair faces its desk along the teaching-wing axis, with blackboards mounted on solid interior teaching ends clear of glazing', () => {
  const photos = JSON.stringify(site.photos), model = teachingClassroomFurniture(teaching, info.sections, info.floorHeight);
  const glazing = teachingWindowGeometry(teaching, info.sections, info.floorHeight), wood = bounds(model.wood), boards = bounds(model.boards), storage = bounds(model.storage);
  let seats = 0;
  for (const bay of CLASSROOM_BAYS) {
    const floor = .12 + (bay.floor - 1) * info.floorHeight + .25;
    const matches = (box, bottom, top) => Math.abs(box.min[1] - floor - bottom) < 1e-4 && Math.abs(box.max[1] - floor - top) < 1e-4 && box.center[0] < bay.u && box.center[0] > bay.u - 8 && Math.abs(box.center[2] - bay.v) < 3.4;
    const desks = wood.filter(box => matches(box, .74, .80)), chairs = wood.filter(box => matches(box, .43, .49)), backs = wood.filter(box => matches(box, .53, .88));
    assert.equal(chairs.length, bay.columns * bay.rows, `${bay.id} retains its complete seating grid`);
    for (const chair of chairs) {
      const desk = desks.find(box => Math.abs(box.center[0] - chair.center[0] - .56) < 1e-4 && Math.abs(box.center[2] - chair.center[2]) < 1e-4);
      const back = backs.find(box => Math.abs(box.center[0] - chair.center[0] + .17) < 1e-4 && Math.abs(box.center[2] - chair.center[2]) < 1e-4);
      assert.ok(desk && back, `${bay.id}: chair back → seat → desk faces +u with the window band to the side`);
      assert.ok(desk.max[2] - desk.min[2] > desk.max[0] - desk.min[0], 'Desk width follows the transverse classroom axis'); seats++;
    }
  }
  assert.equal(seats, 90);
  assert.equal(boards.length, 2);
  const panels = storage.filter(box => box.max[1] - box.min[1] > 3);
  assert.equal(panels.length, boards.length, 'Each photographed board has a solid teaching panel');
  for (const board of boards) {
    const panel = panels.find(box => Math.abs(box.min[0] - board.max[0]) < 1e-4 && Math.abs(box.center[2] - board.center[2]) < 1e-4 && box.min[1] < board.min[1] && box.max[1] > board.max[1]);
    assert.ok(panel, 'The board back touches the classroom end panel');
    assert.ok(panel.min[2] < board.min[2] && panel.max[2] > board.max[2], 'Solid teaching wall extends around the board');
    const table = wood.find(box => Math.abs(box.center[0] - board.center[0] + .65) < 1e-4 && Math.abs(box.center[2] - board.center[2]) < 1e-4 && Math.abs(box.max[1] - board.min[1] + .08) < 1e-4);
    assert.ok(table && table.max[2] - table.min[2] > table.max[0] - table.min[0], 'Teacher table shares the board axis and stays in the front aisle');
    const floor = Math.round((panel.min[1] - .12 - .25) / info.floorHeight);
    assert.ok(Math.abs(panel.min[1] - (.12 + floor * info.floorHeight + .25)) < 1e-4, 'Teaching wall rests on its actual classroom slab');
  }
  for (const pane of bounds(glazing.glass, 6)) for (const item of [...boards, ...panels]) {
    assert.equal([0, 1, 2].every(axis => item.min[axis] < pane.max[axis] + 1e-4 && item.max[axis] > pane.min[axis] - 1e-4), false, 'No blackboard or teaching wall intersects an unchanged window pane');
  }
  assert.equal(JSON.stringify(site.photos), photos, 'Saved photo positions and directions remain unchanged');
  dispose(model); dispose(glazing);
});

test('only photo-confirmed classroom levels receive desks; every vertex clears the real stairs, walls and corridors', () => {
  const original = JSON.stringify(teaching), model = teachingClassroomFurniture(teaching, info.sections, info.floorHeight);
  const floors = new Map([1, 3, 5].map(floor => [floor, info.sections.map(section => teachingClassroomInterior(teaching, section, floor))]));
  let triangles = 0;
  for (const geometry of Object.values(model)) {
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'); triangles += positions.count / 3;
    assert.ok(geometry.userData.photoOcclusionMask.every(mask => mask === 0));
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i), floor = Math.floor((y - .12 - .001) / info.floorHeight) + 1;
      assert.ok(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z));
      assert.ok(floors.has(floor), `Only the confirmed floor receives furniture: ${floor}`);
      assert.ok(floors.get(floor).some(area => inside(x, z, area)), 'A classroom vertex stays inside the wall-inset core, outside every corridor/stair/elevator');
    }
    for (let i = 0; i < positions.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, i), b = new THREE.Vector3().fromBufferAttribute(positions, i + 1), c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
      assert.ok(b.sub(a).cross(c.sub(a)).normalize().dot(new THREE.Vector3().fromBufferAttribute(normals, i)) > .999);
    }
  }
  for (const bay of CLASSROOM_BAYS) for (const id of bay.photoIds) {
    const photo = site.photos.find(photo => photo.id === id);
    assert.equal(photo.buildingId, teaching.id); assert.equal(photo.floor, bay.floor);
  }
  assert.ok(triangles > 7000 && triangles < 14000, 'Desks and chairs are recognisable merged detail within a small triangle budget');
  assert.equal(JSON.stringify(teaching), original); dispose(model);
});

test('classroom desks rest on their slab and become visible when the selected ceiling is removed', () => {
  const section = info.sections.find(section => section.id === 'main'), ceiling = info.floorHeight * 3;
  const model = teachingClassroomFurniture(teaching, info.sections, info.floorHeight, ceiling), bay = CLASSROOM_BAYS[0];
  const body = buildingGeometry(section, ceiling, info.floorHeight, teaching.groundPassages,
    teaching.floorCorridors.filter(c => c.partId === section.id), teaching.stairwells.filter(c => c.partId === section.id), teaching.classroomWindows,
    teaching.solidCores.filter(c => c.partId === section.id), teaching.cutouts.filter(c => c.partId === section.id), true);
  body.rotateX(-Math.PI / 2); body.translate(0, .12, 0);
  const [x, z] = classroomAt(bay.u - 1.55, bay.v), room = mesh(body), wood = mesh(model.wood);
  const hits = new THREE.Raycaster(new THREE.Vector3(x, ceiling + .11, z), new THREE.Vector3(0, -1, 0), 0, 3).intersectObjects([room, wood]);
  assert.ok(hits.length && hits[0].object === wood, 'The real third-floor slab shell exposes the furnished desk');
  assert.ok(Math.abs(hits[0].point.y - (.12 + 2 * info.floorHeight + .25 + .8)) < 1e-4);
  const panel = bounds(model.storage).find(box => Math.abs(box.center[0] - bay.u - .1025) < 1e-4 && Math.abs(box.center[2] - bay.v) < 1e-4);
  assert.ok(panel && Math.abs(panel.min[1] - (.12 + 2 * info.floorHeight + .25)) < 1e-4, 'The board teaching wall reaches the actual slab top');
  const [tableX, tableZ] = classroomAt(bay.u - .65, bay.v), woodVertices = model.wood.getAttribute('position');
  const teacherY = Array.from({ length: woodVertices.count }, (_, i) => Math.hypot(woodVertices.getX(i) - tableX, woodVertices.getZ(i) - tableZ) < .69 ? woodVertices.getY(i) : Infinity);
  assert.ok(Math.abs(Math.min(...teacherY) - (.12 + 2 * info.floorHeight + .25)) < 1e-4, 'The teacher table pedestal reaches the real slab top');
  for (const geometry of Object.values(model)) for (const y of geometry.getAttribute('position').array.filter((_, i) => i % 3 === 1)) assert.ok(y <= .12 + ceiling + 1e-4);
  const low = teachingClassroomFurniture(teaching, info.sections, info.floorHeight, info.floorHeight), lowerOverride = info.sections.map(section => ({ ...section, floors: 3, height: 3 * info.floorHeight }));
  const removedFifth = teachingClassroomFurniture(teaching, lowerOverride, info.floorHeight);
  low.metal.computeBoundingBox();
  assert.ok(Math.abs(low.metal.boundingBox.min.y - (.12 + .25)) < 1e-4, 'Metal sled feet contact the actual slab top without floating');
  assert.equal(low.boards.getAttribute('position').count, 0, 'Third-floor boards do not leak into a first-floor slice');
  assert.ok(bounds(removedFifth.storage).every(box => box.max[1] < .12 + 3 * info.floorHeight + 1e-4), 'A reduced storey override cannot retain fifth-floor cabinets');
  body.dispose(); dispose(model); dispose(low); dispose(removedFifth);
});

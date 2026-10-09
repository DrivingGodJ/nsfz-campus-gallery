import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
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
  const [x, z] = classroomAt(bay.u, bay.front + 1.55), room = mesh(body), wood = mesh(model.wood);
  const hits = new THREE.Raycaster(new THREE.Vector3(x, ceiling + .11, z), new THREE.Vector3(0, -1, 0), 0, 3).intersectObjects([room, wood]);
  assert.ok(hits.length && hits[0].object === wood, 'The real third-floor slab shell exposes the furnished desk');
  assert.ok(Math.abs(hits[0].point.y - (.12 + 2 * info.floorHeight + .25 + .8)) < 1e-4);
  const [supportX, supportZ] = classroomAt(bay.u + 2.08, bay.front), supports = model.metal.getAttribute('position');
  const supportY = Array.from({ length: supports.count }, (_, i) => Math.hypot(supports.getX(i) - supportX, supports.getZ(i) - supportZ) < .055 ? supports.getY(i) : Infinity);
  assert.ok(Math.abs(Math.min(...supportY) - (.12 + 2 * info.floorHeight + .25)) < 1e-4, 'The estimated movable teaching board has a floor-reaching support');
  const [tableX, tableZ] = classroomAt(bay.u, bay.front + .65), woodVertices = model.wood.getAttribute('position');
  const teacherY = Array.from({ length: woodVertices.count }, (_, i) => Math.hypot(woodVertices.getX(i) - tableX, woodVertices.getZ(i) - tableZ) < .69 ? woodVertices.getY(i) : Infinity);
  assert.ok(Math.abs(Math.min(...teacherY) - (.12 + 2 * info.floorHeight + .25)) < 1e-4, 'The teacher table pedestal reaches the real slab top');
  for (const geometry of Object.values(model)) for (const y of geometry.getAttribute('position').array.filter((_, i) => i % 3 === 1)) assert.ok(y <= .12 + ceiling + 1e-4);
  const low = teachingClassroomFurniture(teaching, info.sections, info.floorHeight, info.floorHeight), lowerOverride = info.sections.map(section => ({ ...section, floors: 3, height: 3 * info.floorHeight }));
  const removedFifth = teachingClassroomFurniture(teaching, lowerOverride, info.floorHeight);
  low.metal.computeBoundingBox();
  assert.ok(Math.abs(low.metal.boundingBox.min.y - (.12 + .25)) < 1e-4, 'Metal sled feet contact the actual slab top without floating');
  assert.equal(low.boards.getAttribute('position').count, 0, 'Third-floor boards do not leak into a first-floor slice');
  assert.equal(removedFifth.storage.getAttribute('position').count, 0, 'A reduced storey override cannot retain fifth-floor cabinets');
  body.dispose(); dispose(model); dispose(low); dispose(removedFifth);
});

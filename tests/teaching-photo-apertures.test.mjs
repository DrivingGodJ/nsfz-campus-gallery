import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { solidCoreWindowLayout } from '../src/teaching-classrooms.ts';
import { teachingDetailGeometry } from '../src/teaching-details.ts';
import { teachingRailGeometry, teachingWindowGeometry } from '../src/architecture-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420');
const info = buildingLevels(building, site.buildingOverrides[building.id]);
const room = building.solidCores.find(core => core.startFloor === 2);
const bodies = (cutawayHeight) => info.sections.map(section => {
  const geometry = buildingGeometry(section, Math.min(section.height, cutawayHeight ?? Infinity), info.floorHeight,
    building.groundPassages, building.floorCorridors.filter(c => c.partId === section.id),
    building.stairwells.filter(s => s.partId === section.id), building.classroomWindows,
    building.solidCores.filter(c => c.partId === section.id), building.cutouts.filter(c => c.partId === section.id),
    cutawayHeight !== undefined);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  mesh.rotation.x = -Math.PI / 2; mesh.position.y = .12; mesh.updateMatrixWorld(); return mesh;
});
const disposeMeshes = meshes => meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });

test('the three photographed north-facing windows are not plugged by window jambs or eye-height AC units', () => {
  const ids = ['5ae0eead-70da-49f3-9a09-41fb86ec4234', 'b87e9c8e-5e80-4de4-8b17-76a406d741c3', 'd3336996-e89d-4690-a0ce-695423164f9f'];
  const original = JSON.stringify(site.photos), details = teachingDetailGeometry(building, info.sections, info.floorHeight);
  const units = new THREE.Mesh(details.units, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); units.updateMatrixWorld();
  try {
    for (const id of ids) {
      const photo = site.photos.find(p => p.id === id);
      const origin = new THREE.Vector3(photo.position.x, (photo.floor - 1) * info.floorHeight + (photo.cameraHeight ?? 1.6), photo.position.z);
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(photo.pitch * Math.PI / 180, -photo.heading * Math.PI / 180, 0, 'YXZ'));
      const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
      for (const cutoff of [undefined, photo.floor * info.floorHeight]) {
        const meshes = bodies(cutoff);
        try {
          const ray = new THREE.Raycaster(origin, direction, 0, 1.5);
          assert.equal(ray.intersectObjects(meshes).length, 0, `${photo.title}: the central photographed sightline crosses a real window aperture`);
          assert.equal(ray.intersectObject(units).length, 0, `${photo.title}: AC units stay below the window, not directly in front of the lens`);
        } finally { disposeMeshes(meshes); }
      }
    }
    assert.equal(JSON.stringify(site.photos), original, 'No photograph position, height or direction changes to pass the check');
  } finally { Object.values(details).forEach(g => g.dispose()); units.material.dispose(); }
});

test('the independently glazed west room keeps actual upper-floor windows and ground-floor stair space', () => {
  assert.ok(room.classroomWindows, 'DSC09912 and DSC09803 identify a dedicated glazed room above the open stairs');
  const windows = solidCoreWindowLayout([room], info.sections[0].height, info.floorHeight);
  assert.ok(windows.length > 5 && windows.every(window => window.bottom >= info.floorHeight));
  for (const cutoff of [undefined, 2 * info.floorHeight, 3 * info.floorHeight]) {
    const meshes = bodies(cutoff);
    try {
      for (const window of windows.filter(w => w.bottom > info.floorHeight && w.top < 2 * info.floorHeight)) {
        const a = new THREE.Vector3(window.from[0], .12 + (window.bottom + window.top) / 2, window.from[1]);
        const b = new THREE.Vector3(window.to[0], a.y, window.to[1]), along = b.clone().sub(a).normalize();
        const normal = new THREE.Vector3(-along.z, 0, along.x), origin = a.lerp(b, .5).addScaledVector(normal, -.45);
        assert.equal(new THREE.Raycaster(origin, normal, 0, .9).intersectObjects(meshes).length, 0, 'The glass has a hollow room and open wall behind it');
      }
      const point = room.outer.slice(0, -1).reduce((sum, p) => sum.add(new THREE.Vector3(p[0], 0, p[1])), new THREE.Vector3()).divideScalar(room.outer.length - 1);
      point.y = .12 + info.floorHeight * 1.5;
      const up = new THREE.Raycaster(point, new THREE.Vector3(0, 1, 0), 0, info.floorHeight).intersectObjects(meshes)[0];
      const down = new THREE.Raycaster(point, new THREE.Vector3(0, -1, 0), 0, info.floorHeight).intersectObjects(meshes)[0];
      assert.ok(down, 'The independent room still has its second-floor slab');
      if (cutoff === 2 * info.floorHeight) {
        assert.equal(up, undefined, 'Selecting the glazed room floor removes its ceiling');
        const above = point.clone(); above.y = .12 + cutoff + 1;
        const exposed = new THREE.Raycaster(above, new THREE.Vector3(0, -1, 0)).intersectObjects(meshes)[0];
        assert.ok(exposed && Math.abs(exposed.point.y - down.point.y) < .0001, 'From above the room, the selected floor is reached directly without a residual cap');
      } else assert.ok(up, 'The ordinary room retains its actual ceiling below higher floors');
      assert.ok(Math.abs(down.point.y - (.12 + info.floorHeight + .25)) < .0001);
    } finally { disposeMeshes(meshes); }
  }
});

test('DSC06887 corridor-end walls have real panes and replace only the two marked upper-floor guards', () => {
  const wing = building.parts.find(part => part.id === 'sixth-floor-wing');
  const enclosures = building.solidCores.filter(core => core.partId === wing.id && core.classroomWindows);
  assert.equal(enclosures.length, 2, 'The saved end enclosure follows the two marked faces, without glazing the adjacent open corridor');
  const original = JSON.stringify(building);
  for (const cutoff of [undefined, 3 * info.floorHeight]) {
    const meshes = bodies(cutoff), windows = teachingWindowGeometry(building, info.sections, info.floorHeight, cutoff);
    const glass = new THREE.Mesh(windows.glass, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); glass.updateMatrixWorld();
    const frames = new THREE.Mesh(windows.frames, glass.material); frames.updateMatrixWorld();
    const rails = new THREE.Mesh(teachingRailGeometry(building, info.sections, info.floorHeight, cutoff), glass.material); rails.updateMatrixWorld();
    try {
      for (const [i, core] of enclosures.entries()) {
        const start = i ? wing.outer[22] : wing.outer[21].map((v, axis) => v + (wing.outer[22][axis] - v) * .55);
        assert.deepEqual(core.classroomWindows.facadeLines, [[start, wing.outer[22 + i]]], 'Only the outer-corner 45 percent of the end-facing guard becomes a wall');
        const [from, to] = core.classroomWindows.facadeLines[0], direction = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
        const normal = new THREE.Vector3(-direction.z, 0, direction.x);
        const point = new THREE.Vector3((from[0] + to[0]) / 2, 0, (from[1] + to[1]) / 2);
        for (let floor = 1; floor < (cutoff ? 3 : 6); floor++) {
          const origin = point.clone().addScaledVector(normal, -.4); origin.y = .12 + floor * info.floorHeight + 2;
          const ray = new THREE.Raycaster(origin, normal, 0, .9);
          assert.equal(ray.intersectObjects(meshes).length, 0, 'The confirmed glass pane has an actual opening through the masonry');
          assert.ok(ray.intersectObject(glass).length, 'Each enclosed upper floor receives the photographed framed glazing');
          origin.y = .12 + floor * info.floorHeight + .75;
          assert.ok(new THREE.Raycaster(origin, normal, 0, .9).intersectObjects(meshes).length, 'The lower wall band is retained below the glass');
          assert.equal(new THREE.Raycaster(origin, normal, 0, .9).intersectObject(rails).length, 0, 'Blue rails do not continue through the enclosed wall or window');
        }
        const ground = point.clone().addScaledVector(normal, -.4); ground.y = .12 + 2;
        assert.equal(new THREE.Raycaster(ground, normal, 0, .9).intersectObjects(meshes).length, 0, 'The existing ground-level circulation remains open');
        assert.equal(new THREE.Raycaster(ground, normal, 0, .9).intersectObjects([glass, frames]).length, 0, 'No pane or window frame is introduced on the first floor');
        ground.y = .12 + .75;
        assert.equal(new THREE.Raycaster(ground, normal, 0, .9).intersectObject(rails).length, 0, 'The first floor also stays free of new guards');
        if (cutoff) {
          const inside = point.clone().addScaledVector(normal, 1.5); inside.y = .12 + cutoff - 1;
          assert.equal(new THREE.Raycaster(inside, new THREE.Vector3(0, 1, 0), 0, 2).intersectObjects(meshes).length, 0, 'Selecting this corridor floor removes its ceiling');
        }
      }
      const [a, b] = [wing.outer[19], wing.outer[20]], along = new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize(), normal = new THREE.Vector3(-along.z, 0, along.x);
      const open = new THREE.Vector3((a[0] + b[0]) / 2, .12 + info.floorHeight + .75, (a[1] + b[1]) / 2).addScaledVector(normal, -.4);
      assert.ok(new THREE.Raycaster(open, normal, 0, .9).intersectObject(rails).length, 'The adjacent photographed open corridor retains its blue guard');
      const [c, d] = [wing.outer[21], wing.outer[22]], route = new THREE.Vector3(d[0] - c[0], 0, d[1] - c[1]).normalize(), inward = new THREE.Vector3(-route.z, 0, route.x);
      const remaining = new THREE.Vector3(c[0], .12 + info.floorHeight + 2, c[1]).lerp(new THREE.Vector3(d[0], .12 + info.floorHeight + 2, d[1]), .2).addScaledVector(inward, -.4);
      assert.equal(new THREE.Raycaster(remaining, inward, 0, .9).intersectObjects([...meshes, glass, frames]).length, 0, 'The other 55 percent stays open towards the rounded wing');
      remaining.y = .12 + info.floorHeight + .75;
      assert.ok(new THREE.Raycaster(remaining, inward, 0, .9).intersectObject(rails).length, 'The unclosed half receives its original blue guard again');
    } finally {
      disposeMeshes(meshes); Object.values(windows).forEach(geometry => geometry.dispose()); rails.geometry.dispose(); glass.material.dispose();
    }
  }
  assert.equal(JSON.stringify(building), original, 'Rendering the enclosure leaves approved geometry and parameters untouched');
});

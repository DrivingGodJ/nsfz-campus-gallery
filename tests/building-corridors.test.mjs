import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { photoPointVisible, photoOccluders, PHOTO_MARKER_LIFT } from '../src/photo-clusters.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(item => item.id === 'way/855459420');
const main = building.parts.find(part => part.id === 'main');
const [a, b] = [main.outer[19], main.outer[20]];
const along = new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize();
const inward = new THREE.Vector3(-along.z, 0, along.x);
const position = (t, depth, y) => new THREE.Vector3(a[0], y, a[1]).lerp(new THREE.Vector3(b[0], y, b[1]), t).addScaledVector(inward, depth);

function model(override = site.buildingOverrides[building.id], floor) {
  const info = buildingLevels(building, override);
  const meshes = info.sections.map(section => {
    const height = floor ? Math.min(section.height, floor * info.floorHeight) : section.height;
    const geometry = buildingGeometry(section, height, info.floorHeight, building.groundPassages, building.floorCorridors.filter(corridor => corridor.partId === section.id), building.stairwells?.filter(stair => stair.partId === section.id));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = .12; mesh.updateMatrixWorld();
    return mesh;
  });
  return { info, meshes, dispose: () => meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); }) };
}

test('the marked forest-facing facade and both atriums are recessed three metres on every floor', async () => {
  assert.deepEqual(building.floorCorridors.filter(corridor => !('points' in corridor)).map(({ slabInfill, ...corridor }) => corridor), [{ partId: 'main', edge: 19, depth: 3 }, { partId: 'main', holeIndex: 0, depth: 3 }, { partId: 'sixth-floor-wing', holeIndex: 0, depth: 3 }, { partId: 'sixth-floor-wing', edges: [0, 1, 2], depth: 3 }, { partId: 'sixth-floor-wing', edges: [19, 20, 21, 22], depth: 3 }, { partId: 'sixth-floor-wing', passageIndex: 1, depth: 3 }]);
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus, 'Corridors persist after an OSM map refresh');
  const original = JSON.stringify([building, site]);
  for (const override of [site.buildingOverrides[building.id], { floors: 7, floorHeight: 4.2, partFloors: { 'sixth-floor-wing': 4 } }]) {
    const { info, meshes, dispose } = model(override);
    for (let level = 0; level < override.floors; level++) for (const t of [.1, .3, .5, .9]) {
      const start = position(t, -1, .12 + (level + .5) * info.floorHeight);
      const ray = new THREE.Raycaster(start, inward, 0, 8);
      const hits = ray.intersectObjects(meshes, false);
      assert.ok(hits.length, 'The interior building wall remains behind the corridor');
      assert.ok(Math.abs(hits[0].distance - 4) < 1e-4, 'The first wall is three metres behind the original facade, with no front wall left');
      const inside = position(t, 1.5, start.y);
      const down = new THREE.Raycaster(inside, new THREE.Vector3(0, -1, 0), 0, info.floorHeight);
      const up = new THREE.Raycaster(inside, new THREE.Vector3(0, 1, 0), 0, info.floorHeight);
      const floor = down.intersectObjects(meshes, false)[0], ceiling = up.intersectObjects(meshes, false)[0];
      assert.ok(floor && ceiling, 'Every open corridor retains a floor and a visible downward-facing ceiling');
      assert.ok(Math.abs(floor.point.y - (.12 + level * info.floorHeight + .25)) < 1e-4);
      const ceilingHeight = (level + 1) * info.floorHeight - (level === override.floors - 1 ? .25 : 0);
      assert.ok(Math.abs(ceiling.point.y - (.12 + ceilingHeight)) < 1e-4);
      assert.ok(floor.face.normal.z > .99 && ceiling.face.normal.z < -.99);
    }
    meshes[0].geometry.computeBoundingBox();
    assert.ok(Math.abs(meshes[0].geometry.boundingBox.max.z - override.floors * info.floorHeight) < 1e-4, 'The main roof and total height remain unchanged');
    dispose();
  }
  assert.equal(JSON.stringify([building, site]), original);
});

test('corridor slabs do not fill either atrium or block the existing ground roads', () => {
  for (const floor of [undefined, 1, 3]) {
    const { info, meshes, dispose } = model(undefined, floor);
    for (const part of building.parts) {
      const hole = part.holes[0];
      for (const u of [.1, .5, .9]) for (const v of [.1, .5, .9]) {
        const x = hole[0][0] + (hole[1][0] - hole[0][0]) * u + (hole[3][0] - hole[0][0]) * v;
        const z = hole[0][1] + (hole[1][1] - hole[0][1]) * u + (hole[3][1] - hole[0][1]) * v;
        assert.equal(new THREE.Raycaster(new THREE.Vector3(x, 100, z), new THREE.Vector3(0, -1, 0)).intersectObjects(meshes, false).length, 0, 'Slabs keep the courtyard holes open from roof to ground');
      }
    }
    for (const passage of building.groundPassages) {
      const [from, to] = passage.points, direction = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
      for (const offset of [-.45, 0, .45]) {
        const start = new THREE.Vector3(from[0] + direction.z * passage.width * offset, .12 + info.floorHeight / 2, from[1] - direction.x * passage.width * offset).addScaledVector(direction, -2);
        const ray = new THREE.Raycaster(start, direction, 0, Math.hypot(to[0] - from[0], to[1] - from[1]) + 4);
        assert.equal(ray.intersectObjects(meshes, false).length, 0, 'The full road width remains open under the building');
      }
    }
    const start = position(.3, -1, .12 + info.floorHeight / 2);
    assert.ok(Math.abs(new THREE.Raycaster(start, inward, 0, 8).intersectObjects(meshes, false)[0].distance - 4) < 1e-4, 'The visible floor stays recessed in a cutaway');
    dispose();
  }
});

test('slabs have no duplicated triangles and both wings keep their original outer roof outlines', () => {
  const { info, meshes, dispose } = model();
  const triangles = new Set(), vertices = meshes[0].geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i += 3) {
    const key = [0, 1, 2].map(j => [vertices.getX(i + j), vertices.getY(i + j), vertices.getZ(i + j)].map(value => value.toFixed(5)).join(',')).sort().join(';');
    assert.ok(!triangles.has(key), 'Internal slab caps are removed instead of overlapping and flickering');
    triangles.add(key);
  }
  for (const [i, section] of info.sections.entries()) {
    const original = buildingGeometry(section, section.height, info.floorHeight, building.groundPassages);
    original.computeBoundingBox(); meshes[i].geometry.computeBoundingBox();
    assert.ok(original.boundingBox.equals(meshes[i].geometry.boundingBox), 'Roof bounds and wing heights stay unchanged');
    original.dispose();
  }
  dispose();
});

test('each atrium has open corridors on all four sides, with retained slabs on every floor', () => {
  const { info, meshes, dispose } = model();
  for (const [index, section] of info.sections.entries()) {
    const ring = section.holes[0], center = ring.slice(0, -1).reduce((sum, p) => sum.add(new THREE.Vector3(p[0], 0, p[1])), new THREE.Vector3()).divideScalar(ring.length - 1);
    for (let edge = 0; edge < ring.length - 1; edge++) {
      const middle = new THREE.Vector3((ring[edge][0] + ring[edge + 1][0]) / 2, 0, (ring[edge][1] + ring[edge + 1][1]) / 2);
      const intoWall = middle.clone().sub(center).normalize();
      for (let level = 0; level < section.floors; level++) {
        const start = middle.clone().addScaledVector(intoWall, -1); start.y = .12 + (level + .5) * info.floorHeight;
        const wall = new THREE.Raycaster(start, intoWall, 0, 4.01).intersectObject(meshes[index])[0];
        assert.ok(!wall || wall.distance >= 4 - 1e-4, 'No wall remains within the three-metre corridor on any courtyard side');
        const inside = middle.clone().addScaledVector(intoWall, 1.5); inside.y = start.y;
        const down = new THREE.Raycaster(inside, new THREE.Vector3(0, -1, 0), 0, info.floorHeight).intersectObject(meshes[index])[0];
        const up = new THREE.Raycaster(inside, new THREE.Vector3(0, 1, 0), 0, info.floorHeight).intersectObject(meshes[index])[0];
        // A first-floor road stays open where it crosses a courtyard corridor.
        if (level > 0 || down) assert.ok(down && up, 'Corridors keep both floor and ceiling around both atriums');
      }
    }
  }
  dispose();
});

test('the marked return corner is open on every floor and joins the main and secondary corridors', () => {
  const { info, meshes, dispose } = model(), wing = info.sections[1];
  // Follow the centre of the marked L-shaped return, including its inner turn.
  const route = [[94, 62.08], [89.19, 62.85], [85.74, 63.43], [86.05, 65.4], [86.78, 69.89]];
  for (let floor = 0; floor < wing.floors; floor++) {
    // Cross the shared part seam throughout the full three-metre corridor width.
    for (const depth of [.1, .75, 1.5, 2.25, 2.9]) {
      const start = position(.99, depth, .12 + (floor + .5) * info.floorHeight);
      assert.equal(new THREE.Raycaster(start, along, 0, 2).intersectObjects(meshes, false).length, 0, 'No thin end wall remains at the main/secondary part boundary');
    }
    for (let i = 0; i < route.length - 1; i++) {
      const [from, to] = [route[i], route[i + 1]], direction = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]);
      const length = direction.length(); direction.normalize();
      const ray = new THREE.Raycaster(new THREE.Vector3(from[0], .12 + (floor + .5) * info.floorHeight, from[1]), direction, 0, length);
      assert.equal(ray.intersectObjects(meshes, false).length, 0, 'No end wall or corner plug interrupts the route between either side');
    }
    const point = new THREE.Vector3(85.74, .12 + (floor + .5) * info.floorHeight, 63.43);
    for (const y of [-1, 1]) assert.ok(new THREE.Raycaster(point, new THREE.Vector3(0, y, 0), 0, info.floorHeight).intersectObject(meshes[1]).length, 'The corner retains its floor and ceiling');
  }
  dispose();
});

test('the recessed passage beside the rounded wing opens across every floor into the small atrium', () => {
  const { info, meshes, dispose } = model(), wing = info.sections[1];
  const route = [[61.3, 66.5], [63.05, 67.17], [67.6, 66.4], [68.25, 70.55], [73.5, 69.65]];
  for (let floor = 0; floor < wing.floors; floor++) {
    for (let i = 0; i < route.length - 1; i++) {
      const [from, to] = [route[i], route[i + 1]], direction = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]);
      const length = direction.length(); direction.normalize();
      const start = new THREE.Vector3(from[0], .12 + (floor + .5) * info.floorHeight, from[1]);
      assert.equal(new THREE.Raycaster(start, direction, 0, length).intersectObjects(meshes, false).length, 0, 'Both turns and the former back wall are open into the courtyard corridor');
    }
    if (floor > 0) {
      const point = new THREE.Vector3(67.6, .12 + (floor + .5) * info.floorHeight, 66.4);
      for (const y of [-1, 1]) assert.ok(new THREE.Raycaster(point, new THREE.Vector3(0, y, 0), 0, info.floorHeight).intersectObject(meshes[1]).length, 'Only floors and ceilings remain in the opened return');
    }
  }
  dispose();
});

test('the rounded-wing connector is open while the marked main-wing classrooms stay solid', () => {
  const { info, meshes, dispose } = model();
  for (const passage of building.groundPassages) {
    const [from, to] = passage.points, direction = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]);
    const length = direction.length(); direction.normalize();
    for (let level = 1; level < Math.max(...info.sections.map(section => section.floors)); level++) {
      for (const offset of [-1.4, 0, 1.4]) {
        const start = new THREE.Vector3(from[0] + direction.z * offset, .12 + (level + .5) * info.floorHeight, from[1] - direction.x * offset).addScaledVector(direction, -2);
        const hits = new THREE.Raycaster(start, direction, 0, length + 4).intersectObjects(meshes, false);
        if (passage.sourcePathId === 'way/1233313444') assert.equal(hits.length, 0, 'The rounded-wing passage connects to its courtyard on every floor');
        else if (level < info.sections[0].floors) assert.ok(hits.length, 'Opaque classroom walls remain above the ground-only road');
      }
    }
  }
  dispose();
});

test('the facade notch under the blue atrium has continuous floor and ceiling infills on every level', () => {
  const patch = building.floorCorridors.find(corridor => corridor.slabInfill).slabInfill.outer;
  for (const floor of [undefined, 1, 3]) {
    const { info, meshes, dispose } = model(undefined, floor), levels = floor || info.sections[0].floors;
    for (const u of [.1, .5, .9]) for (const v of [.1, .5, .9]) for (let level = 0; level < levels; level++) {
      const x = patch[0][0] + (patch[1][0] - patch[0][0]) * u + (patch[3][0] - patch[0][0]) * v;
      const z = patch[0][1] + (patch[1][1] - patch[0][1]) * u + (patch[3][1] - patch[0][1]) * v;
      const point = new THREE.Vector3(x, .12 + (level + .5) * info.floorHeight, z);
      for (const direction of [-1, 1]) {
        const hit = new THREE.Raycaster(point, new THREE.Vector3(0, direction, 0), 0, info.floorHeight).intersectObject(meshes[0])[0];
        assert.ok(hit, 'Every part of the former notch retains a floor and ceiling, including floor cutaways');
        assert.equal(meshes[0].geometry.userData.photoOcclusionMask[hit.faceIndex], 0, 'The infilled slab does not hide corridor photos');
      }
      assert.equal(new THREE.Raycaster(point, new THREE.Vector3(patch[1][0] - patch[0][0], 0, patch[1][1] - patch[0][1]).normalize(), 0, .5).intersectObject(meshes[0]).length, 0, 'No wall is added across the patched corridor');
    }
    dispose();
  }
});

test('oblique views show corridor photos through their slabs, while classroom walls and roofs still occlude', () => {
  const { info, meshes, dispose } = model(), scene = new THREE.Scene(), group = new THREE.Group();
  group.userData.photoOccluder = true; meshes.forEach(mesh => group.add(mesh)); scene.add(group);
  const occluders = photoOccluders(scene), size = { width: 1280, height: 800 };
  const camera = new THREE.PerspectiveCamera(43, 1.6, .08, 2000);
  for (let level = 0; level < 5; level++) {
    const photo = position(.3, 1.5, .12 + level * info.floorHeight + 1.6), anchor = photo.clone().add(new THREE.Vector3(0, PHOTO_MARKER_LIFT, 0));
    camera.position.copy(position(.3, -12, 34)); camera.lookAt(anchor); camera.updateMatrixWorld();
    assert.ok(photoPointVisible(photo, camera, size, occluders), 'A photo on every outer corridor floor is visible from diagonally above');
    const mask = meshes[0].geometry.userData.photoOcclusionMask; delete meshes[0].geometry.userData.photoOcclusionMask;
    assert.equal(photoPointVisible(photo, camera, size, occluders), false, 'The visibility ray really crosses a slab, rather than avoiding the building');
    meshes[0].geometry.userData.photoOcclusionMask = mask;
  }
  for (const [index, section] of info.sections.entries()) {
    const ring = section.holes[0], center = ring.slice(0, -1).reduce((sum, p) => sum.add(new THREE.Vector3(p[0], 0, p[1])), new THREE.Vector3()).divideScalar(ring.length - 1);
    for (let edge = 0; edge < ring.length - 1; edge++) {
      const middle = new THREE.Vector3((ring[edge][0] + ring[edge + 1][0]) / 2, 0, (ring[edge][1] + ring[edge + 1][1]) / 2), direction = middle.clone().sub(center).normalize();
      const photo = middle.clone().addScaledVector(direction, 1.5); photo.y = .12 + info.floorHeight * 2 + 1.6;
      camera.position.copy(center); camera.position.y = 42; camera.lookAt(photo.clone().add(new THREE.Vector3(0, PHOTO_MARKER_LIFT, 0))); camera.updateMatrixWorld();
      assert.ok(photoPointVisible(photo, camera, size, [meshes[index]]), 'Courtyard corridor photos show through the upper slabs on every side');
    }
  }
  const classroom = position(.3, 7, 1.6); camera.position.copy(position(.3, -12, 34)); camera.lookAt(classroom.clone().add(new THREE.Vector3(0, PHOTO_MARKER_LIFT, 0))); camera.updateMatrixWorld();
  assert.equal(photoPointVisible(classroom, camera, size, occluders), false, 'Opaque classroom roofs and walls continue to hide photos behind them');
  for (const mesh of meshes) assert.equal(mesh.geometry.userData.photoOcclusionMask.length, mesh.geometry.getAttribute('position').count / 3, 'Every face has a matching visibility flag');
  dispose();
});

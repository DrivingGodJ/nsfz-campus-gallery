import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { solidCoreWindowLayout } from '../src/teaching-classrooms.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { CLASSROOM_BAYS, classroomAt, teachingClassroomFurniture, teachingClassroomInterior } from '../src/teaching-classroom-furniture.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(item => item.id === 'way/855459420');
const info = buildingLevels(building, site.buildingOverrides[building.id]);
const main = info.sections.find(section => section.id === 'main');
const room = building.solidCores.find(core => core.partId === main.id && Math.abs(core.outer[0][0] - 89.47396089486412) < 1e-6 && Math.abs(core.outer[0][1] - 52.82109838093125) < 1e-6);
const BASE = .12;
function mesh(geometry) {
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  object.updateMatrixWorld(); return object;
}
function bodies(cutawayHeight) {
  return info.sections.map(section => {
    const geometry = buildingGeometry(section, Math.min(section.height, cutawayHeight ?? Infinity), info.floorHeight,
      building.groundPassages, building.floorCorridors.filter(item => item.partId === section.id),
      building.stairwells.filter(item => item.partId === section.id), building.classroomWindows,
      building.solidCores.filter(item => item.partId === section.id), building.cutouts.filter(item => item.partId === section.id),
      cutawayHeight !== undefined);
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, BASE, 0); return mesh(geometry);
  });
}
const dispose = objects => objects.forEach(object => { object.geometry.dispose(); object.material.dispose(); });
function insideRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
const insideArea = (x, z, area) => area.some(([outer, ...holes]) => insideRing(x, z, outer) && !holes.some(hole => insideRing(x, z, hole)));
function crossing(from, to, height, fraction = .5) {
  const a = new THREE.Vector3(from[0], height, from[1]), b = new THREE.Vector3(to[0], height, to[1]);
  const along = b.clone().sub(a).normalize(), normal = new THREE.Vector3(-along.z, 0, along.x);
  return new THREE.Raycaster(a.lerp(b, fraction).addScaledVector(normal, -.45), normal, 0, .9);
}

test('the southwest upper room opens into the expanded joining classroom while the first-floor road stays open beneath it', () => {
  assert.ok(room, 'The southwest classroom is selected independently of the northwest glazed room');
  assert.equal(room.startFloor, 2);
  assert.deepEqual(room.outer, [
    [89.47396089486412, 52.82109838093125], [100.96166897858963, 50.99788471690141],
    [102.30248107746476, 59.1987892872771], [90.89710903849797, 61.06346443489119],
    [89.47396089486412, 52.82109838093125],
  ], 'The whole marked room has four sides without the former projecting north notch');
  assert.deepEqual(room.openEdges, [3], 'The shared end opens toward the newly moved classroom partition');
  assert.equal(room.door, undefined, 'The unsupported new doorway is removed');
  const upperConfig={...building.classroomWindows};delete upperConfig.groundBlindFacadeLines;
  assert.deepEqual(room.classroomWindows, upperConfig, 'The upper room retains its ordinary calibration without the separate first-floor exception');
  const original = JSON.stringify(building), meshes = bodies();
  const windows = solidCoreWindowLayout([room], main.height, info.floorHeight);
  const glazing = teachingWindowGeometry(building, info.sections, info.floorHeight);
  const glass = mesh(glazing.glass), frames = mesh(glazing.frames);
  const center = room.outer.slice(0, -1).reduce((sum, point) => sum.add(new THREE.Vector3(point[0], 0, point[1])), new THREE.Vector3()).divideScalar(room.outer.length - 1);
  try {
    for (let edge = 0; edge < room.outer.length - 1; edge++) {
      const ground = crossing(room.outer[edge], room.outer[edge + 1], BASE + 1.6);
      assert.equal(ground.intersectObjects(meshes).length, 0, `The former room wall is absent on floor one, edge ${edge}`);
      assert.equal(ground.intersectObjects([glass, frames]).length, 0, `No upper-room glazing descends into floor one or its road, edge ${edge}`);
    }
    assert.ok(windows.length === 8 && windows.every(window => window.bottom >= info.floorHeight));
    for (let floor = 2; floor <= main.floors; floor++) {
      for (let edge = 0; edge < room.outer.length - 1; edge++) for (const fraction of [.15, .5, .85]) {
        const ray = crossing(room.outer[edge], room.outer[edge + 1], BASE + (floor - 1) * info.floorHeight + .65, fraction);
        if(edge===3) assert.equal(ray.intersectObjects(meshes).length,0,`Floor ${floor} clears the former shared wall`);
        else assert.ok(ray.intersectObjects(meshes).length, `Floor ${floor} has real sill masonry along room edge ${edge}, t=${fraction}`);
      }
      const floorWindows = windows.filter(window => window.bottom > (floor - 1) * info.floorHeight && window.top < floor * info.floorHeight);
      assert.equal(floorWindows.length, 2, `Floor ${floor} retains its north and south windows; the atrium-facing west-side wall is opaque`);
      for (const window of floorWindows) {
        const ray = crossing(window.from, window.to, BASE + (window.bottom + window.top) / 2);
        assert.equal(ray.intersectObjects(meshes).length, 0, `Floor ${floor} glazing has an actual wall aperture`);
        assert.ok(ray.intersectObject(glass).length, `Floor ${floor} retains its ordinary panes`);
        ray.ray.origin.y = BASE + (floor - 1) * info.floorHeight + .6;
        assert.ok(ray.intersectObjects(meshes).length, `Floor ${floor} retains the sill wall rather than a new door opening`);
      }
      const inside = center.clone(); inside.y = BASE + (floor - 1) * info.floorHeight + 1.6;
      const floorHit = new THREE.Raycaster(inside, new THREE.Vector3(0, -1, 0), 0, info.floorHeight).intersectObjects(meshes)[0];
      assert.ok(floorHit && Math.abs(floorHit.point.y - (BASE + (floor - 1) * info.floorHeight + .25)) < 1e-4, `Floor ${floor} retains its actual slab`);
      const cut = bodies(floor * info.floorHeight);
      try {
        assert.equal(new THREE.Raycaster(inside, new THREE.Vector3(0, 1, 0), 0, info.floorHeight).intersectObjects(cut).length, 0, `The selected floor ${floor} has no residual ceiling`);
      } finally { dispose(cut); }
    }
    assert.equal(JSON.stringify(building), original, 'Geometry generation preserves the saved campus data');
  } finally { dispose(meshes); dispose([glass, frames]); }
});

test('the removed north projection has no residual masonry, glazing or frames above or below the room', () => {
  const removed = [
    [[99.92485154138201, 51.162437968502516], [99.60415634131584, 49.158687134536734]],
    [[99.60415634131584, 49.158687134536734], [100.63406591920378, 48.9941427837548]],
    [[100.63406591920378, 48.9941427837548], room.outer[1]],
  ];
  const meshes = bodies(), glazing = teachingWindowGeometry(building, info.sections, info.floorHeight);
  const glass = mesh(glazing.glass), frames = mesh(glazing.frames);
  try {
    for (let floor = 1; floor <= main.floors; floor++) for (const [edge, [a, b]] of removed.entries()) {
      for (const fraction of [.15, .5, .85]) for (const rise of [.65, 1.6, 3]) {
        const ray = crossing(a, b, BASE + (floor - 1) * info.floorHeight + rise, fraction);
        assert.equal(ray.intersectObjects([...meshes, glass, frames]).length, 0,
          `The old north projection is clear on floor ${floor}, edge ${edge}, t=${fraction}, height ${rise}`);
      }
      const platform = new THREE.Vector3((a[0] + b[0]) / 2, BASE + (floor - 1) * info.floorHeight + .9, (a[1] + b[1]) / 2);
      const along = new THREE.Vector3(b[0] - a[0], 0, b[1] - a[1]).normalize();
      platform.addScaledVector(new THREE.Vector3(-along.z, 0, along.x), .12);
      const hit = new THREE.Raycaster(platform, new THREE.Vector3(0, -1, 0), 0, 1).intersectObjects(meshes)[0];
      assert.ok(hit && Math.abs(hit.point.y - (BASE + (floor - 1) * info.floorHeight + .25)) < 1e-4,
        `Removing the old projection walls keeps the corridor floor ${floor}, edge ${edge}`);
    }
  } finally { dispose(meshes); dispose([glass, frames]); }
});

test('the restored classroom keeps photo-approved third-floor desks without adding furniture to its open first floor', () => {
  assert.ok(room);
  const bay = CLASSROOM_BAYS.find(item => item.id === 'main-west-3');
  const [x, z] = classroomAt(bay.u - 1.55, bay.v);
  assert.equal(insideArea(x, z, teachingClassroomInterior(building, main, 1)), false, 'The open ground-level corner is not treated as classroom interior');
  for (let floor = 2; floor <= main.floors; floor++) assert.ok(insideArea(x, z, teachingClassroomInterior(building, main, floor)), `The existing upper classroom interior remains on floor ${floor}`);
  assert.deepEqual(CLASSROOM_BAYS.map(bay => bay.id), ['main-west-3', 'wing-east-3', 'main-north-5', 'main-east-1'], 'Only the four photo-approved bays receive furniture');
  for (const bay of CLASSROOM_BAYS) for (const id of bay.photoIds) {
    const photo = site.photos.find(item => item.id === id);
    assert.equal(photo.buildingId, building.id); assert.equal(photo.floor, bay.floor);
  }
  const model = teachingClassroomFurniture(building, info.sections, info.floorHeight), wood = mesh(model.wood);
  let roomVertices = 0;
  try {
    for (const geometry of Object.values(model)) {
      const positions = geometry.getAttribute('position');
      for (let i = 0; i < positions.count; i++) {
        if (!insideRing(positions.getX(i), positions.getZ(i), room.outer)) continue;
        const floor = Math.floor((positions.getY(i) - BASE - .001) / info.floorHeight) + 1;
        assert.equal(floor, 3, 'The restored corner receives only its photo-confirmed third-floor furniture'); roomVertices++;
      }
    }
    assert.ok(roomVertices > 100, 'Restoring the room preserves the photographed third-floor desk set');
    const hit = new THREE.Raycaster(new THREE.Vector3(x, BASE + 3 * info.floorHeight, z), new THREE.Vector3(0, -1, 0), 0, info.floorHeight).intersectObject(wood)[0];
    assert.ok(hit && Math.abs(hit.point.y - (BASE + 2 * info.floorHeight + .25 + .8)) < 1e-4, 'The photographed desk still rests on the third-floor slab');
  } finally { wood.material.dispose(); Object.values(model).forEach(geometry => geometry.dispose()); }
});

test('removing the millimetre classroom strip clears walls on every floor and keeps the adjacent platform', () => {
  const a = new THREE.Vector3(92.6521153219028, 0, 47.24082643573102), b = new THREE.Vector3(100.15185268649975, 0, 46.04474763189444);
  const along = b.clone().sub(a).normalize(), outward = new THREE.Vector3(-along.z, 0, along.x), meshes = bodies();
  try {
    // These eastern samples avoid the genuine northwest glazed-room wall.
    for (const fraction of [.8, .9]) for (let floor = 1; floor <= main.floors; floor++) {
      const point = a.clone().lerp(b, fraction), origin = point.clone().addScaledVector(outward, .0002);
      origin.y = BASE + (floor - 1) * info.floorHeight + 1.6;
      assert.equal(new THREE.Raycaster(origin, outward, 0, .02).intersectObjects(meshes).length, 0, `No millimetre wall remains at strip t=${fraction}, floor ${floor}`);
      const platform = point.clone().addScaledVector(outward, -.04); platform.y = BASE + (floor - 1) * info.floorHeight + .9;
      const hit = new THREE.Raycaster(platform, new THREE.Vector3(0, -1, 0), 0, 1).intersectObjects(meshes)[0];
      assert.ok(hit && Math.abs(hit.point.y - (BASE + (floor - 1) * info.floorHeight + .25)) < 1e-4, `The platform remains at strip t=${fraction}, floor ${floor}`);
    }
  } finally { dispose(meshes); }
});

test('the unchanged upper northwest room retains its opaque wall above the expanded two-storey room', () => {
  const west = building.solidCores.find(core => core.partId === main.id && core.startFloor === 4 && Math.abs(core.outer[0][0] - 91.74712393299268) < 1e-6);
  assert.ok(west && west.startFloor === 4 && west.classroomWindows);
  const oldD = [96.49903916402369, 46.62730840918588], oldE = [92.6521153219028, 47.24082643573102];
  const [newD, newE] = west.outer.slice(3, 5);
  const [holeA, holeB] = main.holes[0].slice(2, 4), length = Math.hypot(holeB[0] - holeA[0], holeB[1] - holeA[1]);
  const south = [-(holeB[1] - holeA[1]) / length, (holeB[0] - holeA[0]) / length];
  for (const point of [newD, newE]) assert.ok(Math.abs((point[0] - holeA[0]) * south[0] + (point[1] - holeA[1]) * south[1] + 3) < 1e-6, 'The room end aligns with the upper green boundary three metres north of the atrium');
  assert.equal(west.classroomWindows.wallThickness, .18, 'The aligned small-room partition keeps the unchanged camera in clear interior space');
  const meshes = bodies(), glazing = teachingWindowGeometry(building, info.sections, info.floorHeight);
  const glass = mesh(glazing.glass), frames = mesh(glazing.frames);
  try {
    for (let floor = 1; floor <= main.floors; floor++) {
      for (const rise of [.65, 1.6, 3]) {
        const height = BASE + (floor - 1) * info.floorHeight + rise;
        const newWall = crossing(newD, newE, height);
        if (floor <= 3) assert.equal(newWall.intersectObjects(meshes).length, 0, 'The former upper-room end wall leaves the expanded lower room and ground approach open');
        else assert.ok(newWall.intersectObjects(meshes).length, `The moved opaque wall remains on floor ${floor}, height ${rise}`);
        assert.equal(newWall.intersectObjects([glass, frames]).length, 0, 'The newly positioned end wall is masonry rather than a glass bay');
        assert.equal(crossing(oldD, oldE, height).intersectObjects([...meshes, glass, frames]).length, 0, `The former end wall is cleared at floor ${floor}, height ${rise}`);
      }
      const platform = new THREE.Vector3((oldD[0] + oldE[0]) / 2, BASE + (floor - 1) * info.floorHeight + .9, (oldD[1] + oldE[1]) / 2);
      const along = new THREE.Vector3(oldE[0] - oldD[0], 0, oldE[1] - oldD[1]).normalize();
      platform.addScaledVector(new THREE.Vector3(-along.z, 0, along.x), .3);
      const hit = new THREE.Raycaster(platform, new THREE.Vector3(0, -1, 0), 0, 1).intersectObjects(meshes)[0];
      assert.ok(hit && Math.abs(hit.point.y - (BASE + (floor - 1) * info.floorHeight + .25)) < 1e-4, `The opened old wall bay retains its floor ${floor} platform`);
    }
    const photo = site.photos.find(item => item.id === '2c68e815-aff6-44fe-a8cc-64f1ceb35f31');
    assert.equal(photo.title, '_DSC9506');
    assert.deepEqual({ position: photo.position, floor: photo.floor, heading: photo.heading, pitch: photo.pitch, view: photo.view }, {
      position: { x: 93.75706267023104, z: 43.19019874116275 }, floor: 5,
      heading: 357.3084881743325, pitch: -1.2261535784644266, view: { focalLength35Mm: 50 },
    }, 'The reference camera calibration remains unchanged');
    assert.equal(photo.cameraHeight, undefined, 'The original default camera height remains in use');
    assert.ok(insideRing(photo.position.x, photo.position.z, west.outer), 'DSC9506 stays inside the remaining upper room');
    const point = new THREE.Vector3(photo.position.x, BASE + (photo.floor - 1) * info.floorHeight + 1.6, photo.position.z);
    const wallDirection = new THREE.Vector3(south[0], 0, south[1]);
    assert.equal(new THREE.Raycaster(point, wallDirection, 0, .02).intersectObjects(meshes).length, 0, 'The unchanged camera remains outside the actual thin wall rather than inside its masonry');
    assert.ok(new THREE.Raycaster(point, wallDirection, 0, .08).intersectObjects(meshes).length, 'The aligned room-end wall remains just beyond the camera clearance');
    const cut = bodies(photo.floor * info.floorHeight);
    try {
      assert.equal(new THREE.Raycaster(point, new THREE.Vector3(0, 1, 0), 0, info.floorHeight).intersectObjects(cut).length, 0, 'Selecting the photographed room floor removes its ceiling');
    } finally { dispose(cut); }
  } finally { dispose(meshes); dispose([glass, frames]); }
});

test('opening a windowed core edge removes its panes before their inset while retaining the other walls and floor slabs', () => {
  const section = { id: 'main', name: 'test room', floors: 3, height: 3 * info.floorHeight, outer: [[0, 0], [14, 0], [14, 8], [0, 8], [0, 0]], holes: [] };
  const closed = { ...section, partId: section.id, startFloor: 2, classroomWindows: building.classroomWindows };
  const open = { ...closed, openEdges: [0] };
  const objects = [];
  const make = core => {
    const geometry = buildingGeometry(section, section.height, info.floorHeight, [], [], [], building.classroomWindows, [core]);
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, BASE, 0);
    const walls = mesh(geometry), glazing = teachingWindowGeometry({ ...section, id: 'test', classroomWindows: building.classroomWindows, solidCores: [core] }, [section], info.floorHeight);
    const glass = mesh(glazing.glass), frames = mesh(glazing.frames); objects.push(walls, glass, frames);
    return { walls, glass, frames };
  };
  const before = make(closed), after = make(open);
  try {
    for (const floor of [2, 3]) {
      const y = BASE + (floor - 1) * info.floorHeight;
      const pane = new THREE.Raycaster(new THREE.Vector3(3.5, y + 1.6, -.4), new THREE.Vector3(0, 0, 1), 0, .8);
      assert.ok(pane.intersectObject(before.glass).length, 'The fixture edge originally has calibrated inset glazing');
      assert.equal(pane.intersectObjects(Object.values(after)).length, 0, 'Opening the original edge removes concrete, glass and frames together');
      pane.ray.origin.y = y + .6;
      assert.ok(pane.intersectObject(before.walls).length, 'The original edge has masonry below its window');
      assert.equal(pane.intersectObject(after.walls).length, 0, 'Opening the whole edge removes its sill as well');
      const adjacent = new THREE.Raycaster(new THREE.Vector3(-.4, y + .6, 4), new THREE.Vector3(1, 0, 0), 0, .8);
      assert.ok(adjacent.intersectObject(before.walls).length && adjacent.intersectObject(after.walls).length, 'The adjacent wall remains intact');
      const down = new THREE.Raycaster(new THREE.Vector3(3.5, y + .8, .12), new THREE.Vector3(0, -1, 0), 0, .8);
      const hit = down.intersectObject(after.walls)[0];
      assert.ok(hit && Math.abs(hit.point.y - (y + .25)) < 1e-4, 'The newly exposed edge still has its floor slab');
    }
  } finally { dispose(objects); }
});

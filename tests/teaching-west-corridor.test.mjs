import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingRailGeometry, teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { stairwellFrame, teachingStairGeometry } from '../src/teaching-stairs.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(item => item.id === 'way/855459420');
const info = buildingLevels(building, site.buildingOverrides[building.id]);
const main = info.sections.find(section => section.id === 'main');
const corridor = building.floorCorridors.find(item => item.partId === main.id && item.points?.length === 4 && Math.abs(item.points.at(-1)[0] - 92.5180706509) < 1e-6);
const stair = building.stairwells.find(item => item.partId === main.id && !item.internal);
const west = building.solidCores.find(item => item.partId === main.id && Math.abs(item.outer[0][0] - 91.74712393299268) < 1e-6);
const BASE = .12, material = () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
function mesh(geometry) { const object = new THREE.Mesh(geometry, material()); object.updateMatrixWorld(); return object; }
function body(cutawayHeight) {
  const geometry = buildingGeometry(main, Math.min(main.height, cutawayHeight ?? Infinity), info.floorHeight,
    building.groundPassages, building.floorCorridors.filter(item => item.partId === main.id),
    building.stairwells.filter(item => item.partId === main.id), building.classroomWindows,
    building.solidCores.filter(item => item.partId === main.id), building.cutouts.filter(item => item.partId === main.id), cutawayHeight !== undefined);
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, BASE, 0); return mesh(geometry);
}
const dispose = objects => objects.forEach(object => { object.geometry.dispose(); object.material.dispose(); });
function segment(from, to) {
  const a = new THREE.Vector3(from[0], 0, from[1]), b = new THREE.Vector3(to[0], 0, to[1]);
  const direction = b.clone().sub(a).normalize();
  return { a, b, direction, normal: new THREE.Vector3(-direction.z, 0, direction.x) };
}
const slabTop = floor => BASE + (floor - 1) * info.floorHeight + .25;
function slabAt(object, point, floor, label) {
  const origin = point.clone(); origin.y = slabTop(floor) + .65;
  const hit = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, .9).intersectObject(object)[0];
  assert.ok(hit && Math.abs(hit.point.y - slabTop(floor)) < 1e-4, label);
}

test('the west corridor is saved consistently with its slab extension and preserves the approved building', () => {
  assert.ok(corridor?.footprint && corridor.slabInfill && corridor.railEdges);
  assert.equal(corridor.depth, 3);
  const saved = corrections.buildings.find(item => item.id === building.id);
  assert.deepEqual(saved.floorCorridors, building.floorCorridors, 'Source corrections and generated campus retain the same corridor');
  assert.deepEqual(corridor.slabInfill, corridor.footprint, 'The calibrated extension receives a floor rather than only removing walls');
  assert.equal(corridor.railEdges.length, 1);
  const original = JSON.stringify(building), object = body();
  object.geometry.dispose(); object.material.dispose();
  assert.equal(JSON.stringify(building), original, 'Building geometry leaves saved walls, corridors, floors and stairs intact');
});

test('all upper floors have a continuous walk with floor support and clear passage 1.3 metres either side of the route', () => {
  assert.ok(corridor);
  const object = body(), points = corridor.points;
  try {
    for (let floor = 2; floor <= main.floors; floor++) {
      for (let i = 0; i < points.length - 1; i++) {
        const { a, b, direction, normal } = segment(points[i], points[i + 1]);
        const steps = Math.ceil(a.distanceTo(b) / .6);
        for (let sample = 0; sample <= steps; sample++) {
          const point = a.clone().lerp(b, sample / steps);
          slabAt(object, point, floor, `Floor ${floor} is continuous along route segment ${i}, sample ${sample}`);
          if (sample === 0 || sample === steps) continue;
          const ahead = point.clone(); ahead.y = slabTop(floor) + 1.3;
          assert.equal(new THREE.Raycaster(ahead, direction, 0, .25).intersectObject(object).length, 0, 'A short forward step meets no wall plug');
        }
        for (const fraction of [.2, .5, .8]) {
          const center = a.clone().lerp(b, fraction);
          for (const side of [-1.3, 1.3]) slabAt(object, center.clone().addScaledVector(normal, side), floor, `Floor ${floor} supports both sides of the three-metre route, segment ${i}, side ${side}`);
          const origin = center.clone().addScaledVector(normal, -1.3); origin.y = slabTop(floor) + 1.3;
          assert.equal(new THREE.Raycaster(origin, normal, 0, 2.6).intersectObject(object).length, 0, `Floor ${floor} has no masonry across the usable corridor width, segment ${i}`);
        }
      }
      const { at } = stairwellFrame(stair), shaft = at(stair.landingDepth + stair.run / 2, 0);
      const origin = new THREE.Vector3(shaft[0], slabTop(floor) + .65, shaft[1]);
      assert.equal(new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, .9).intersectObject(object).length, 0, `Floor ${floor} extension does not fill the actual flight shaft`);
    }
  } finally { dispose([object]); }
});

test('the south edge and lake end have upper-floor guards while the stairs remain open from their landing', () => {
  const rails = mesh(teachingRailGeometry(building, info.sections, info.floorHeight));
  const stairs = teachingStairGeometry(building, info.sections, info.floorHeight), stairRails = mesh(stairs.rails);
  const { at, along } = stairwellFrame(stair);
  try {
    const edge = corridor.railEdges[0];
    for (let i = 0; i < edge.length - 1; i++) {
      const { a, b, normal } = segment(edge[i], edge[i + 1]);
      const center = a.clone().lerp(b, .5).addScaledVector(normal, .09);
      for (let floor = 1; floor <= main.floors; floor++) {
        for (const rise of [.5, 1.05]) {
          const origin = center.clone().addScaledVector(normal, -.3); origin.y = slabTop(floor) + rise;
          const hits = new THREE.Raycaster(origin, normal, 0, .6).intersectObject(rails);
          if (floor === 1) assert.equal(hits.length, 0, 'No new upper-floor guard appears at ground level');
          else assert.ok(hits.length, `Floor ${floor} has a guard along edge ${i}, rise ${rise}`);
        }
      }
    }
    for (let floor = 2; floor <= main.floors; floor++) for (const side of [-1, 0, 1]) {
      const point = at(.2, side), origin = new THREE.Vector3(point[0], slabTop(floor) + .75, point[1]);
      assert.equal(new THREE.Raycaster(origin, new THREE.Vector3(along[0], 0, along[1]), 0, 1.35).intersectObjects([rails, stairRails]).length, 0, `Floor ${floor} keeps the front landing open towards the independent stair flights`);
    }
  } finally { dispose([rails, stairRails]); stairs.concrete.dispose(); }
});

test('the new route keeps the approved northwest room wall and exposes its selected storey without a ceiling', () => {
  const object = body(), glazing = teachingWindowGeometry(building, info.sections, info.floorHeight), glass = mesh(glazing.glass);
  const { a, b, normal } = segment(west.outer[3], west.outer[4]);
  try {
    for (let floor = 1; floor <= main.floors; floor++) {
      const origin = a.clone().lerp(b, .5).addScaledVector(normal, -.4); origin.y = slabTop(floor) + 1.3;
      const ray = new THREE.Raycaster(origin, normal, 0, .8);
      if (floor === 1) assert.equal(ray.intersectObject(object).length, 0, 'The first floor remains open beneath the preserved upper room');
      else assert.ok(ray.intersectObject(object).length, `The real opaque northwest end wall stays on floor ${floor}`);
      assert.equal(ray.intersectObject(glass).length, 0, 'The approved opaque wall does not become a new window');
      if (floor === 1) continue;
      const selected = body(floor * info.floorHeight);
      try {
        const point = segment(corridor.points[2], corridor.points[3]).a.lerp(new THREE.Vector3(corridor.points[3][0], 0, corridor.points[3][1]), .5);
        slabAt(selected, point, floor, `Selecting floor ${floor} retains the new lake-end floor`);
        point.y = slabTop(floor) + 1.3;
        assert.equal(new THREE.Raycaster(point, new THREE.Vector3(0, 1, 0), 0, info.floorHeight).intersectObject(selected).length, 0, `Selecting floor ${floor} removes the extension ceiling`);
      } finally { dispose([selected]); }
    }
  } finally { dispose([object, glass]); glazing.frames.dispose(); }
});

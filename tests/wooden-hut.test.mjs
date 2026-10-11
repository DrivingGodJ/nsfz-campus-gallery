import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { woodenHutFootprint, woodenHutGeometry } from '../src/wooden-hut-geometry.ts';
import { cafeteriaLowerProfile } from '../src/facade-geometry.ts';
import { roadFootprint } from '../src/road-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const feature = campus.features.find(f => f.id === 'local/cafeteria-wooden-hut'), model = feature.woodenHut;

test('the photo-positioned cabin and its overhanging roof occupy dry grass clear of the road and cafeteria', async () => {
  assert.equal(feature.estimated, true); assert.equal(feature.hideLabel, true);
  const roof = woodenHutFootprint(model, true);
  const obstacles = [...campus.features.filter(f => f.type === 'water' && f.outer),
    ...campus.features.filter(f => f.type === 'path' && f.points).map(roadFootprint),
    ...campus.buildings.map(b => b.facade?.type === 'cafeteria' ? cafeteriaLowerProfile(b).shape : b)];
  for (const obstacle of obstacles) assert.deepEqual(clip.intersection([roof.outer], [obstacle.outer, ...obstacle.holes]), []);
  const correction = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  assert.deepEqual(applyCampusCorrections(campus, correction), campus, 'Regeneration retains the cabin and new dorm entry');
  const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url))), photo = site.photos.find(p => p.title === 'DSC07783');
  assert.ok(Math.hypot(photo.position.x - model.center[0], photo.position.z - model.center[1]) < 3);
});

test('timber shell has real side-door and window openings beneath a white-edged pitched roof', () => {
  const geometry = woodenHutGeometry(model), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  try {
    const wood = new THREE.Mesh(geometry.wood, material); wood.updateMatrixWorld();
    for (const x of [-1.27, .67]) assert.equal(new THREE.Raycaster(new THREE.Vector3(x, 1.4, model.depth / 2 + .4), new THREE.Vector3(0, 0, -1), 0, .7).intersectObject(wood).length, 0);
    assert.equal(new THREE.Raycaster(new THREE.Vector3(-model.width / 2 - .4, 1.4, .3), new THREE.Vector3(1, 0, 0), 0, .7).intersectObject(wood).length, 0);
    assert.ok(new THREE.Raycaster(new THREE.Vector3(1.4, .5, model.depth / 2 + .4), new THREE.Vector3(0, 0, -1), 0, .7).intersectObject(wood).length, 'Solid siding surrounds the glass');
    assert.ok(geometry.roof.boundingBox.max.y > model.wallHeight + model.roofRise + .14);
    for (const part of Object.values(geometry)) assert.ok(part.attributes.position.count > 0 && Array.from(part.attributes.position.array).every(Number.isFinite));
  } finally { Object.values(geometry).forEach(g => g.dispose()); material.dispose(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { dormitoryBodyGeometry, FACADE_BASE } from '../src/facade-geometry.ts';
import { dormitoryEntranceLayout, dormitoryEntranceGeometry } from '../src/dormitory-entrance-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const dorm = campus.buildings.find(b => b.id === 'way/1233313434'), layout = dormitoryEntranceLayout(dorm);
const info = buildingLevels(dorm, site.buildingOverrides[dorm.id]);

test('the only photographed modern dorm entrance has a wide hollow glass doorway on its long wing', () => {
  assert.equal(campus.buildings.filter(b => b.facade?.lobbyEntry).length, 1);
  assert.equal(layout.edge, 1); assert.equal(dorm.facade.entry.edge, 4, 'The old arch and observatory remain at their original entrance');
  const photo = site.photos.find(p => p.title === 'DSC07782');
  assert.ok(Math.hypot(photo.position.x - layout.center[0], photo.position.z - layout.center[1]) < 3);
  const body = dormitoryBodyGeometry(dorm, info.height, info.floorHeight);
  const sliced = dormitoryBodyGeometry(dorm, info.floorHeight, info.floorHeight, true);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  try {
    for (const geometry of [body, sliced]) {
      const mesh = new THREE.Mesh(geometry, material); mesh.rotation.x = -Math.PI / 2; mesh.position.y = FACADE_BASE; mesh.updateMatrixWorld();
      const hits = (u, y) => {
        const p = layout.at(u, -.55);
        return new THREE.Raycaster(new THREE.Vector3(p[0], FACADE_BASE + y, p[1]), new THREE.Vector3(layout.inward[0], 0, layout.inward[1]), 0, 1.1).intersectObject(mesh).length;
      };
      for (const u of [-3, -.6, .6, 3]) assert.equal(hits(u, 1.4), 0, 'No masonry blocks the broad glass door');
      assert.ok(hits(layout.width / 2 + .2, 1.4)); assert.ok(hits(0, layout.height + .18), 'The lintel remains solid');
    }
  } finally { body.dispose(); sliced.dispose(); material.dispose(); }
});

test('six face-reader lanes and their side gate fit indoors and respect floor cutaways', () => {
  assert.equal(layout.pedestals.filter(p => p.reader).length, 6);
  assert.ok(layout.accessible.to - layout.accessible.from >= 1.1);
  for (const p of layout.pedestals) {
    const ring = [layout.at(p.u - .12, p.v - .83), layout.at(p.u + .12, p.v - .83), layout.at(p.u + .12, p.v + .83), layout.at(p.u - .12, p.v + .83)]; ring.push(ring[0]);
    assert.deepEqual(clip.difference([ring], [dorm.outer, ...dorm.holes]), []);
  }
  const original = JSON.stringify(dorm), full = dormitoryEntranceGeometry(dorm), low = dormitoryEntranceGeometry(dorm, 1);
  try {
    for (const g of Object.values(full)) assert.ok(g.attributes.position.count > 0 && Array.from(g.attributes.position.array).every(Number.isFinite));
    assert.ok(full.glass.userData.photoOcclusionMask.every(value => value === 0), 'Transparent entry and flaps do not hide photo markers');
    assert.equal(low.screens.attributes.position.count, 0, 'Reader screens above the cutaway disappear');
    for (const g of Object.values(low)) { g.computeBoundingBox(); if (g.attributes.position.count) assert.ok(g.boundingBox.max.y <= 1.0001); }
    assert.equal(JSON.stringify(dorm), original);
  } finally { [...Object.values(full), ...Object.values(low)].forEach(g => g.dispose()); }
});

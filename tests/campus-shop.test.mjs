import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { campusShopGeometry, campusShopLayout } from '../src/campus-shop-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const shop = { ...campus.buildings.find(b => b.id === 'way/1277841229'), facade: { type: 'campus-shop', entry: { edge: 2, at: .5 } } };
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const dispose = model => Object.values(model).forEach(geometry => geometry.dispose());

function hit(geometry, layout, x, y, fromZ, toZ) {
  const from = new THREE.Vector3(x, y, fromZ).applyMatrix4(layout.transform), to = new THREE.Vector3(x, y, toZ).applyMatrix4(layout.transform);
  return new THREE.Raycaster(from, to.clone().sub(from).normalize(), 0, from.distanceTo(to)).intersectObject(new THREE.Mesh(geometry, material));
}

test('the shop replaces the box face with a small projected glazed entrance, retaining solid unobserved elevations', () => {
  const original = JSON.stringify(shop), layout = campusShopLayout(shop, 3.6), model = campusShopGeometry(shop, 3.6);
  try {
    assert.ok(Math.abs(layout.length - 15.006) < .02 && Math.abs(layout.depth - 7.272) < .02);
    assert.ok(layout.entryWidth / layout.length < .32 && layout.projection < 1.1, 'The entry is a shallow small bay, not a new full-width wing');
    for (const x of [-1.1, .4, 1.1]) {
      assert.ok(hit(model.glass, layout, x, 1.5, 2, .5).length, 'The entrance has real glazing');
      assert.equal(hit(model.walls, layout, x, 1.5, 2, -.5).length, 0, 'No old opaque box face remains behind the glass');
    }
    for (const x of [-5, 3.3, 6.8]) assert.ok(hit(model.walls, layout, x, 1.5, 1, -.5).length, 'The unobserved wall stays opaque');
    assert.ok(hit(model.glass, layout, 5.1, 1.98, .5, -.15).length, 'Only the photographed southern high slot is added');
    assert.equal(hit(model.walls, layout, 5.1, 1.98, .5, -.15).length, 0, 'The high slot is a real opening');
    assert.ok(hit(model.walls, layout, 0, 1.5, -layout.depth - .5, -layout.depth + .5).length, 'The rear wall is solid');
    assert.equal(JSON.stringify(shop), original, 'Geometry does not change calibrated footprint or data');
  } finally { dispose(model); }
});

test('the cream front triangle and blue cross-gable keep the photographed single-storey scale and disappear in a cutaway', () => {
  for (const height of [3.2, 3.6]) {
    const layout = campusShopLayout(shop, height), model = campusShopGeometry(shop, height), cut = campusShopGeometry(shop, height, true);
    try {
      assert.ok(hit(model.fascia, layout, 0, layout.eave + .55, 1.5, .8).length, 'The triangular front is opaque, not glass');
      model.roof.computeBoundingBox();
      assert.ok(model.roof.boundingBox.max.y < height + .65, 'The gable remains a modest roof above a single storey');
      assert.ok(model.roof.boundingBox.min.y > height - 1, 'No exaggerated low roof wing is introduced');
      for (const kind of ['roof', 'soffit', 'fascia']) assert.equal(cut[kind].getAttribute('position').count, 0, 'The selected-floor view removes roof and eaves');
      assert.ok(cut.glass.getAttribute('position').count && cut.walls.getAttribute('position').count, 'The facade survives the roof cut');
      for (const geometry of Object.values(model)) {
        const positions = geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) assert.ok(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i)));
      }
    } finally { dispose(model); dispose(cut); }
  }
});

test.after(() => material.dispose());

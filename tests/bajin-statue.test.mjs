import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { bajinStatueGeometry } from '../src/bajin-statue-geometry.ts';

test('the modest bust fits its three step footprint and scales without non-finite geometry or excess faces', () => {
  for (const totalHeight of [2.7, 3.15]) {
    const width = 3.6, depth = 3.2, geometry = bajinStatueGeometry({ center: [0, 0], axis: [1, 0], width, depth, totalHeight });
    try {
      const bounds = new THREE.Box3();
      let triangles = 0;
      for (const part of Object.values(geometry)) {
        const position = part.getAttribute('position');
        assert.ok([...position.array].every(Number.isFinite));
        assert.ok([...part.getAttribute('normal').array].every(Number.isFinite));
        triangles += (part.index ? part.index.count : position.count) / 3;
        bounds.union(part.boundingBox);
      }
      const size = bounds.getSize(new THREE.Vector3());
      assert.ok(Math.abs(size.x - width) < 1e-6 && Math.abs(size.z - depth) < 1e-6, 'All parts fit the lowest stair footprint');
      assert.ok(Math.abs(bounds.min.y) < 1e-6 && Math.abs(bounds.max.y - totalHeight) < 1e-6, 'The head reaches exactly the calibrated height');
      assert.ok(geometry.bust.boundingBox.getSize(new THREE.Vector3()).y < totalHeight * .29, 'The bust and its small sloping mount remain small above the tall stone base');
      assert.ok(triangles < 2000, 'The whole statue renders in three modest merged meshes');
    } finally { Object.values(geometry).forEach(part => part.dispose()); }
  }
});

test('the photographed statue stays inside the courtyard, clears the pergola and does not add a selectable location', async () => {
  const fs = await import('node:fs/promises');
  const {default: clip} = await import('polygon-clipping');
  const {applyCampusCorrections} = await import('../server/campus-corrections.mjs');
  const {campusLocations} = await import('../src/locations.ts');
  const {gardenFootprints} = await import('../src/garden-geometry.ts');
  const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
  const campus = await read('public/data/campus.json'), site = await read('public/data/site.json');
  const feature = campus.features.find(f => f.id === 'local/bajin-statue'), pergola = campus.features.find(f => f.id === 'local/wisteria-pergola');
  const shape = f => [f.outer, ...(f.holes || [])], overlap = f => clip.intersection(shape(feature), shape(f));
  assert.ok(feature.statue.totalHeight >= 2.7 && feature.statue.totalHeight <= 3.2, 'Low-angle perspective must not enlarge the sculpture');
  assert.ok(feature.height + feature.statue.totalHeight < pergola.height + pergola.pergola.floorHeight, 'Its head is lower than the photographed pergola roof');
  assert.equal(feature.height, .02, 'The three low stairs sit on the courtyard surface');
  for (const other of [...campus.buildings, ...campus.features.filter(f => f.type === 'water'), ...gardenFootprints(pergola, campus.features)]) {
    assert.equal(overlap(other).length, 0, 'The broad low platform leaves the existing buildings, water and curved walking route clear');
  }
  assert.equal(clip.difference(shape(feature), [campus.boundary]).length, 0);
  assert.ok(!campusLocations(campus, site).some(location => location.id === feature.id));
  assert.deepEqual(applyCampusCorrections(campus, await read('data/campus-corrections.json')), campus, 'The sculpture survives map regeneration');
});

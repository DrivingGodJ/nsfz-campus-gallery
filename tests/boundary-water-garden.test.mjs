import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import { boundaryWaterGardenGeometry } from '../src/boundary-water-garden.ts';
import { groundSurfaces } from '../src/ground-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

test('boundary pond stays inside the campus, cuts the ground and keeps its photographed waterfall and plants in bounded batches', async () => {
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  const pond = campus.features.find(f => f.id === 'local/boundary-water-garden');
  const previous = { ...campus, features: campus.features.filter(f => f.id !== pond.id) };
  assert.deepEqual(applyCampusCorrections(previous, corrections).features.find(f => f.id === pond.id), pond);
  assert.deepEqual(polygonClipping.difference([pond.outer], [campus.boundary]), [], 'The pool sits inside the unchanged campus border');
  for (const building of campus.buildings) assert.deepEqual(polygonClipping.intersection([pond.outer], [building.outer]), [], 'The pool does not intersect ' + building.id);
  const ground = groundSurfaces(campus);
  assert.equal(ground.features.get(pond.id).length, 1);
  for (const land of ground.campus) assert.deepEqual(polygonClipping.intersection([land.outer, ...land.holes], [pond.outer]), [], 'The pool has no duplicate grass beneath the water');
  const model = boundaryWaterGardenGeometry(pond);
  let triangles = 0;
  try {
    for (const [kind, geometry] of Object.entries(model)) {
      const positions = geometry.getAttribute('position');
      assert.ok(positions.count, kind + ' is present');
      triangles += positions.count / 3;
      for (let i = 0; i < positions.count; i++) assert.ok(Number.isFinite(positions.getX(i) + positions.getY(i) + positions.getZ(i)));
      assert.ok(geometry.userData.photoOcclusionMask.every(v => v === 0), 'Small garden details do not add artificial photo occlusion layers');
    }
    assert.ok(triangles < 16000, 'Pool, rocks, waterfall and bamboo use a bounded static model');
    model.fall.computeBoundingBox();
    assert.ok(model.fall.boundingBox.max.y >= pond.waterfall.height, 'The white water starts at the calibrated rock crest');
    assert.ok(model.fall.boundingBox.min.y < .2, 'The cascade reaches the basin');
    model.water.computeBoundingBox();
    assert.equal(model.water.boundingBox.min.y, model.water.boundingBox.max.y, 'A single flat pool surface fits the ground cutout');
  } finally { Object.values(model).forEach(g => g.dispose()); }
});

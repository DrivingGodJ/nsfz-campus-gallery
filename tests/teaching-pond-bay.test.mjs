import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import clip from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { groundSurfaces } from '../src/ground-geometry.ts';
import { riverWaterFootprints, riverBankSamples } from '../src/river-landscape.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const polygon = shape => [shape.outer, ...(shape.holes ?? [])];
const square = ([x,z]) => [[[x-.02,z-.02],[x+.02,z-.02],[x+.02,z+.02],[x-.02,z+.02],[x-.02,z-.02]]];
const waterAt = (shape, point) => clip.intersection(polygon(shape), square(point)).length > 0;

test('the western teaching pond bay fills the marked shoreline without covering retained trees or bridgeheads', () => {
  const lake = campus.features.find(f => f.id === 'way/1277839749');
  const regenerated = applyCampusCorrections({ ...campus, features: campus.features.filter(f => f.id !== lake.id) }, corrections);
  assert.deepEqual(regenerated.features.find(f => f.id === lake.id), lake, 'A map refresh keeps the authored pond rather than reverting to OSM');
  assert.equal(riverWaterFootprints(campus.features).length, 1, 'The western bay remains joined to the river and eastern pond');
  const ground = groundSurfaces(campus), visible = ground.features.get(lake.id).map(polygon);
  for (const point of [[74.4,37.5],[76,33],[70.9,39.3],[70.9,42],[67,41],[63.5,44]]) {
    assert.ok(waterAt(lake, point), 'The missing bay contains water at ' + point);
    assert.ok(clip.intersection(visible, square(point)).length, 'The bay is actually drawn rather than clipped away by grass or paths');
    for (const layer of [...ground.campus, ...ground.background]) assert.equal(clip.intersection(polygon(layer), square(point)).length, 0, 'No competing land face remains below the added water');
  }
  const bankTrees = campus.features.find(f => f.id === 'local/river-bank-trees').trees;
  assert.equal(bankTrees.some(tree => tree.position[0] === 70.9 && tree.position[1] === 39.3), false, 'The explicitly crossed-out tree is removed rather than kept on an artificial peninsula');
  for (const feature of campus.features.filter(f => f.trees)) for (const tree of feature.trees) assert.equal(waterAt(lake, tree.position), false, 'The completed bay leaves every retained tree on dry land');
  assert.equal(lake.holes.length, 0, 'The completed western bay contains no invented planting island');
  const shore = riverBankSamples(campus.features);
  assert.ok(shore.some(sample => sample.position[0] > 73 && sample.position[0] < 77 && sample.position[1] > 36), 'Shore stones follow the new bay rather than the old straight edge');
  const bridge = campus.features.find(f => f.id === 'local/lake-bridge');
  for (const end of bridge.points) assert.equal(waterAt(lake, end), false, 'Both existing bridgeheads still reach dry land');
});

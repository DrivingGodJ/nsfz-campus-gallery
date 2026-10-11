import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import clip from 'polygon-clipping';
import { avenueGardenLayout, avenueGardenGeometry } from '../src/avenue-garden.ts';
import { roadFootprint } from '../src/road-geometry.ts';
import { passageFootprint } from '../src/underground-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const polygon = shape => [shape.outer, ...(shape.holes ?? [])];
const feature = id => campus.features.find(item => item.id === id);
const overlap = (a, b) => clip.intersection(polygon(a), polygon(b)).length > 0;
const square = ([x, z], r) => ({ outer: [[x - r, z - r], [x + r, z - r], [x + r, z + r], [x - r, z + r], [x - r, z - r]], holes: [] });

test('avenue lights cover both sides of the entire road and leave junctions clear', () => {
  const { lamps, rails } = avenueGardenLayout(campus.features, campus.buildings);
  const avenue = feature('way/1233313449'), [a, b] = avenue.points;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]), dx = (b[0] - a[0]) / length, dz = (b[1] - a[1]) / length;
  const sides = [-1, 1].map(side => lamps.filter(p => Math.sign((p[1] - a[1]) * dx - (p[0] - a[0]) * dz) === side));
  for (const row of sides) {
    assert.ok(row.length >= 13);
    const positions = row.map(p => (p[0] - a[0]) * dx + (p[1] - a[1]) * dz);
    assert.ok(Math.min(...positions) <= 8 && Math.max(...positions) >= length - 8, 'Both rows extend beyond the cropped photo');
  }
  const roads = campus.features.filter(f => f.type === 'path' && f.points).map(roadFootprint);
  const obstacles = [...campus.buildings, ...campus.features.filter(f => ['water', 'pergola'].includes(f.type) && f.outer), feature('local/library-parallel-bars')];
  for (const p of lamps) {
    assert.ok(![...roads, ...obstacles].some(shape => overlap(square(p, .19), shape)), 'No light occupies a road or another structure');
    assert.ok(!campus.features.flatMap(f => f.trees ?? []).some(tree => Math.hypot(tree.position[0] - p[0], tree.position[1] - p[1]) < .75));
  }
  assert.ok(rails.length >= 2, 'Both stone sides retain openings at intersecting paths');
  for (const rail of rails) {
    const footprint = passageFootprint(rail, .33);
    assert.ok(![...roads, ...obstacles].some(shape => overlap(footprint, shape)), 'Stone caps leave the road and adjacent structures clear');
  }
  const geometry = avenueGardenGeometry(campus.features, campus.buildings);
  try {
    for (const part of Object.values(geometry)) assert.ok(Array.from(part.getAttribute('position').array).every(Number.isFinite));
    geometry.metal.computeBoundingBox();
    assert.ok(Math.abs(geometry.metal.boundingBox.max.y - .645) < 1e-5, 'The avenue uses the existing half-metre grove lamp');
  } finally { Object.values(geometry).forEach(part => part.dispose()); }
});

test('red garden branch connects both roads without crossing trunks or buildings', () => {
  const branch = feature('local/avenue-garden-branch'), footprint = roadFootprint(branch);
  for (const id of ['way/1233313449', 'way/1233313445']) assert.ok(overlap(footprint, roadFootprint(feature(id))));
  for (const obstacle of [...campus.buildings, ...campus.features.filter(f => ['pergola', 'water'].includes(f.type) && f.outer)])
    assert.ok(!overlap(footprint, obstacle));
  for (const tree of campus.features.flatMap(f => f.trees ?? [])) assert.ok(!overlap(footprint, square(tree.position, .4)));
});

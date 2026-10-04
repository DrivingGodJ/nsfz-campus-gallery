import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import clip from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { bridgeLayout } from '../src/bridge-geometry.ts';
import { bridgeHeight } from '../src/structure-geometry.ts';
import { groundSurfaces } from '../src/ground-geometry.ts';
import { photoMapHeight, assignPhotoLocation, campusLocations } from '../src/locations.ts';

const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
const campus = await read('public/data/campus.json'), site = await read('public/data/site.json');
const bridge = campus.features.find(feature => feature.id === 'local/lake-bridge');
const polygon = shape => [shape.outer, ...(shape.holes || [])];
const area = polygons => polygons.reduce((sum, [outer, ...holes]) => {
  const ringArea = ring => Math.abs(ring.slice(1).reduce((n, p, i) => n + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
  return sum + ringArea(outer) - holes.reduce((n, ring) => n + ringArea(ring), 0);
}, 0);

test('lake bridge replaces the marked road, stays level at both banks and leaves its two ends open', async () => {
  assert.ok(bridge);
  const source = campus.features.find(feature => feature.id === 'way/1277839757');
  assert.equal(source.representedBy, bridge.id);
  assert.deepEqual(bridge.points, source.points);
  assert.equal(bridge.width, source.width);
  assert.deepEqual(bridge.sourcePathIds, [source.id]);
  const corrections = await read('data/campus-corrections.json');
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus, 'The bridge survives map regeneration without duplication');
  const approach = campus.features.find(feature => feature.id === 'way/1233313440');
  const departure = campus.features.find(feature => feature.id === 'way/1277839756');
  assert.deepEqual(approach.points.at(-1), bridge.points[0]);
  assert.deepEqual(departure.points[0], bridge.points.at(-1));
  assert.equal(approach.width, bridge.width); assert.equal(departure.width, bridge.width);
  const height = bridgeHeight(bridge, campus.buildings, site.buildingOverrides);
  assert.ok(Math.abs(height - (.095 + .04 / 2)) < 1e-9, 'Deck meets the existing road surface');
  const layout = bridgeLayout(bridge, height);
  assert.equal(layout.stairs.length, 0);
  assert.equal(layout.deck.length, 1);
  assert.equal(layout.railChains.length, 2);
  const [start, end] = bridge.points;
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
  assert.ok(Math.abs(area(layout.deck.map(polygon)) - length * bridge.width) < 1e-7);
  for (const chain of layout.railChains) {
    assert.ok(chain.every(point => point[1] === height), 'Both side rails stay level across the whole bridge');
    const along = point => ((point[0] - start[0]) * (end[0] - start[0]) + (point[2] - start[1]) * (end[1] - start[1])) / length;
    assert.ok(Math.abs(Math.abs(along(chain.at(-1)) - along(chain[0])) - length) < 1e-7, 'Each rail runs between the banks and never crosses an entrance');
  }
});

test('the lake remains visible beside the bridge without a competing face below it, and the bridge is a photo location', () => {
  const height = bridgeHeight(bridge, campus.buildings, site.buildingOverrides), layout = bridgeLayout(bridge, height);
  const water = campus.features.find(feature => feature.id === 'way/1277839749');
  const waterAt = point => area(clip.intersection(polygon(water), [[[point[0] - .001, point[1] - .001], [point[0] + .001, point[1] - .001], [point[0] + .001, point[1] + .001], [point[0] - .001, point[1] + .001], [point[0] - .001, point[1] - .001]]])) > 1e-7;
  const midpoint = bridge.points[0].map((n, i) => (n + bridge.points[1][i]) / 2);
  assert.ok(waterAt(midpoint), 'The relocated flat bridge crosses the revised waterway');
  assert.ok(bridge.points.every(point => !waterAt(point)), 'Both bridge ends reach beyond the revised banks');
  assert.ok(area(clip.intersection(polygon(water), layout.deck.map(polygon))) > 30, 'Bridge spans the circled lake rather than land elsewhere');
  const visible = groundSurfaces(campus).features.get(water.id).map(polygon);
  assert.ok(area(clip.intersection(visible, layout.deck.map(polygon))) < 1e-7, 'Near-level lake and deck faces cannot compete');
  assert.ok(area(visible) > area([polygon(water)]) * .9, 'Water outside the crossing is retained');
  const location = campusLocations(campus, site).find(item => item.id === bridge.id);
  assert.equal(location.name, '湖桥'); assert.equal(location.surfaceHeight, height);
  const photo = { buildingId: '', floor: 0, position: { x: 86, z: 32, height: 1.6 }, heading: 40 };
  const assigned = assignPhotoLocation(photo, bridge.id, campus, site);
  assert.equal(assigned.locationId, bridge.id); assert.equal(assigned.buildingId, '');
  assert.equal(photoMapHeight(assigned, campus, site), height + 1.6);
  assert.equal(assigned.position.x, photo.position.x); assert.equal(assigned.position.z, photo.position.z);
});

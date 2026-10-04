import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import clip from 'polygon-clipping';
import * as THREE from 'three';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { passageFootprint } from '../src/underground-geometry.ts';
import { bridgeHeight, bridgeSurfaceHeight } from '../src/structure-geometry.ts';
import { bridgeLayout, bridgeRailPosts } from '../src/bridge-geometry.ts';
import { archedBridgeGeometry } from '../src/bridge-mesh.ts';
import { groundSurfaces } from '../src/ground-geometry.ts';
import { photoMapHeight, assignPhotoLocation, campusLocations } from '../src/locations.ts';

const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
const campus = await read('public/data/campus.json'), site = await read('public/data/site.json');
const find = id => campus.features.find(feature => feature.id === id);
const bridge = find('local/arched-lake-bridge'), channel = find('local/lake-water-link');
const polygon = shape => [shape.outer, ...(shape.holes || [])];
const area = polygons => polygons.reduce((sum, [outer, ...holes]) => {
  const ringArea = ring => Math.abs(ring.slice(1).reduce((n, p, i) => n + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
  return sum + ringArea(outer) - holes.reduce((n, ring) => n + ringArea(ring), 0);
}, 0);

test('the new waterway joins both marked ponds and the original route continues across the arch bridge', async () => {
  const ponds = channel.connectedTo.map(find);
  for (const pond of ponds) assert.ok(area(clip.intersection(polygon(channel), polygon(pond))) > 1, 'Channel reaches into each pond instead of stopping at its bank');
  assert.equal(clip.union(...ponds.map(polygon), polygon(channel)).length, 1, 'The two ponds and channel form one connected water body');
  for (const building of campus.buildings) assert.ok(area(clip.intersection(polygon(channel), polygon(building))) < 1e-7, 'Waterway stays clear of buildings');
  assert.deepEqual(applyCampusCorrections(campus, await read('data/campus-corrections.json')), campus);
  const previous = find('way/1277839759'), source = find('way/1233313450'), approach = find('local/arched-bridge-approach'), departure = find('local/arched-bridge-departure');
  assert.equal(previous.representedBy, bridge.id);
  assert.equal(source.representedBy, bridge.id);
  assert.deepEqual(bridge.sourcePathIds, [previous.id, source.id]);
  assert.deepEqual(approach.points, [previous.points[0], bridge.points[0]]);
  assert.deepEqual(departure.points, [bridge.points[1], ...source.points.slice(1)]);
  assert.equal(bridge.width, source.width);
  const routeParts = [approach.points, bridge.points, departure.points].map(points => polygon(passageFootprint(points, source.width)));
  const complete = clip.union(...routeParts), original = polygon(passageFootprint([...previous.points, ...source.points.slice(1)], source.width));
  // The original adjacent OSM segments have a slight kink; the straight span
  // crosses that junction with less than 0.01 square metre of outline deviation.
  assert.ok(area(clip.difference(original, complete)) < .01);
  assert.ok(area(clip.difference(complete, original)) < .01, 'Bridge and approaches retain both source road segments');
  assert.ok(bridge.points[0][1] < previous.points[1][1] && bridge.points[1][1] > previous.points[1][1], 'The relocated arch straddles the earlier road junction at the marked crossing');
  const layout = groundSurfaces(campus), visible = layout.features.get(channel.id).map(polygon);
  const footprint = bridgeLayout(bridge, bridge.deckHeight).footprint.map(polygon);
  assert.ok(area(clip.intersection(visible, footprint)) > 5, 'Water remains visible below the raised crossing');
});

test('the actual arch slab and rails rise smoothly, join the road at both ends and clear the water below', () => {
  const height = bridgeHeight(bridge, campus.buildings, site.buildingOverrides), [start, end] = bridge.points;
  const midpoint = start.map((n, i) => (n + end[i]) / 2);
  assert.ok(bridge.archRise > 1);
  assert.equal(bridgeSurfaceHeight(bridge, height, start), .115);
  assert.equal(bridgeSurfaceHeight(bridge, height, end), .115);
  assert.equal(bridgeSurfaceHeight(bridge, height, midpoint), .115 + bridge.archRise);
  const layout = bridgeLayout(bridge, height);
  assert.equal(layout.stairs.length, 0); assert.equal(layout.railChains.length, 2);
  for (const chain of layout.railChains) {
    assert.equal(chain.length, 33);
    for (const [x, y, z] of chain) assert.ok(Math.abs(y - bridgeSurfaceHeight(bridge, height, [x, z])) < 1e-8);
    const posts = bridgeRailPosts([chain], 3, true);
    assert.ok(posts.length < 7, 'Curved railing does not put a post at every tessellation point');
  }
  const geometry = archedBridgeGeometry(bridge, height), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld();
  try {
    for (const i of [0, 4, 8, 12, 16, 20, 24, 28, 32]) {
      // Sample just inside the end caps to avoid Float32 boundary rounding.
      const t = Math.max(1e-5, Math.min(1 - 1e-5, i / 32)), point = start.map((n, j) => n + (end[j] - n) * t);
      const hits = new THREE.Raycaster(new THREE.Vector3(point[0], 5, point[1]), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
      assert.ok(hits.length);
      assert.ok(Math.abs(hits[0].point.y - bridgeSurfaceHeight(bridge, height, point)) < 1e-4, 'Rendered slab follows the raised deck instead of remaining flat');
    }
    const below = new THREE.Raycaster(new THREE.Vector3(midpoint[0] - 3, .1, midpoint[1]), new THREE.Vector3(1, 0, 0), 0, 6).intersectObject(mesh);
    assert.equal(below.length, 0, 'The arch is an open span rather than a solid block through the water');
  } finally { geometry.dispose(); material.dispose(); }
  assert.ok(campusLocations(campus, site).some(location => location.id === bridge.id && location.name === '拱桥'));
  const photo = assignPhotoLocation({ position: { x: midpoint[0], z: midpoint[1], height: 1.6 }, buildingId: '', floor: 0 }, bridge.id, campus, site);
  assert.equal(photoMapHeight(photo, campus, site), height + bridge.archRise + 1.6, 'Photos on the bridge use the deck height at the shooting position');
  assert.equal(find('local/lake-bridge').archRise, undefined, 'The earlier flat bridge remains flat');
});

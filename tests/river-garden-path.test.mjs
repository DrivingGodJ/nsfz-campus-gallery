import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { riverLandscapeGeometry, riverGardenPaths, RIVER_GARDEN_PATH_ID, RIVER_COLORS } from '../src/river-landscape.ts';
import { passageFootprint } from '../src/underground-geometry.ts';
import { pointOnStairTread } from '../src/structure-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const read = path => JSON.parse(fs.readFileSync(new URL('../' + path, import.meta.url)));
const campus = read('public/data/campus.json'), path = campus.features.find(f => f.id === RIVER_GARDEN_PATH_ID);
const shape = data => [data.outer, ...(data.holes ?? [])];
const routes = [path.points, ...(path.branches ?? [])], polygons = routes.map(route => shape(passageFootprint(route, path.width)));
const nearest = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz))); return [a[0] + dx * t, a[1] + dz * t]; };
const distance = p => Math.min(...routes.flatMap(route => route.slice(1).map((b, i) => Math.hypot(...nearest(p, route[i], b).map((n, j) => n - p[j])))));

test('the marked yellow route joins the two original roads and stays completely outside lake water and buildings', () => {
  assert.equal(path.width, 1.2); assert.equal(path.representedBy, 'river-landscape'); assert.equal(RIVER_COLORS.paths, '#b3a58c');
  for (const data of [...campus.buildings, ...campus.features.filter(f => f.type === 'water')]) assert.deepEqual(clip.intersection(polygons, shape(data)), []);
  for (const [point, id] of [[path.points[0], 'way/1233313449'], [path.points.at(-1), 'way/855459416']]) {
    const road = campus.features.find(f => f.id === id);
    assert.ok(Math.min(...road.points.slice(1).map((b, i) => Math.hypot(...nearest(point, road.points[i], b).map((n, j) => n - point[j])))) < 1e-6, 'Both ends meet actual road centre-lines');
  }
  assert.ok(clip.intersection(polygons, shape(passageFootprint(riverGardenPaths[1], 1.2))).length, 'The second unchanged yellow branch stays connected');
  assert.deepEqual(applyCampusCorrections(campus, read('data/campus-corrections.json')), campus);
});

test('only the three identified obstructing trees are removed, and remaining crown envelopes clear the new path', () => {
  const removed = [{id:'local/lake-bridge-avenue-trees',position:[78.24747209502239,6.114536889193943],count:6},
    {id:'local/history-theatre-avenue-trees',position:[42.160104301408666,51.30285252129614],count:23},
    {id:'local/river-bank-trees',position:[66.4,18.5],count:12}];
  for (const tree of removed) {
    const group = campus.features.find(f => f.id === tree.id);
    assert.equal(group.trees.length, tree.count);
    assert.ok(!group.trees.some(t => Math.hypot(...t.position.map((n,i) => n - tree.position[i])) < 1e-7));
  }
  for (const feature of campus.features) for (const tree of feature.trees ?? []) assert.ok(distance(tree.position) >= tree.radius + path.width / 2, `${feature.id} crown overlaps the marked route`);
});

test('the actual yellow mesh follows the new route, removes the old segment, and preserves the other two paths and all bank details', () => {
  const before = JSON.stringify(campus), model = riverLandscapeGeometry(campus.features, campus.buildings);
  const legacy = riverLandscapeGeometry(campus.features.filter(f => f.id !== RIVER_GARDEN_PATH_ID), campus.buildings);
  // Suppress the first route inside a real building to obtain the unchanged
  // second and third routes as rendered meshes, rather than hand-made copies.
  const reference = riverLandscapeGeometry(campus.features.map(f => f.id === RIVER_GARDEN_PATH_ID ? {...f,points:[[140,50],[140.1,50]],branches:[]} : f), campus.buildings);
  const material = new THREE.MeshBasicMaterial({side:THREE.DoubleSide}), mesh = new THREE.Mesh(model.paths, material); mesh.updateMatrixWorld();
  const hits = p => new THREE.Raycaster(new THREE.Vector3(p[0],1,p[1]),new THREE.Vector3(0,-1,0),0,2).intersectObject(mesh);
  const otherRoads = campus.features.filter(f => ['path','bridge'].includes(f.type) && f.points && f.id !== RIVER_GARDEN_PATH_ID).map(f => passageFootprint(f.points,f.width??2));
  try {
    for (const p of path.points.filter((_,i) => i%4===0)) if (!otherRoads.some(road => pointOnStairTread(p,road.outer))) assert.ok(hits(p).length, 'Real paint follows every sampled new centre-line');
    for (const p of [[57.7,30.3],[61.2,24.6]]) assert.equal(hits(p).length,0,'Old unmarked route no longer has a yellow floor');
    const remaining = reference.paths.attributes.position.array;
    assert.deepEqual([...model.paths.attributes.position.array.slice(-remaining.length)],[...remaining], 'The other two yellow paths keep their actual original triangles');
    for (const kind of Object.keys(RIVER_COLORS).filter(k => k !== 'paths')) assert.deepEqual([...model[kind].attributes.position.array],[...legacy[kind].attributes.position.array], `Existing ${kind} geometry stays unchanged`);
    assert.equal(JSON.stringify(campus),before);
  } finally { [model,legacy,reference].forEach(parts => Object.values(parts).forEach(g=>g.dispose())); material.dispose(); }
});

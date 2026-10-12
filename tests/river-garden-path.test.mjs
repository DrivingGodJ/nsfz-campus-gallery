import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { riverLandscapeGeometry, riverGardenPaths, RIVER_GARDEN_PATH_ID, RIVER_COLORS } from '../src/river-landscape.ts';
import { passageFootprint } from '../src/underground-geometry.ts';
import { roadFootprint } from '../src/road-geometry.ts';
import { pointOnStairTread } from '../src/structure-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const read = path => JSON.parse(fs.readFileSync(new URL('../' + path, import.meta.url)));
const campus = read('public/data/campus.json'), path = campus.features.find(f => f.id === RIVER_GARDEN_PATH_ID);
const shape = data => [data.outer, ...(data.holes ?? [])];
const routes = [path.points, ...(path.branches ?? [])], polygons = [shape(roadFootprint(path))];
const nearest = (p, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz))); return [a[0] + dx * t, a[1] + dz * t]; };
const distance = p => Math.min(...routes.flatMap(route => route.slice(1).map((b, i) => Math.hypot(...nearest(p, route[i], b).map((n, j) => n - p[j])))));

test('the marked yellow route joins the two original roads and stays completely outside lake water and buildings', () => {
  assert.equal(path.width, 1.2); assert.equal(path.representedBy, 'river-landscape'); assert.equal(RIVER_COLORS.paths, '#b3a58c');
  for (const data of [...campus.buildings, ...campus.features.filter(f => f.type === 'water')]) assert.deepEqual(clip.intersection(polygons, shape(data)), []);
  for (const [point, id] of [[path.points[0], 'way/1233313449'], [path.points.at(-1), 'way/855459416']]) {
    const road = campus.features.find(f => f.id === id);
    assert.ok(Math.min(...road.points.slice(1).map((b, i) => Math.hypot(...nearest(point, road.points[i], b).map((n, j) => n - point[j])))) < 1e-6, 'Both ends meet actual road centre-lines');
  }
  assert.equal(path.branches, undefined, 'The marked bridge-side spur and its short connector are removed');
  assert.deepEqual(applyCampusCorrections(campus, read('data/campus-corrections.json')), campus);
});

test('the removed obstructing trees remain absent, and only the intentionally seated tree canopy reaches above its ring path', () => {
  const removed = [{id:'local/lake-bridge-avenue-trees',position:[78.24747209502239,6.114536889193943],count:6},
    {id:'local/history-theatre-avenue-trees',position:[42.160104301408666,51.30285252129614],count:23},
    {id:'local/river-bank-trees',position:[66.4,18.5],count:11}];
  for (const tree of removed) {
    const group = campus.features.find(f => f.id === tree.id);
    assert.equal(group.trees.length, tree.count);
    assert.ok(!group.trees.some(t => Math.hypot(...t.position.map((n,i) => n - tree.position[i])) < 1e-7));
  }
  for (const feature of campus.features) for (const tree of feature.trees ?? []) {
    if (feature.id === 'local/river-bank-trees' && tree.position[0] === 71 && tree.position[1] === 15.35) {
      const r = tree.radius * .13, [x,z] = tree.position;
      const roots = [[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r],[x-r,z-r]];
      assert.deepEqual(clip.intersection(polygons,[roots]),[], 'The intentional tree canopy may shade the ring while its trunk remains inside the unpaved well');
    } else assert.ok(distance(tree.position) >= tree.radius + path.width / 2, `${feature.id} crown overlaps the marked route`);
  }
});

test('the actual yellow mesh removes the bridge-side spur while preserving the new route, office-bank path and bank details', () => {
  const before = JSON.stringify(campus), model = riverLandscapeGeometry(campus.features, campus.buildings);
  const legacy = riverLandscapeGeometry(campus.features.filter(f => f.id !== RIVER_GARDEN_PATH_ID), campus.buildings);
  // Suppress the first route inside a real building to obtain the unchanged
  // office-bank route as a rendered mesh, rather than a hand-made copy.
  const reference = riverLandscapeGeometry(campus.features.map(f => f.id === RIVER_GARDEN_PATH_ID ? {...f,points:[[140,50],[140.1,50]],branches:[],outer:undefined,holes:[]} : f), campus.buildings);
  const material = new THREE.MeshBasicMaterial({side:THREE.DoubleSide}), mesh = new THREE.Mesh(model.paths, material); mesh.updateMatrixWorld();
  const hits = p => new THREE.Raycaster(new THREE.Vector3(p[0],1,p[1]),new THREE.Vector3(0,-1,0),0,2).intersectObject(mesh);
  const otherRoads = campus.features.filter(f => ['path','bridge'].includes(f.type) && f.points && f.id !== RIVER_GARDEN_PATH_ID).map(f => passageFootprint(f.points,f.width??2));
  try {
    for (const p of path.points.filter((p,i) => i%4===0 && Math.hypot(p[0]-71,p[1]-15.35)>1.65)) if (!otherRoads.some(road => pointOnStairTread(p,road.outer))) assert.ok(hits(p).length, 'Real paint follows every sampled new centre-line');
    for (const p of [[57.7,30.3],[61.2,24.6]]) assert.equal(hits(p).length,0,'Old unmarked route no longer has a yellow floor');
    for (const p of [[70.2,14.2],[74.7,14.3],[78,14.37]].filter(p => Math.hypot(p[0]-71,p[1]-15.35)>2.8)) assert.equal(hits(p).length,0,'The newly marked bridge-side spur no longer has a yellow floor');
    const remaining = reference.paths.attributes.position.array;
    assert.deepEqual([...model.paths.attributes.position.array.slice(0,remaining.length)],[...remaining], 'The office-bank path keeps its actual original triangles');
    for (const kind of Object.keys(RIVER_COLORS).filter(k => k !== 'paths')) assert.deepEqual([...model[kind].attributes.position.array],[...legacy[kind].attributes.position.array], `Existing ${kind} geometry stays unchanged`);
    assert.equal(JSON.stringify(campus),before);
  } finally { [model,legacy,reference].forEach(parts => Object.values(parts).forEach(g=>g.dispose())); material.dispose(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { theatreEntranceLayout } from '../src/theatre-exterior-geometry.ts';
import { passageFootprint } from '../src/underground-geometry.ts';
import { treePlanterFootprint, treePlanterGeometry } from '../src/tree-planter-geometry.ts';

test('the photographed trees share a raised oval stone planter with planted soil and clear stair access', () => {
  const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url)));
  const campus = read('../public/data/campus.json'), corrections = read('../data/campus-corrections.json');
  const feature = campus.features.find(f => f.id === 'local/theatre-stair-trees'), model = feature.treePlanter;
  assert.equal(feature.trees.length, 2);
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus);
  const outer = treePlanterFootprint(model), inner = treePlanterFootprint(model, model.rimWidth);
  const stair = theatreEntranceLayout(campus.buildings.find(b => b.id === 'local/theatre'), 3.6);
  for (const shape of [passageFootprint([stair.flightTop, stair.bottom], stair.width), stair.passage, ...campus.buildings]) {
    assert.deepEqual(clip.intersection([outer.outer], [shape.outer, ...(shape.holes ?? [])]), [], 'The planter stays outside the complete stairs, landing and buildings');
  }
  const geometry = treePlanterGeometry(model), meshes = Object.fromEntries(Object.entries(geometry).map(([key, g]) => {
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(); return [key, mesh];
  }));
  try {
    for (const tree of feature.trees) {
      const root = passageFootprint([tree.position, [tree.position[0] + .001, tree.position[1]]], .8);
      assert.deepEqual(clip.difference([root.outer], [inner.outer]), [], 'Both trunks are inside the same planting bed');
      const ray = new THREE.Raycaster(new THREE.Vector3(tree.position[0], 2, tree.position[1]), new THREE.Vector3(0, -1, 0), 0, 2);
      assert.equal(ray.intersectObject(meshes.rim).length, 0, 'Stone is a hollow perimeter rather than a solid block under the trees');
      const hit = ray.intersectObject(meshes.soil)[0];
      assert.ok(hit); assert.ok(Math.abs(hit.point.y - (.12 + model.height - .07)) < 1e-5);
    }
    const p = treePlanterFootprint(model, model.rimWidth / 2).outer[16];
    const hit = new THREE.Raycaster(new THREE.Vector3(p[0], 2, p[1]), new THREE.Vector3(0, -1, 0)).intersectObject(meshes.rim)[0];
    assert.ok(hit); assert.ok(Math.abs(hit.point.y - (.12 + model.height)) < 1e-5);
    assert.ok(geometry.foliage.attributes.position.count > 0, 'The interior includes actual low green plants');
  } finally {
    Object.values(meshes).forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
  }
});

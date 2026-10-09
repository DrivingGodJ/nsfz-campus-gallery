import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { specimenGroveGeometry, specimenPaths, specimenTrees } from '../src/specimen-grove.ts';
import { treeInstances, treeTrunkGeometry } from '../src/tree-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const grove = campus.features.find(feature => feature.id === 'local/specimen-forest');
const photos = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url))).photos.filter(photo => photo.locationId === grove.id);
const inside = point => {
  let hit = false;
  const ring = grove.outer;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i][1] > point[1]) !== (ring[j][1] > point[1]) && point[0] < (ring[j][0] - ring[i][0]) * (point[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
  }
  return hit;
};

test('grove details stay within the confirmed grove and paths clear trunks and photo positions', () => {
  const original = JSON.stringify(grove), trees = specimenTrees(grove), paths = specimenPaths(), geometry = specimenGroveGeometry(grove);
  assert.equal(JSON.stringify(grove), original, 'The measured photo/model data is not mutated');
  assert.equal(trees.length, grove.trees.length);
  for (const tree of trees) {
    assert.ok(inside(tree.position));
    for (const path of paths) for (const p of path) assert.ok(Math.hypot(tree.position[0] - p[0], tree.position[1] - p[1]) > .7, 'No tree trunk blocks the narrow garden paths');
  }
  for (const photo of photos) assert.ok(Math.min(...trees.map(tree => Math.hypot(tree.position[0] - photo.position.x, tree.position[1] - photo.position.z))) > .5, 'A photographed camera position is not blocked by a tree trunk');
  assert.equal(Object.keys(geometry).length, 8, 'Grove furniture uses eight merged material batches');
  for (const [key, part] of Object.entries(geometry)) {
    const p = part.getAttribute('position');
    assert.ok(p.count > 0, key + ' has geometry');
    for (let i = 0; i < p.count; i++) {
      const point = [p.getX(i), p.getZ(i)];
      assert.ok(Number.isFinite(p.getY(i)) && p.getY(i) >= .07, key + ' has finite above-ground geometry');
      // Path ends are clipped on the exact boundary; other objects stay inset.
      if (key !== 'paths' && key !== 'edging') assert.ok(inside(point), key + ' crosses the grove boundary');
    }
  }
  const floor = new THREE.Mesh(geometry.paths, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  floor.updateMatrixWorld();
  for (const path of paths) for (const [x, z] of path.slice(1, -1)) {
    assert.ok(new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0), 0, 2).intersectObject(floor).length, 'The winding path stays continuous through every junction');
  }
  const furniture = ['stone', 'metal', 'fitness', 'lattice', 'lamps'].map(key => new THREE.Mesh(geometry[key], floor.material));
  furniture.forEach(mesh => mesh.updateMatrixWorld());
  for (const tree of trees) for (const y of [.3, .55, 1, 1.45]) for (let direction = 0; direction < 16; direction++) {
    const angle = direction * Math.PI / 8;
    const ray = new THREE.Raycaster(new THREE.Vector3(tree.position[0], y, tree.position[1]), new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle)), 0, Math.max(.2, tree.radius * .13) + .02);
    assert.equal(ray.intersectObjects(furniture).length, 0, 'Tree trunks do not intersect fixed grove furniture');
  }
  floor.material.dispose(); Object.values(geometry).forEach(part => part.dispose());
});

test('batched tree lobes preserve tree radius/height while producing stable branching variation', () => {
  const geometry = treeTrunkGeometry();
  assert.ok(geometry.getAttribute('position').count < 400);
  const crown = new THREE.IcosahedronGeometry(1, 1), colors = [];
  for (const tree of grove.trees) {
    const instances = treeInstances(tree), repeated = treeInstances(tree);
    assert.deepEqual(instances.trunk.elements, repeated.trunk.elements);
    assert.equal(instances.crowns.length, 3);
    colors.push(instances.crowns[0].elements.join(','));
    for (const matrix of instances.crowns) {
      const points = crown.getAttribute('position');
      for (let i = 0; i < points.count; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(points, i).applyMatrix4(matrix);
        assert.ok(Math.hypot(p.x - tree.position[0], p.z - tree.position[1]) <= tree.radius + 1e-6, 'Avenue crown envelopes do not grow into neighbouring trees');
        assert.ok(p.y <= tree.height + .13);
      }
    }
  }
  assert.equal(new Set(colors).size, grove.trees.length);
  geometry.dispose(); crown.dispose();
});

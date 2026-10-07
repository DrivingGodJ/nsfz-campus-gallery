import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { bridgeLayout, bridgeRailPosts } from '../src/bridge-geometry.ts';
import { bridgeRailGeometry } from '../src/bridge-rail-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
test('batched bridge rails stay continuous on sloping and arched paths, with the same post locations', () => {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  for (const feature of campus.features.filter(f => f.type === 'bridge')) {
    const chains = bridgeLayout(feature, 5.5).railChains, smooth = !!feature.archRise;
    const geometry = bridgeRailGeometry(chains, smooth);
    for (const [name, offset] of [['upper', 1], ['lower', .48]]) {
      const mesh = new THREE.Mesh(geometry[name], material), ray = new THREE.Raycaster();
      for (const chain of chains) for (let i = 1; i < chain.length; i++) {
        const from = new THREE.Vector3(...chain[i-1]), to = new THREE.Vector3(...chain[i]);
        if (from.distanceTo(to) < 1e-6) continue;
        const middle = from.clone().add(to).multiplyScalar(.5); middle.y += offset;
        const perpendicular = new THREE.Vector3(-(to.z-from.z), 0, to.x-from.x).normalize();
        if (!perpendicular.length()) continue;
        ray.set(middle.clone().addScaledVector(perpendicular, .3), perpendicular.negate()); ray.far = .6;
        assert.ok(ray.intersectObject(mesh, false).length, `${feature.id}: no gap at a ${name} rail segment`);
      }
    }
    const posts = new THREE.Mesh(geometry.posts, material), ray = new THREE.Raycaster();
    for (const point of bridgeRailPosts(chains, 3, smooth)) {
      ray.set(new THREE.Vector3(point[0] + .3, point[1] + .5, point[2]), new THREE.Vector3(-1, 0, 0)); ray.far = .6;
      assert.ok(ray.intersectObject(posts, false).length, `${feature.id}: post remains at its calibrated height`);
    }
    Object.values(geometry).forEach(g=>g.dispose());
  }
  material.dispose();
});

test('empty and repeated bridge points do not produce invalid vertices', () => {
  for (const chains of [[], [[]], [[[0,0,0],[0,0,0]]]]) {
    const geometry = bridgeRailGeometry(chains);
    for (const g of Object.values(geometry)) {
      assert.ok(Array.from(g.attributes.position.array).every(Number.isFinite)); g.dispose();
    }
  }
});

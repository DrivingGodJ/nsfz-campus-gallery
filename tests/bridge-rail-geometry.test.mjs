import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { bridgeLayout, bridgeRailPosts } from '../src/bridge-geometry.ts';
import { bridgeRailGeometry } from '../src/bridge-rail-geometry.ts';
import { bridgeNetGeometry } from '../src/bridge-net-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
test('the photographed diamond net follows only the field-facing bridge and stair guards and leaves exits open', () => {
  const feature = campus.features.find(f => f.id === 'local/footbridge'), layout = bridgeLayout(feature, 5.52);
  const geometry = bridgeNetGeometry(feature, layout.railChains), positions = geometry.attributes.position;
  const routes = [feature.points, feature.connections.find(c => c.id === 'playground-stairs').points];
  assert.ok(positions.count > 500 && positions.count < 3500, 'One bounded static wire batch spans the two confirmed faces');
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    assert.ok(Number.isFinite(x + y + z));
    assert.ok(y > 3.72 && y < 6.52, 'Wire stays between the actual stair level and the bridge guard top');
    assert.ok(routes.some(([a, b]) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      const facing = dz * (feature.sideNet.facing[0] - a[0]) - dx * (feature.sideNet.facing[1] - a[1]);
      const signedDistance = ((x - a[0]) * dz - (z - a[1]) * dx) / length;
      const along = ((x - a[0]) * dx + (z - a[1]) * dz) / length;
      return signedDistance * Math.sign(facing) > 0 && Math.abs(Math.abs(signedDistance) - feature.width / 2) < 1e-4
        && along > -1e-4 && along < length + 1e-4;
    }), 'No wire covers a portal or the unconfirmed gym and road branches');
  }
  geometry.dispose();
  const without = bridgeNetGeometry({ ...feature, sideNet: undefined }, layout.railChains);
  assert.equal(without.attributes.position.count, 0, 'Other bridges acquire no guessed netting'); without.dispose();
});
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

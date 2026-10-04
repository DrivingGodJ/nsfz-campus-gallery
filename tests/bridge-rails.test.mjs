import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { BRIDGE_DECK_THICKNESS, bridgeLayout, bridgeRailPosts, bridgeSupports } from '../src/bridge-geometry.ts';
import { bridgeHeight } from '../src/structure-geometry.ts';

const distanceToRing = (point, ring) => Math.min(...ring.slice(1).map((to, i) => {
  const from = ring[i], dx = to[0] - from[0], dz = to[1] - from[1];
  const t = Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(point[0] - from[0] - t * dx, point[1] - from[1] - t * dz);
}));

test('bridge rails follow the joined perimeter, leave all three exits open and meet stair landings continuously', async () => {
  const map = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
  const bridge = map.features.find(feature => feature.type === 'bridge');
  const before = JSON.stringify([bridge, site]);
  for (const floorHeight of [site.buildingOverrides['local/gymnasium'].floorHeight, 4.2]) {
    const overrides = { ...site.buildingOverrides, 'local/gymnasium': { ...site.buildingOverrides['local/gymnasium'], floorHeight } };
    const height = bridgeHeight(bridge, map.buildings, overrides), layout = bridgeLayout(bridge, height);
    assert.equal(layout.deck.length, 1, 'Bridge and branch landings share a single deck');
    assert.equal(layout.footprint.length, 1);
    assert.equal(layout.railChains.length, 3, 'Each open exit separates adjacent perimeter rail chains');
    const ends = layout.railChains.flatMap(chain => [chain[0], chain.at(-1)]);
    for (const connection of bridge.connections) {
      const terminal = connection.points.at(-1), previous = connection.points.at(-2);
      const length = Math.hypot(terminal[0] - previous[0], terminal[1] - previous[1]);
      const direction = terminal.map((n, i) => (n - previous[i]) / length);
      const portal = ends.filter(point => Math.abs((point[0] - terminal[0]) * direction[0] + (point[2] - terminal[1]) * direction[1]) < 1e-6);
      assert.equal(portal.length, 2, connection.id + ' has one rail endpoint at each side');
      for (const point of portal) {
        assert.ok(Math.abs(Math.hypot(point[0] - terminal[0], point[2] - terminal[1]) - bridge.width / 2) < 1e-6);
        assert.ok(Math.abs(point[1] - (connection.type === 'stairs' ? connection.groundHeight : height)) < 1e-6);
      }
    }
    for (const chain of layout.railChains) for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1], to = chain[i];
      assert.ok(from.every(Number.isFinite) && to.every(Number.isFinite));
      for (const t of [0, .5, 1]) {
        const point = from.map((n, j) => n + (to[j] - n) * t);
        assert.ok(distanceToRing([point[0], point[2]], layout.footprint[0].outer) < 1e-6, 'Rails follow exterior edges instead of blocking a branch');
        assert.ok(point[1] >= .12 - 1e-6 && point[1] <= height + 1e-6);
      }
    }
    for (const stair of layout.stairs) {
      const dx = stair.to[0] - stair.from[0], dz = stair.to[1] - stair.from[1], length = Math.hypot(dx, dz);
      for (const sign of [-1, 1]) {
        const expected = [stair.from[0] + sign * dz / length * bridge.width / 2, height, stair.from[1] - sign * dx / length * bridge.width / 2];
        assert.ok(layout.railChains.flat().some(point => Math.hypot(...point.map((n, i) => n - expected[i])) < 1e-6), 'The sloped rail starts exactly at the level landing');
      }
    }
    const posts = bridgeRailPosts(layout.railChains);
    for (let i = 0; i < posts.length; i++) for (let j = i + 1; j < posts.length; j++) assert.ok(Math.hypot(...posts[i].map((n, k) => n - posts[j][k])) >= .3 - 1e-7, 'No doubled or crowded corner posts');
  }
  assert.equal(JSON.stringify([bridge, site]), before);
});

test('elevated bridge columns remain covered by the slab at different heights and viewing angles, and ground bridges have no columns', async () => {
  const map = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const bridge = map.features.find(feature => feature.id === 'local/footbridge');
  const material = new THREE.MeshBasicMaterial();
  for (const floorHeight of [2.4, 3.6, 4.2]) {
    const height = bridgeHeight(bridge, map.buildings, { 'local/gymnasium': { floorHeight } });
    const supports = bridgeSupports(bridge, height);
    assert.ok(supports.length > 0, 'Keep the elevated bridge supported');
    const decks = bridgeLayout(bridge, height).deck.map(data => {
      const shape = new THREE.Shape(data.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
      shape.holes = data.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
      const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: BRIDGE_DECK_THICKNESS, bevelEnabled: false }), material);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = height - BRIDGE_DECK_THICKNESS;
      mesh.updateMatrixWorld();
      return mesh;
    });
    for (const support of supports) {
      const column = new THREE.Mesh(new THREE.BoxGeometry(...support.size), material);
      column.position.set(...support.position);
      column.updateMatrixWorld();
      const top = support.position[1] + support.size[1] / 2;
      assert.ok(top > height - BRIDGE_DECK_THICKNESS && top < height - .2, 'The cap is embedded in the slab, away from its top');
      for (const corner of [[0, 0], [-.32, -.32], [.32, .32]]) for (const view of [[0, 0], [2, 1], [-2, -1]]) {
        const target = new THREE.Vector3(support.position[0] + corner[0], top, support.position[2] + corner[1]);
        const origin = target.clone().add(new THREE.Vector3(view[0], 2, view[1]));
        const hits = new THREE.Raycaster(origin, target.clone().sub(origin).normalize()).intersectObjects([...decks, column]);
        assert.ok(hits.length > 0);
        assert.ok(decks.includes(hits[0].object), 'The column cap is occluded by the bridge deck from above');
        const cap = hits.find(hit => hit.object === column);
        assert.ok(cap && cap.distance - hits[0].distance > .2, 'No coincident depth values can flicker');
      }
      column.geometry.dispose();
    }
    decks.forEach(mesh => mesh.geometry.dispose());
  }
  for (const feature of map.features.filter(feature => feature.id === 'local/lake-bridge' || feature.id === 'local/arched-lake-bridge')) {
    assert.deepEqual(bridgeSupports(feature, bridgeHeight(feature, map.buildings, {})), [], 'Ground level lake bridges have no exposed support block');
  }
  material.dispose();
});

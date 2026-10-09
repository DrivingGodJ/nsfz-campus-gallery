import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { BRIDGE_DECK_THICKNESS, bridgeLayout, bridgeRailPosts, bridgeSupports } from '../src/bridge-geometry.ts';
import { bridgeHeight, straightStairTreads } from '../src/structure-geometry.ts';
import { bridgeNetGeometry } from '../src/bridge-net-geometry.ts';

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
    assert.ok(Math.abs(height - 5.52) < 1e-6, 'Gym floor-height edits do not move the fixed bridge deck or its guards');
    assert.equal(layout.deck.length, 1, 'Bridge and branch landings share a single deck');
    assert.equal(layout.footprint.length, 1);
    assert.equal(layout.railChains.length, 3, 'Each open exit separates adjacent perimeter rail chains');
    const ends = layout.railChains.flatMap(chain => [chain[0], chain.at(-1)]);
    for (const connection of bridge.connections) {
      const stair = layout.stairs.find(stair => stair.id === connection.id);
      const terminal = stair?.flights.length === 2
        ? stair.flights.at(-1).to : connection.points.at(-1);
      const previous = connection.points.at(-2);
      const length = Math.hypot(terminal[0] - previous[0], terminal[1] - previous[1]);
      const direction = terminal.map((n, i) => (n - previous[i]) / length);
      const portal = ends.filter(point => Math.abs((point[0] - terminal[0]) * direction[0] + (point[2] - terminal[1]) * direction[1]) < 1e-6);
      assert.equal(portal.length, 2, connection.id + ' has one rail endpoint at each side of its guarded exit');
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

test('playground stairs retain both flights and their middle platform while the original field-level exit has no slab or guards', async () => {
  const map = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const bridge = structuredClone(map.features.find(feature => feature.id === 'local/footbridge'));
  const connection = bridge.connections.find(connection => connection.id === 'playground-stairs');
  connection.midLanding = 1.1;
  const before = JSON.stringify(bridge);
  const distance = (from, to) => Math.hypot(...to.map((n, i) => n - from[i]));
  const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  for (const height of [5.52, 5.82, 4.02]) {
    const layout = bridgeLayout(bridge, height), stair = layout.stairs.find(stair => stair.id === connection.id);
    const [first, second] = stair.flights, [middle] = stair.landings;
    const ground = { from: second.to, to: stair.to, height: second.bottom };
    assert.equal(stair.flights.length, 2);
    assert.equal(stair.landings.length, 1, 'Only the middle landing renders a slab; the ground continuation is an open path');
    assert.deepEqual(first.from, stair.from);
    assert.deepEqual(first.to, middle.from);
    assert.deepEqual(middle.to, second.from);
    assert.deepEqual(second.to, ground.from);
    assert.deepEqual(ground.to, connection.points.at(-1), 'The original field connection stays in place');
    close(first.bottom, middle.height);
    close(second.top, middle.height);
    close(second.bottom, ground.height);
    close(ground.height, connection.groundHeight);
    close(distance(middle.from, middle.to), 1.1);
    for (const flight of stair.flights) {
      const treads = straightStairTreads(flight.from, flight.to, flight.top, flight.bottom);
      close(distance(flight.from, flight.to) / treads.length, .3);
      assert.ok(treads.every((tread, i) => tread.height < (i ? treads[i - 1].height : flight.top)));
      assert.deepEqual(treads.at(-1).to, flight.to);
      close(treads.at(-1).height, flight.bottom);
      if (height === 5.52) {
        assert.equal(treads.length, 8, 'Each flight has eight steps to reach the field one metre lower');
        close(distance(flight.from, flight.to), 2.4);
        close((flight.top - flight.bottom) / treads.length, .175);
      }
    }
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const slab = (from, to, top, thickness) => {
      const dx = to[0] - from[0], dz = to[1] - from[1];
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(bridge.width, thickness, distance(from, to)), material);
      mesh.rotation.y = Math.atan2(dx, dz);
      mesh.position.set((from[0] + to[0]) / 2, top - thickness / 2, (from[1] + to[1]) / 2);
      mesh.updateMatrixWorld(); return mesh;
    };
    const surfaces = layout.stairs.flatMap(stair => [
      ...stair.flights.flatMap(flight => straightStairTreads(flight.from, flight.to, flight.top, flight.bottom)
        .map(step => slab(step.from, step.to, step.height, step.height - flight.bottom + .08))),
      ...stair.landings.map(landing => slab(landing.from, landing.to, landing.height, BRIDGE_DECK_THICKNESS)),
    ]);
    const ray = point => new THREE.Raycaster(new THREE.Vector3(point[0], height + 1, point[1]), new THREE.Vector3(0, -1, 0), 0, height + 2).intersectObjects(surfaces);
    try {
      assert.ok(ray(middle.from.map((n, i) => (n + middle.to[i]) / 2)).length, 'The retained middle platform has a real walking surface');
      for (const t of [.05, .25, .5, .75, .95]) {
        const center = ground.from.map((n, i) => n + (ground.to[i] - n) * t);
        for (const side of [-.4, 0, .4]) {
          const dx = ground.to[0] - ground.from[0], dz = ground.to[1] - ground.from[1], span = distance(ground.from, ground.to);
          const point = [center[0] + dz / span * bridge.width * side, center[1] - dx / span * bridge.width * side];
          assert.equal(ray(point).length, 0, 'No bridge landing or stair slab covers the field-level continuation');
        }
      }
    } finally { surfaces.forEach(mesh => mesh.geometry.dispose()); material.dispose(); }
    const dx = stair.to[0] - stair.from[0], dz = stair.to[1] - stair.from[1], span = Math.hypot(dx, dz);
    const profile = [first, { ...middle, top: middle.height, bottom: middle.height }, second];
    for (const segment of profile) for (const side of [-1, 1]) {
      const endpoints = [segment.from, segment.to].map((point, i) => [point[0] + side * dz / span * bridge.width / 2,
        i ? segment.bottom : segment.top, point[1] - side * dx / span * bridge.width / 2]);
      for (const expected of endpoints) assert.ok(layout.railChains.flat().some(point => Math.hypot(...point.map((n, i) => n - expected[i])) < 1e-6),
        'Each flight and platform has a matching continuous rail joint on both sides');
      const center = endpoints[0].map((n, i) => (n + endpoints[1][i]) / 2);
      assert.ok(layout.railChains.some(chain => chain.slice(1).some((to, i) => {
        const from = chain[i], length = Math.hypot(...to.map((n, j) => n - from[j]));
        return Math.abs(Math.hypot(...center.map((n, j) => n - from[j])) + Math.hypot(...to.map((n, j) => n - center[j])) - length) < 1e-6;
      })), 'Rails follow both slopes and stay flat over the middle platform');
    }
    const railPoints = [...layout.railChains.flat(), ...bridgeRailPosts(layout.railChains)];
    const net = bridgeNetGeometry(bridge, layout.railChains), wires = net.attributes.position;
    try {
      for (let n = 0; n < wires.count; n++) railPoints.push([wires.getX(n), wires.getY(n), wires.getZ(n)]);
      for (const point of railPoints) {
        const along = ((point[0] - ground.from[0]) * dx + (point[2] - ground.from[1]) * dz) / span;
        const across = Math.abs((point[0] - ground.from[0]) * dz - (point[2] - ground.from[1]) * dx) / span;
        assert.ok(along <= 1e-5 || along > distance(ground.from, ground.to) + 1e-5 || across > bridge.width / 2 + 1e-5,
          'No side guard, post or wire continues beyond the last flight onto the level ground approach');
      }
    } finally { net.dispose(); }
    const oldStair = layout.stairs.find(stair => stair.id === 'upper-road-stairs');
    assert.equal(oldStair.flights.length, 1, 'Unmarked stairs retain the existing straight descent');
    assert.deepEqual(oldStair.landings, []);
  }
  assert.equal(JSON.stringify(bridge), before, 'Layout generation never changes saved feature data');
  const end = connection.points.at(-1), start = connection.points[0], length = distance(start, end);
  connection.points[1] = start.map((n, i) => n + (end[i] - n) * 3 / length);
  const short = bridgeLayout(bridge, 5.52).stairs.find(stair => stair.id === connection.id);
  assert.equal(short.flights.length, 2);
  assert.equal(short.landings.length, 1, 'A short route uses its available space instead of extending beyond the terminal');
  assert.deepEqual(short.flights.at(-1).to, short.to);
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

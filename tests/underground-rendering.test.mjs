import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { joinedPassages, undergroundConnections, undergroundFootprints, undergroundLayout } from '../src/underground-geometry.ts';
import { undergroundBoundaryLines, undergroundVolume } from '../src/underground-mesh.ts';

const area = ring => Math.abs(ring.slice(1).reduce((sum, point, i) => sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0) / 2);
const inside = (point, ring) => {
  let contained = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x, z] = ring[i], [beforeX, beforeZ] = ring[j];
    if ((z > point[1]) !== (beforeZ > point[1]) && point[0] < (beforeX - x) * (point[1] - z) / (beforeZ - z) + x) contained = !contained;
  }
  return contained;
};
const distance = (point, ring) => Math.min(...ring.slice(1).map((to, i) => {
  const from = ring[i], dx = to[0] - from[0], dz = to[1] - from[1];
  const t = Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(point[0] - from[0] - dx * t, point[1] - from[1] - dz * t);
}));
const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));

test('the straight underground tunnel renders at full width without a middle seam', () => {
  const tunnel = campus.features.find(feature => feature.id === 'local/underpass');
  const before = JSON.stringify(tunnel), shapes = undergroundFootprints(tunnel);
  assert.equal(JSON.stringify(tunnel), before);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].outer.length, 5);
  assert.equal(shapes[0].holes.length, 0);
  const length = Math.hypot(...tunnel.points.at(-1).map((n, i) => n - tunnel.points[0][i]));
  assert.ok(Math.abs(area(shapes[0].outer) - length * tunnel.width) < 1e-7);
  assert.ok(Math.abs(distance(tunnel.points[1], shapes[0].outer) - tunnel.width / 2) < 1e-7, 'The midpoint is inside the passage, away from all boundary lines');
});

test('the exit and corridor share one continuous footprint with no overlap block or internal corner cap', () => {
  const corridor = campus.features.find(feature => feature.id === 'local/underground-corridor');
  const connections = undergroundConnections(campus.features, corridor);
  assert.deepEqual(connections.map(feature => feature.id), ['local/underpass-exit']);
  const exit = connections[0], before = JSON.stringify([corridor, exit]);
  const shapes = undergroundFootprints(corridor, connections);
  assert.equal(JSON.stringify([corridor, exit]), before);
  assert.equal(shapes.length, 1);
  assert.equal(shapes[0].holes.length, 0);
  const shape = shapes[0], approachLength = Math.hypot(...exit.points[1].map((n, i) => n - exit.points[0][i]));
  const expectedArea = area(corridor.outer) + (approachLength - corridor.width / 2) * exit.width;
  assert.ok(Math.abs(area(shape.outer) - expectedArea) < 1e-7, 'The extended upper side absorbs the return bend without a second overlapping floor');
  assert.ok(distance(exit.points.at(-1), shape.outer) >= exit.width / 2 - 1e-7, 'No internal end wall cuts through the connection');
  for (let i = 1; i < exit.points.length; i++) {
    const from = exit.points[i - 1], to = exit.points[i];
    for (const t of [.1, .5, .9]) assert.ok(inside(from.map((n, j) => n + (to[j] - n) * t), shape.outer));
  }
  const leftSide = corridor.outer[0], rightSide = corridor.outer[3];
  const openGap = leftSide.map((n, i) => n + (rightSide[i] - n) * .5);
  assert.equal(inside(openGap, shape.outer), false, 'Joining the exit does not recreate the removed cross corridor');
});

test('the tunnel and green exit align along a shared open seam, without overlapping faces, dashed caps or hidden walls', () => {
  const before = JSON.stringify(campus.features), layout = undergroundLayout(campus.features);
  const tunnel = layout.areas.get('local/underpass'), corridor = layout.areas.get('local/underground-corridor');
  const exit = corridor.connections.find(f => f.id === 'local/underpass-exit');
  const joined = joinedPassages(tunnel.feature, exit), seam = joined.seam;
  assert.deepEqual(tunnel.openings[0], seam); assert.deepEqual(corridor.openings[0], seam);
  assert.equal(tunnel.openings.length, 2, 'The entrance stair has its own real opening at the other tunnel end');
  assert.ok(corridor.openings.length >= 3, 'Sports halls also have real doors into the side passages');
  assert.equal(tunnel.feature.height, corridor.feature.height);
  const tunnelShape = tunnel.footprints[0], corridorShape = corridor.footprints[0];
  for (const p of seam) {
    assert.ok(distance(p, tunnelShape.outer) < 1e-8);
    assert.ok(distance(p, corridorShape.outer) < 1e-8);
  }
  const polygon = shapes => shapes.map(shape => [shape.outer, ...shape.holes]);
  assert.deepEqual(polygonClipping.intersection(polygon(tunnel.footprints), polygon(corridor.footprints)), [], 'Transparent colors do not overlap at the turn');
  assert.equal(polygonClipping.union(polygon(tunnel.footprints), polygon(corridor.footprints)).length, 1, 'The join remains connected across its full width');
  assert.deepEqual(layout.locations.get(tunnel.feature.id), tunnel.footprints, 'Selection follows the aligned tunnel footprint');
  assert.deepEqual(layout.locations.get(exit.id), undergroundFootprints({ ...exit, ...joined.outgoing }), 'Selection follows the aligned exit footprint');
  const normal = new THREE.Vector3(seam[1][1] - seam[0][1], 0, seam[0][0] - seam[1][0]).normalize();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = [tunnel, corridor].flatMap(area => area.footprints.map(shape => {
    const mesh = new THREE.Mesh(undergroundVolume(shape, area.feature.wallHeight || 2.4, area.openings), material);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = area.feature.height;
    mesh.updateMatrixWorld();
    return mesh;
  }));
  try {
    for (const t of [.1, .25, .5, .75, .9]) {
      const p = seam[0].map((n, i) => n + (seam[1][i] - n) * t);
      for (const sign of [-1, 1]) {
        const cross = [p[0] + normal.x * .06 * sign, p[1] + normal.z * .06 * sign];
        assert.ok(inside(cross, tunnelShape.outer) || inside(cross, corridorShape.outer), 'There is no crack across the seam');
      }
      const start = new THREE.Vector3(p[0], tunnel.feature.height + 1.2, p[1]).addScaledVector(normal, -.12);
      assert.equal(new THREE.Raycaster(start, normal, 0, .24).intersectObjects(meshes).length, 0, 'The connected underground space has no internal end wall');
      for (const area of [tunnel, corridor]) {
        const lines = area.footprints.flatMap(shape => undergroundBoundaryLines(shape, area.openings));
        assert.ok(lines.every(line => distance(p, line) > .05), 'Neither colored outline adds a dashed barrier across the opening');
      }
    }
  } finally { meshes.forEach(mesh => mesh.geometry.dispose()); material.dispose(); }
  assert.equal(JSON.stringify(campus.features), before, 'Alignment does not move the tunnel route, entrance or corridor');
});

test('unequal-width right-angle passages share matching edges in either turn direction and after rotation', () => {
  const rotate = (point, angle) => [point[0] * Math.cos(angle) - point[1] * Math.sin(angle), point[0] * Math.sin(angle) + point[1] * Math.cos(angle)];
  for (const angle of [-2.8, 0, .6, 2.2]) for (const turn of [-1, 1]) {
    const incoming = { points: [[0, -20], [0, 0]].map(p => rotate(p, angle)), width: 4 };
    const outgoing = { points: [[0, 0], [20 * turn, 0]].map(p => rotate(p, angle)), width: 5 };
    const joined = joinedPassages(incoming, outgoing);
    assert.deepEqual(polygonClipping.intersection([joined.incoming.outer], [joined.outgoing.outer]), []);
    assert.equal(polygonClipping.union([joined.incoming.outer], [joined.outgoing.outer]).length, 1);
    assert.ok(Math.abs(area(joined.incoming.outer) - 80) < 1e-8);
    assert.ok(Math.abs(area(joined.outgoing.outer) - 100) < 1e-8);
  }
});

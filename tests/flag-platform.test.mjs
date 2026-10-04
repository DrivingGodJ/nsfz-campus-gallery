import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import clip from 'polygon-clipping';
import * as THREE from 'three';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { basketballGeometry } from '../src/basketball-geometry.ts';
import { passageFootprint } from '../src/underground-geometry.ts';
import { flagPlatformGeometry, flagPlatformLayout } from '../src/flag-platform-geometry.ts';

const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
const campus = await read('public/data/campus.json');
const platform = campus.features.find(f => f.id === 'local/flag-platform'), model = platform.flagPlatform;
const basketball = campus.features.find(f => f.type === 'basketballCourts');
const polygon = shape => [shape.outer, ...(shape.holes || [])];

test('the flag platform and its surrounding stairs occupy the circled court-side clearing', async () => {
  assert.ok(Math.hypot(model.center[0] + 66.25, model.center[1] - 17.68) < .8, 'Position comes from the circled reference using all four court corners');
  assert.equal(clip.difference(polygon(platform), polygon(basketball)).length, 0, 'The base fits inside the court-side clearing');
  for (const court of basketballGeometry(basketball.courts)) {
    assert.equal(clip.intersection(polygon(platform), polygon(court.surface)).length, 0, 'The playing surfaces remain clear');
  }
  const obstacles = [...campus.buildings, ...campus.features.filter(f => f.type === 'water' && f.outer),
    ...campus.features.filter(f => f.type === 'path' && f.points && !f.representedBy).map(f => passageFootprint(f.points, f.width || 3))];
  for (const obstacle of obstacles) assert.equal(clip.intersection(polygon(platform), polygon(obstacle)).length, 0, 'The platform avoids buildings, roads and water');
  const front = new THREE.Vector2(-model.axis[1], model.axis[0]);
  assert.ok(front.dot(new THREE.Vector2(...basketball.courts.axis)) < -.999, 'The rectangular platform keeps its orientation relative to the courts');
  assert.ok(front.dot(new THREE.Vector2(basketball.courts.center[0] - model.center[0], basketball.courts.center[1] - model.center[1])) > 20);
  assert.deepEqual(applyCampusCorrections(campus, await read('data/campus-corrections.json')), campus, 'The addition survives refreshing the source map');
});

test('the rectangular center has usable descending stairs on all four faces, with continuous corners', () => {
  const layout = flagPlatformLayout(model), material = new THREE.MeshBasicMaterial();
  assert.ok(layout.rise >= .1 && layout.rise <= .18);
  assert.ok(layout.tread >= .3 && layout.centerWidth >= 3 && layout.centerDepth >= 2);
  assert.ok(model.platformHeight <= 1 && model.poleHeight >= 9 && model.poleHeight <= 12);
  const geometry = flagPlatformGeometry(model), mesh = new THREE.Mesh(geometry, material);
  mesh.updateMatrixWorld();
  const height = (x, z) => {
    const hits = new THREE.Raycaster(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
    assert.ok(hits.length, 'The stone presents an upward-facing surface');
    return hits[0].point.y;
  };
  try {
    assert.ok(Math.abs(height(0, 0) - model.platformHeight) < 1e-6, 'The flag stands on the central rectangular top');
    for (const side of [-1, 1]) {
      for (let i = 1; i < model.steps; i++) {
        const x = layout.centerWidth / 2 + (i - .5) * layout.tread;
        const z = layout.centerDepth / 2 + (i - .5) * layout.tread;
        const expected = model.platformHeight - i * layout.rise;
        for (const point of [[side * x, 0], [0, side * z], [side * x, z], [side * x, -z]]) {
          assert.ok(Math.abs(height(...point) - expected) < 1e-6, 'Every side and corner descends one riser at a time');
        }
      }
    }
    const positions = geometry.getAttribute('position'), edges = new Map();
    const key = i => [positions.getX(i), positions.getY(i), positions.getZ(i)].map(v => v.toFixed(5)).join(',');
    for (let i = 0; i < positions.count; i += 3) for (let j = 0; j < 3; j++) {
      const edge = [key(i + j), key(i + (j + 1) % 3)].sort().join('|');
      edges.set(edge, (edges.get(edge) || 0) + 1);
    }
    assert.ok([...edges.values()].every(count => count === 2), 'The podium and all surrounding stairs form one closed surface without corner gaps or duplicate faces');
  } finally { geometry.dispose(); material.dispose(); }
});

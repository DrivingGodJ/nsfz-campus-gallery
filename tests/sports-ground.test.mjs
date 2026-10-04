import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { stadiumSurfaces } from '../src/structure-geometry.ts';

const ringArea = ring => Math.abs(ring.slice(1).reduce((sum, point, i) => sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0) / 2);
const polygonArea = polygon => ringArea(polygon[0]) - polygon.slice(1).reduce((sum, ring) => sum + ringArea(ring), 0);
const geometryArea = geometry => geometry.reduce((sum, polygon) => sum + polygonArea(polygon), 0);

test('track, grass and pitch stripes cover the stadium once without overlapping colored faces', async () => {
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const track = campus.features.find(feature => feature.type === 'runningTrack').track;
  const before = JSON.stringify(track), surfaces = stadiumSurfaces(track);
  const polygons = [surfaces.track, surfaces.grass, ...surfaces.stripes].map(shape => [shape.outer, ...shape.holes]);
  for (let i = 0; i < polygons.length; i++) for (let j = i + 1; j < polygons.length; j++) {
    assert.ok(geometryArea(polygonClipping.intersection(polygons[i], polygons[j])) < 1e-7, 'No two field colors compete at the same surface location');
  }
  const whole = [surfaces.track.outer], union = polygonClipping.union(polygons[0], ...polygons.slice(1));
  assert.ok(geometryArea(polygonClipping.difference(whole, union)) < 1e-7, 'There are no gaps between colors');
  assert.ok(geometryArea(polygonClipping.difference(union, whole)) < 1e-7, 'The colored surfaces remain inside the original oval');
  for (const polygon of polygons) {
    const shape = new THREE.Shape(polygon[0].map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = polygon.slice(1).map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    const mesh = new THREE.ShapeGeometry(shape), vertices = mesh.getAttribute('position'), index = mesh.getIndex();
    let meshArea = 0;
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i), b = index.getX(i + 1), c = index.getX(i + 2);
      meshArea += Math.abs((vertices.getX(b) - vertices.getX(a)) * (vertices.getY(c) - vertices.getY(a)) - (vertices.getY(b) - vertices.getY(a)) * (vertices.getX(c) - vertices.getX(a))) / 2;
    }
    assert.ok(Math.abs(meshArea - polygonArea(polygon)) < .005, 'The rendered mesh respects the grass and track holes');
    mesh.dispose();
  }
  assert.equal(JSON.stringify(track), before);
});

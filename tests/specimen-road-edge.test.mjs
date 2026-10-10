import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { roadFootprint } from '../src/road-geometry.ts';
import { passageFootprint } from '../src/underground-geometry.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { groundSurfaces } from '../src/ground-geometry.ts';
import { specimenGroveGeometry, specimenTrees } from '../src/specimen-grove.ts';
import { treeInstances } from '../src/tree-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
const campus = await read('public/data/campus.json');
const road = campus.features.find(feature => feature.id === 'way/1233313443');
const grove = campus.features.find(feature => feature.id === 'local/specimen-forest');
const polygon = shape => [shape.outer, ...(shape.holes || [])];
const ringArea = ring => Math.abs(ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
const area = polygons => polygons.reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((n, ring) => n + ringArea(ring), 0), 0);
const mesh = shape => {
  const result = new THREE.Mesh(buildingGeometry(shape, .04, 3.6), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  result.rotation.x = -Math.PI / 2; result.position.y = .075; result.updateMatrixWorld(); return result;
};
const above = (point, meshes) => new THREE.Raycaster(new THREE.Vector3(point[0], 1, point[1]), new THREE.Vector3(0, -1, 0), 0, 2).intersectObjects(meshes);
const dispose = meshes => meshes.forEach(item => { item.geometry.dispose(); item.material.dispose(); });

test('the photographed widening has real pavement outside the old strip and connects to the existing street and wing wall foot', () => {
  assert.ok(road.outer, 'The street can widen on one side without moving its centerline');
  const target = mesh(roadFootprint(road)), old = mesh(passageFootprint(road.points, road.width));
  const junctions = ['way/1233313442', 'way/1233313444'].map(id => campus.features.find(feature => feature.id === id));
  const approaches = junctions.map(feature => mesh(roadFootprint(feature)));
  try {
    for (const point of [[97, 70.8], [110, 68], [138, 62]]) {
      assert.equal(above(point, [old]).length, 0, 'The calibration samples were beyond the former narrow road edge');
      const hits = above(point, [target]);
      assert.ok(hits.length, 'The widened street covers each photographed forest-side pavement sample');
      assert.ok(Math.abs(hits[0].point.y - .115) < 1e-6, 'The new paving retains the street surface height');
    }
    for (const [i, junction] of junctions.entries()) {
      const join = junction.id === 'way/1233313442' ? junction.points.at(-1) : junction.points[0];
      assert.ok(above(join, [target]).length, 'The same approach endpoint remains on the street');
      const shared = clip.intersection(polygon(roadFootprint(road)), polygon(roadFootprint(junction)));
      assert.ok(area(shared) > .01, 'Both approaches retain a real shared paving seam rather than a gap');
      const ring = shared[0][0].slice(0, -1);
      const inset = ring.reduce((sum, p) => sum.map((n, j) => n + p[j] / ring.length), [0, 0]);
      assert.ok(above(inset, [target]).length && above(inset, [approaches[i]]).length, 'Rendered paving from both routes covers the inside of the shared seam');
    }
    const wing = campus.buildings.find(building => building.id === 'way/855459420').parts.find(part => part.id === 'sixth-floor-wing');
    const [a, b] = wing.outer.slice(3, 5), middle = a.map((n, i) => (n + b[i]) / 2);
    const center = road.outer.reduce((sum, p) => sum.map((n, i) => n + p[i] / road.outer.length), [0, 0]);
    const normal = [b[1] - a[1], a[0] - b[0]], length = Math.hypot(...normal);
    const sign = normal[0] * (center[0] - middle[0]) + normal[1] * (center[1] - middle[1]) > 0 ? 1 : -1;
    const streetSide = middle.map((n, i) => n + sign * normal[i] / length * .08);
    assert.ok(above(streetSide, [target]).length, 'There is pavement immediately beside the photographed wing wall foot');
    const ground = groundSurfaces(campus);
    for (const shape of [...ground.campus, ...ground.background, ...ground.features.values()].flat()) {
      assert.ok(area(clip.intersection(polygon(roadFootprint(road)), polygon(shape))) < 1e-6,
        'Underlying ground and surface layers use the widened boundary instead of filling it with a competing face');
    }
  } finally { dispose([target, old, ...approaches]); }
});

test('the adjusted grove, its rendered paths and its trunks leave the widened street clear', () => {
  const roadShape = polygon(roadFootprint(road));
  assert.equal(clip.intersection(roadShape, polygon(grove)).length, 0, 'The lawn edge follows the widened road without covering it');
  const geometry = specimenGroveGeometry(grove);
  try {
    for (const key of ['paths', 'edging']) {
      const positions = geometry[key].getAttribute('position'), indices = geometry[key].getIndex();
      const triangles = [];
      for (let i = 0; i < (indices?.count ?? positions.count); i += 3) {
        const ring = [0, 1, 2].map(j => {
          const n = indices ? indices.getX(i + j) : i + j;
          return [positions.getX(n), positions.getZ(n)];
        });
        ring.push(ring[0]); if (ringArea(ring) > 1e-9) triangles.push([ring]);
      }
      assert.ok(triangles.length);
      assert.ok(area(clip.intersection(triangles, roadShape)) < 1e-5, 'The actual triangulated garden paths and edging do not extend onto the widened street');
    }
    for (const tree of specimenTrees(grove)) {
      const matrix = treeInstances(tree, true).trunk;
      const root = new THREE.Vector3().setFromMatrixPosition(matrix);
      const radius = new THREE.Vector3(1, 0, 0).applyMatrix4(matrix).distanceTo(root) * 1.015;
      const ring = Array.from({ length: 33 }, (_, i) => [root.x + radius * Math.cos(i * Math.PI / 16), root.z + radius * Math.sin(i * Math.PI / 16)]);
      assert.equal(clip.intersection([ring], roadShape).length, 0, 'Rendered trunks and whitewashed bases remain outside the street');
    }
  } finally { Object.values(geometry).forEach(part => part.dispose()); }
});

test('the widened road and inset grove survive campus regeneration without rewriting their calibrated shapes', async () => {
  const regenerated = applyCampusCorrections(campus, await read('data/campus-corrections.json'));
  for (const feature of [road, grove]) assert.deepEqual(regenerated.features.find(item => item.id === feature.id), feature);
});

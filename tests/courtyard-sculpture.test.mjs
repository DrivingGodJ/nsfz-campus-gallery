import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { courtyardSculptureFootprint, courtyardSculptureGeometry } from '../src/courtyard-sculpture-geometry.ts';
import { passageShape } from '../src/building-geometry.ts';
import { teachingDetailGeometry } from '../src/teaching-details.ts';
import { buildingLevels } from '../src/building-model.ts';
import { campusLocations } from '../src/locations.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const model = { center: [79.5, 77.2], facing: [-.1613477474531792, -.986897615962155], width: 4.8, depth: 3, totalHeight: 3.25 };

test('the actual courtyard feature preserves its marked position, faces the northward arrow and survives map regeneration', () => {
  const read = file => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
  const campus = read('public/data/campus.json'), site = read('public/data/site.json');
  const feature = campus.features.find(f => f.id === 'local/teaching-courtyard-sculpture');
  assert.deepEqual(feature.sculpture, model);
  assert.equal(feature.height, .135, 'It rests on the unchanged courtyard paving');
  assert.deepEqual({outer:feature.outer,holes:feature.holes}, courtyardSculptureFootprint(feature.sculpture));
  assert.ok(feature.sculpture.facing[1] < -.98, 'Screen-down arrow maps to geographic north, not south');
  assert.ok(!campusLocations(campus, site).some(location => location.id === feature.id), 'A decorative sculpture does not create another photo destination');
  assert.deepEqual(applyCampusCorrections(campus, read('data/campus-corrections.json')), campus);
});

test('the silver sculpture is one closed organic surface with two real through-holes, seated on its pedestal', () => {
  const parts = courtyardSculptureGeometry(model), sculpture = parts.silver, positions = sculpture.attributes.position;
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mesh = new THREE.Mesh(sculpture, material);
  mesh.updateMatrixWorld();
  try {
    for (const geometry of Object.values(parts)) {
      assert.ok([...geometry.attributes.position.array].every(Number.isFinite));
      assert.ok([...geometry.attributes.normal.array].every(Number.isFinite));
      assert.ok(geometry.boundingBox.min.y >= -1e-6 && geometry.boundingBox.max.y <= model.totalHeight + 1e-6);
      assert.ok(geometry.boundingBox.min.x >= -model.width / 2 - 1e-6 && geometry.boundingBox.max.x <= model.width / 2 + 1e-6);
      assert.ok(geometry.boundingBox.min.z >= -model.depth / 2 - 1e-6 && geometry.boundingBox.max.z <= model.depth / 2 + 1e-6);
    }
    assert.ok(parts.pedestal.boundingBox.max.y >= sculpture.boundingBox.min.y, 'The silver body rests on its dark base');
    assert.ok(Math.abs(sculpture.boundingBox.max.y - model.totalHeight) < 1e-6);
    for (const [x, y] of sculpture.userData.apertures) for (const dy of [-.08, 0, .08]) {
      assert.equal(new THREE.Raycaster(new THREE.Vector3(x, y + dy, 2), new THREE.Vector3(0, 0, -1), 0, 4).intersectObject(mesh).length, 0, 'Both openings visibly pass through the actual silver body');
    }
    const vertices = new Map(), edges = new Set(), parents = [];
    const find = i => parents[i] === i ? i : parents[i] = find(parents[i]);
    for (let i = 0; i < positions.count; i += 3) {
      const triangle = [];
      for (let j = 0; j < 3; j++) {
        const key = [positions.getX(i + j), positions.getY(i + j), positions.getZ(i + j)].map(n => n.toFixed(5)).join(',');
        if (!vertices.has(key)) { vertices.set(key, vertices.size); parents.push(parents.length); }
        triangle.push(vertices.get(key));
      }
      for (let j = 0; j < 3; j++) {
        const a = triangle[j], b = triangle[(j + 1) % 3]; edges.add([a, b].sort((a, b) => a - b).join(',')); parents[find(a)] = find(b);
      }
    }
    assert.equal(new Set(parents.map((_, i) => find(i))).size, 1, 'The forms are fused, not two separate rings');
    assert.equal(vertices.size - edges.size + positions.count / 3, -2, 'The closed connected surface has genus two');
    assert.ok(Object.values(parts).reduce((n, g) => n + (g.index ? g.index.count : g.attributes.position.count) / 3, 0) < 24000);
  } finally { Object.values(parts).forEach(g => g.dispose()); material.dispose(); }
});

test('the low planter sits inside the marked small atrium with two-metre walking room and no column, wall or passage overlap', () => {
  const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
  const site = JSON.parse(fs.readFileSync(new URL('../public/data/site.json', import.meta.url)));
  const building = campus.buildings.find(b => b.id === 'way/855459420'), hole = building.holes[1];
  const planter = courtyardSculptureFootprint(model), before = JSON.stringify(building);
  assert.deepEqual(polygonClipping.difference([planter.outer], [hole]), []);
  for (const point of planter.outer) for (let i = 1; i < hole.length; i++) {
    const a = hole[i - 1], b = hole[i], dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    assert.ok(Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dz * t) > 2, 'Every planter corner leaves more than 2 m to the courtyard edge');
  }
  for (const passage of building.groundPassages) assert.deepEqual(polygonClipping.intersection([planter.outer], [passageShape(passage).outer]), []);
  for (const other of campus.buildings) assert.deepEqual(polygonClipping.intersection([planter.outer], [other.outer, ...other.holes]), [], 'The planter does not cover any building wall');
  const levels = buildingLevels(building, site.buildingOverrides[building.id]), details = teachingDetailGeometry(building, levels.sections, levels.floorHeight);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), columns = new THREE.Mesh(details.columns, material);
  columns.updateMatrixWorld();
  try {
    for (let u = -.5; u <= .5; u += .1) for (let v = -.5; v <= .5; v += .1) {
      const p = [model.center[0] + model.facing[1] * model.width * u + model.facing[0] * model.depth * v, model.center[1] - model.facing[0] * model.width * u + model.facing[1] * model.depth * v];
      assert.equal(new THREE.Raycaster(new THREE.Vector3(p[0], .2, p[1]), new THREE.Vector3(0, 1, 0), 0, 3.25).intersectObject(columns).length, 0, 'The flower bed and silver body clear the actual atrium columns');
    }
    assert.equal(JSON.stringify(building), before);
  } finally { Object.values(details).forEach(g => g.dispose()); material.dispose(); }
});

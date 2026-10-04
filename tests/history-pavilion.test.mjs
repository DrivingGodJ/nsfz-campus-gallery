import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { buildingLevels } from '../src/building-model.ts';
import { pavilionGeometry, PAVILION_BASE } from '../src/pavilion-geometry.ts';

test('the photo-based history pavilion stays on its original terrace and follows editable floor heights', async () => {
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
  const building = campus.buildings.find(item => item.id === 'way/1233313451');
  const original = JSON.stringify([building, site]);
  assert.equal(building.appearance.type, 'glass-pavilion');
  assert.equal(site.buildingOverrides[building.id].name, '校史馆');
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus);
  const inside = ([x, , z]) => {
    let contained = false;
    for (let i = 0, j = building.outer.length - 1; i < building.outer.length; j = i++) {
      const [xi, zi] = building.outer[i], [xj, zj] = building.outer[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) contained = !contained;
    }
    return contained;
  };
  for (const override of [site.buildingOverrides[building.id], { name: '校史馆', floors: 2, floorHeight: 4.1 }]) {
    const info = buildingLevels(building, override), geometry = pavilionGeometry(building.appearance, info.height);
    assert.equal(geometry.peak - PAVILION_BASE, override.floors * override.floorHeight);
    assert.ok([...geometry.roofVertices, ...geometry.canopyVertices, ...geometry.rearWing.outer.map(([x, z]) => [x, geometry.rearTop, z])].every(inside), 'The glass pavilion, canopy and attached rear building stay inside the existing OSM terrace');
    assert.ok(geometry.roofVertices.every(point => point[1] <= geometry.peak));
    assert.ok(geometry.canopyVertices.every(point => point[1] > PAVILION_BASE && point[1] < geometry.peak));
    assert.ok(Math.hypot(...geometry.canopyOuter[0].map((n, i) => n - geometry.canopyOuter.at(-1)[i])) > building.appearance.radius, 'The surrounding canopy has an open entrance side');
    for (const [vertices, indices] of [[geometry.roofVertices, geometry.roofIndices], [geometry.canopyVertices, geometry.canopyIndices]]) {
      assert.ok(indices.every(index => index >= 0 && index < vertices.length));
      for (let i = 0; i < indices.length; i += 3) {
        const a = vertices[indices[i]], b = vertices[indices[i + 1]], c = vertices[indices[i + 2]];
        assert.ok(Math.abs((b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0])) > 1e-8, 'Roof panels have usable surface area');
      }
    }
  }
  assert.equal(JSON.stringify([building, site]), original);
});

test('history hall joins a raised front half-circle and a lower rear half-circle to the same rectangular building', async () => {
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
  const building = campus.buildings.find(item => item.id === 'way/1233313451');
  const model = building.appearance, height = buildingLevels(building, site.buildingOverrides[building.id]).height;
  const geometry = pavilionGeometry(model, height);
  assert.equal(model.canopySweep, Math.PI, 'The large curve is a half-circle');
  const angle = model.canopyStartAngle - Math.PI / 2, front = [Math.cos(angle), Math.sin(angle)];
  const gate = campus.features.find(feature => feature.id === 'local/gate-monument').landmark.center;
  const toGate = gate.map((coordinate, i) => coordinate - model.center[i]);
  assert.ok((front[0] * toGate[0] + front[1] * toGate[1]) / Math.hypot(...toGate) > .95, 'The taller dark half-circle faces the campus entrance rather than the rear buildings');
  const side = ([x, , z]) => (x - model.center[0]) * front[0] + (z - model.center[1]) * front[1];
  assert.ok(geometry.rim.every(point => side(point) >= -1e-8), 'The dark curved facade occupies only the front half');
  assert.ok(geometry.canopyOuter.every(point => side(point) <= 1e-8), 'The large canopy occupies only the rear half');
  const endpoints = [[geometry.rim[0], geometry.canopyInner.at(-1)], [geometry.rim.at(-1), geometry.canopyInner[0]]];
  for (const [a, b] of endpoints) assert.ok(Math.hypot(a[0] - b[0], a[2] - b[2]) < 1e-8, 'Both curves end on the shared diameter');
  assert.deepEqual(geometry.rearWing.outer.slice(0, 2), [geometry.core.outer[0], geometry.core.outer.at(-2)], 'The rear block joins the whole straight edge of the small half-circle');
  assert.equal(polygonClipping.union([geometry.core.outer], [geometry.rearWing.outer]).length, 1, 'The dark front and rear building form one connected footprint');
  assert.deepEqual(polygonClipping.intersection([geometry.core.outer], [geometry.rearWing.outer]), [], 'The two bodies join edge to edge without overlapping volumes');
  assert.ok(geometry.wallTop - geometry.canopyInner[0][1] > height * .2, 'The dark curved body is visibly taller than the canopy');
  assert.ok(geometry.canopyOuter[0][1] - geometry.rearTop > .1, 'The canopy clears the rear roof');
  for (const [vertices, indices] of [[geometry.wallVertices, geometry.wallIndices], [geometry.rearGlassVertices, geometry.rearGlassIndices]]) {
    assert.ok(vertices.flat().every(Number.isFinite));
    assert.ok(indices.every(index => index >= 0 && index < vertices.length));
    for (let i = 0; i < indices.length; i += 3) {
      const a = vertices[indices[i]], b = vertices[indices[i + 1]], c = vertices[indices[i + 2]];
      const u = b.map((n, j) => n - a[j]), v = c.map((n, j) => n - a[j]);
      assert.ok(Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) > 1e-8, 'The attached glass faces have no collapsed triangles');
    }
  }
});

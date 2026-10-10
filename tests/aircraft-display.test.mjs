import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import { aircraftDisplayGeometry } from '../src/aircraft-display-geometry.ts';
import { basketballGeometry } from '../src/basketball-geometry.ts';
import { passageFootprint } from '../src/underground-geometry.ts';
import { campusLocations } from '../src/locations.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

test('the display jet has calibrated length and span, touches the ground and stays a finite low-face model', () => {
  const model = { center: [0, 0], axis: [0, 1], length: 13.5, span: 7.2, totalHeight: 3.8 };
  const geometry = aircraftDisplayGeometry(model), bounds = new THREE.Box3();
  try {
    let triangles = 0;
    for (const part of Object.values(geometry)) {
      assert.ok([...part.getAttribute('position').array].every(Number.isFinite));
      assert.ok([...part.getAttribute('normal').array].every(Number.isFinite));
      bounds.union(part.boundingBox);
      triangles += part.getAttribute('position').count / 3;
    }
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x - model.span) < 1e-5 && Math.abs(size.z - model.length) < 1e-5);
    assert.ok(Math.abs(bounds.min.y) < 1e-5 && Math.abs(bounds.max.y - model.totalHeight) < 1e-5);
    assert.ok(geometry.dark.boundingBox.max.z > 0 && geometry.body.boundingBox.max.z === bounds.max.z, 'The canopy sits toward the pointed +Z nose');
    assert.ok(triangles < 1500, 'Three merged meshes keep the simplified aircraft modest');
  } finally { Object.values(geometry).forEach(part => part.dispose()); }
});

test('the calibrated aircraft sits beside the playable courts, clears roads and survives regeneration without a new photo region', async () => {
  const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
  const campus = await read('public/data/campus.json'), site = await read('public/data/site.json');
  const aircraft = campus.features.find(feature => feature.id === 'local/basketball-display-aircraft');
  const basketball = campus.features.find(feature => feature.type === 'basketballCourts');
  assert.ok(aircraft?.aircraft && aircraft.outer && basketball?.courts);
  const polygon = shape => [shape.outer, ...(shape.holes || [])];
  const envelope = polygon(aircraft), courts = basketballGeometry(basketball.courts);
  assert.equal(polygonClipping.difference(envelope, [campus.boundary]).length, 0, 'The whole display fits inside the school boundary');
  for (const court of courts) {
    assert.equal(polygonClipping.intersection(envelope, polygon(court.surface)).length, 0,
      'The airplane leaves every actual playing rectangle and its court markings free');
  }
  for (const road of campus.features.filter(feature => feature.type === 'path' && feature.points && !feature.representedBy)) {
    assert.equal(polygonClipping.intersection(envelope, polygon(passageFootprint(road.points, road.width || 3))).length, 0,
      `The full display envelope clears the visible road ${road.id}`);
  }
  const distanceToSegment = (p, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
  };
  const gap = Math.min(...aircraft.outer.flatMap(p => courts.flatMap(court => court.surface.outer.slice(1)
    .map((b, i) => distanceToSegment(p, court.surface.outer[i], b)))));
  assert.ok(gap < 20, 'The aircraft remains in the photographed strip beside the courts');
  assert.ok(!campusLocations(campus, site).some(location => location.id === aircraft.id));
  const regenerated = applyCampusCorrections(campus, await read('data/campus-corrections.json'));
  assert.deepEqual(regenerated.features.find(feature => feature.id === aircraft.id), aircraft,
    'Both the model calibration and its clear footprint survive map regeneration');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { garageRampFootprint, garageRampGeometry } from '../src/garage-ramp-geometry.ts';
import { laboratoryGarageLayout } from '../src/laboratory-garage-geometry.ts';
import { laboratoryLayout } from '../src/laboratory-geometry.ts';
import { undergroundVolume } from '../src/underground-mesh.ts';
import { pointOnStairTread } from '../src/structure-geometry.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const building = campus.buildings.find(item => item.id === 'way/855459411');
const entrance = campus.features.find(item => item.id === 'local/laboratory-garage-entrance');
const polygon = shape => [shape.outer, ...shape.holes];
const area = polygons => polygons.reduce((sum, rings) => sum + rings.reduce((total, ring, i) => total + (i ? -1 : 1)
  * Math.abs(ring.slice(1).reduce((value, p, j) => value + ring[j][0] * p[1] - p[0] * ring[j][1], 0) / 2), 0), 0);

test('the laboratory basement has a real ramp opening, stays below ground and leaves the slope and surface building unchanged', () => {
  const before = JSON.stringify([building, entrance]);
  const layout = laboratoryLayout(building), garage = laboratoryGarageLayout(building, entrance);
  const anchored = laboratoryGarageLayout(building);
  assert.deepEqual(anchored.footprints, garage.footprints, 'Photo geometry reuses the same original calibrated opening');
  for (const [i, point] of anchored.rampBottomOpening.entries()) assert.ok(Math.hypot(point[0]
    - garage.rampBottomOpening[i][0], point[1] - garage.rampBottomOpening[i][1]) < 1e-6,
  'Deriving the entrance from the building preserves the same clear doorway');
  assert.equal(garage.footprints.length, 1, 'The garage remains one connected classroom-band basement');
  const ramp = polygon(garageRampFootprint(entrance));
  assert.ok(area(polygonClipping.intersection(garage.footprints.map(polygon), ramp)) < 1e-4,
    'A flat basement slab cannot fill or roof over the sloping driveway');
  assert.ok(area(polygonClipping.difference(garage.footprints.map(polygon), polygon(layout.rooms.at(-1)))) < 1e-4,
    'The basement stays beneath the existing occupied band');
  for (const [u, v] of [[49, 11], [51.5, 10.8], [53, 10.8], [48.8, 10.8]]) {
    const p = layout.at(u, v);
    assert.ok(garage.footprints.some(shape => pointOnStairTread(p, shape.outer)
      && !shape.holes.some(hole => pointOnStairTread(p, hole))), 'The opposite-side art anchors stand inside the basement');
  }
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const shell = undergroundVolume(garage.footprint, 2.7, [garage.rampBottomOpening], true);
  shell.rotateX(-Math.PI / 2); shell.translate(0, -3, 0);
  const enclosure = new THREE.Mesh(shell, material); enclosure.updateMatrixWorld();
  const parts = garageRampGeometry(entrance, true), driveway = new THREE.Mesh(parts.floor, material);
  driveway.updateMatrixWorld();
  try {
    assert.equal(parts.doorway.getAttribute('position')?.count ?? 0, 0, 'The old dark doorway no longer caps the connected garage');
    shell.computeBoundingBox();
    assert.ok(shell.boundingBox.max.y < 0, 'The entire garage shell remains underground');
    const [from, to] = entrance.points, axis = new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize();
    for (const side of [-1.9, 0, 1.9]) {
      const offset = new THREE.Vector3(-axis.z, 0, axis.x).multiplyScalar(side);
      const origin = new THREE.Vector3(to[0], -2, to[1]).add(offset).addScaledVector(axis, -1);
      assert.equal(new THREE.Raycaster(origin, axis, 0, 2).intersectObject(enclosure).length, 0,
        'The actual basement end wall has a full-width entrance at the driveway bottom');
    }
    for (const progress of [.01, .25, .5, .75, .99]) {
      const x = from[0] + (to[0] - from[0]) * progress, z = from[1] + (to[1] - from[1]) * progress;
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
      assert.equal(ray.intersectObject(enclosure).length, 0, 'No flat garage floor hides the driveway');
      const hit = ray.intersectObject(driveway)[0];
      assert.ok(hit && Math.abs(hit.point.y - (entrance.ramp.topHeight
        + (entrance.ramp.bottomHeight - entrance.ramp.topHeight) * progress)) < 2e-4, 'The original driveway descent is retained');
    }
    assert.equal(JSON.stringify([building, entrance]), before, 'Basement geometry leaves every original surface calibration unchanged');
  } finally { shell.dispose(); Object.values(parts).forEach(geometry => geometry.dispose()); material.dispose(); }
});

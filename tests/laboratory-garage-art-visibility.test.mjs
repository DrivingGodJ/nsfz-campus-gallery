import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { laboratoryLayout } from '../src/laboratory-geometry.ts';
import { garageRampGeometry } from '../src/garage-ramp-geometry.ts';
import { undergroundLayout } from '../src/underground-geometry.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';
import { photoInteriorGeometry, photoInteriorPlacements } from '../src/photo-interior-geometry.ts';
import { pointOnStairTread } from '../src/structure-geometry.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const building = campus.buildings.find(item => item.id === 'way/855459411');
const entrance = campus.features.find(item => item.id === 'local/laboratory-garage-entrance');
const garage = campus.features.find(item => item.id === building.basement.featureId);
const layout = laboratoryLayout(building);
const area = undergroundLayout(campus.features).areas.get(garage.id);
const at = (u, v, y) => { const point = layout.at(u, v); return new THREE.Vector3(point[0], y, point[1]); };
const cameras = [[54, 7.4, -1.4], [52, 6.5, -1.4]].map(values => at(...values));

function fixture() {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const details = undergroundDetailGeometry(garage, area.footprints, area.openings, area.connections);
  const ramp = garageRampGeometry(entrance, true);
  const art = photoInteriorGeometry(building, 21.6, 3.6, undefined, true);
  const mesh = (name, geometry) => { const object = new THREE.Mesh(geometry, material); object.name = name; object.updateMatrixWorld(); return object; };
  const blockers = [...Object.entries(details), ...Object.entries(ramp)].map(([kind, geometry]) => mesh(kind, geometry));
  const paintings = art.map(({ kind, geometry }) => mesh(kind, geometry));
  return { blockers, paintings, dispose() {
    Object.values(details).forEach(geometry => geometry.dispose());
    Object.values(ramp).forEach(geometry => geometry.dispose());
    art.forEach(({ geometry }) => geometry.dispose()); material.dispose();
  } };
}

function rayTo(camera, target, far = target.distanceTo(camera)) {
  return new THREE.Raycaster(camera, target.clone().sub(camera).normalize(), 0, far);
}

test('the whole art panel, canvas front and paint pots are visible from the actual garage bottom and walking aisle', () => {
  const model = fixture(), placements = photoInteriorPlacements(building);
  const floor = building.basement.floorElevation + .045;
  const sample = (item, u, v, y) => new THREE.Vector3(item.center[0] + item.axis[0] * u - item.axis[1] * v,
    floor + y, item.center[1] + item.axis[1] * u + item.axis[0] * v);
  const panel = placements.find(item => item.id === 'art-wall-panel');
  const canvas = placements.find(item => item.id === 'leaning-canvas');
  const pots = placements.find(item => item.id === 'paint-pots');
  const targets = [
    ...[-1.72, 0, 1.72].flatMap(u => [.45, 1.23, 2].map(y => ['panel', sample(panel, u, -.06, y)])),
    ...[-.48, 0, .48].flatMap(u => [.45, .76, 1.26].map(y => ['canvas', sample(canvas, u, -.1, y)])),
    ...[-.46, -.23, 0, .23, .46].map(u => ['paint pot', sample(pots, u, 0, .13)]),
  ];
  try {
    for (const camera of cameras) {
      assert.ok(area.footprints.some(shape => pointOnStairTread([camera.x, camera.z], shape.outer)
        && !shape.holes.some(hole => pointOnStairTread([camera.x, camera.z], hole))), 'The camera is in the ordinary garage, rather than behind its wall');
      const down = new THREE.Raycaster(camera, new THREE.Vector3(0, -1, 0));
      const floorHit = down.intersectObjects(model.blockers)[0];
      assert.ok(floorHit && Math.abs(floorHit.point.y - floor) < 1e-4, 'The normal eye-height viewpoint stands over the actual basement floor');
      for (const [name, target] of targets) {
        const sightline = rayTo(camera, target, target.distanceTo(camera) + .25);
        const paintedHit = sightline.intersectObjects(model.paintings)[0];
        assert.ok(paintedHit, `The ${name} sample intersects the actual painted model`);
        assert.ok(Math.abs(paintedHit.distance - target.distanceTo(camera)) < .25, 'The hit belongs to this foreground sample, not an unrelated object farther behind');
        sightline.far = paintedHit.distance - .01;
        assert.equal(sightline.intersectObjects(model.blockers).length, 0, `The ${name} front has no intervening garage wall, retaining wall or ceiling`);
      }
    }
  } finally { model.dispose(); }
});

test('the former art position beyond the ramp bottom is blocked from those same normal viewpoints', () => {
  const model = fixture(), oldFront = at(58, 10.94, -1.725);
  try {
    for (const camera of cameras) {
      const hits = rayTo(camera, oldFront, oldFront.distanceTo(camera) - .01).intersectObjects(model.blockers);
      assert.ok(hits.some(hit => hit.object.name === 'rightWall'), 'The real driveway retaining wall catches the former hidden placement');
      assert.ok(hits.some(hit => hit.object.name === 'walls'), 'The garage notch wall also blocks the former placement');
    }
  } finally { model.dispose(); }
});

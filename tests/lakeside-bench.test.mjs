import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { benchGeometry } from '../src/bench-geometry.ts';
import { directionVector, photoFieldOfView } from '../src/photo-view.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const feature = campus.features.find(item => item.id === 'local/teaching-lakeside-bench');

test('the photographed backless bench meets the ground on both feet and has a usable low seat', () => {
  assert.ok(feature?.bench, 'The independent lakeside bench is present in the map');
  const model = feature.bench, geometry = benchGeometry(model), bounds = new THREE.Box3();
  try {
    for (const part of Object.values(geometry)) {
      bounds.union(part.boundingBox);
      assert.equal(part.userData.photoOcclusionMask, undefined, 'The real seat and supports keep normal depth occlusion');
    }
    assert.ok(Math.abs(bounds.min.y) < 1e-6 && Math.abs(bounds.max.y - model.seatHeight) < 1e-6,
      'There is no floating base or invented backrest');
    const feet = new THREE.Mesh(geometry.supports, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    feet.position.y = feature.height ?? .02; feet.updateMatrixWorld();
    for (const x of [-model.length * .3, model.length * .3]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, -1, 0), new THREE.Vector3(0, 1, 0)).intersectObject(feet)[0];
      assert.ok(hit && Math.abs(hit.point.y - .02) < 1e-6, 'Both legs touch the campus ground surface');
    }
    feet.material.dispose();
  } finally { Object.values(geometry).forEach(part => part.dispose()); }
});

test('the added seat appears in the foreground of its actual reference photograph and is raycastable', () => {
  assert.ok(feature?.bench);
  const photo = site.photos.find(item => item.id === 'e69cd3af-74a7-4f32-8577-4f654b6aba23');
  assert.ok(photo && photoFieldOfView(photo));
  const model = feature.bench, geometry = benchGeometry(model), material = new THREE.MeshBasicMaterial();
  const camera = new THREE.PerspectiveCamera(photoFieldOfView(photo).vertical, photo.width / photo.height, .08, 200);
  camera.position.set(photo.position.x, photo.cameraHeight ?? 1.6, photo.position.z);
  camera.lookAt(camera.position.clone().add(new THREE.Vector3(...directionVector(photo.heading, photo.pitch))));
  camera.updateMatrixWorld();
  const seat = new THREE.Mesh(geometry.seat, material);
  seat.position.set(model.center[0], feature.height ?? .02, model.center[1]);
  seat.rotation.y = -Math.atan2(model.axis[1], model.axis[0]); seat.updateMatrixWorld();
  try {
    const center = seat.localToWorld(new THREE.Vector3(0, model.seatHeight, 0)), projected = center.clone().project(camera);
    assert.ok(Math.abs(projected.x) < 1 && projected.y > -1 && projected.y < 0 && projected.z > -1 && projected.z < 1,
      'The existing photo calibration places the bench inside the lower part of the frame');
    const ray = new THREE.Raycaster(camera.position, center.clone().sub(camera.position).normalize());
    const hit = ray.intersectObject(seat)[0];
    assert.ok(hit && hit.distance < 10 && Math.abs(hit.point.y - ((feature.height ?? .02) + model.seatHeight)) < 1e-5,
      'The reference camera actually sees the wood seat rather than an empty envelope');
  } finally { Object.values(geometry).forEach(part => part.dispose()); material.dispose(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { laboratoryBodyGeometry, laboratoryLayout, laboratoryWindows } from '../src/laboratory-geometry.ts';
import { campusExteriorGeometry } from '../src/campus-exterior-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = id => campus.buildings.find(b => b.id === id);
const dispose = model => Object.values(model).forEach(geometry => geometry.dispose());

// These candidates were rejected after reading the actual photographs, rather
// than inferred from the camera ray or another building in the same group.
test('unconfirmed buildings persist as masonry and cannot regenerate generic glass after map refresh', () => {
  for (const id of ['way/1233313436', 'way/1233313437', 'way/1233313435', 'local/unknown-west-corner', 'way/1277841229', 'local/stand-office', 'way/855459421']) {
    const b = building(id), info = buildingLevels(b, site.buildingOverrides[id]);
    assert.equal(corrections.buildings.find(b => b.id === id).classroomWindows, null);
    const windows = teachingWindowGeometry(b, info.sections, info.floorHeight);
    const exterior = campusExteriorGeometry(b, info.floors, info.floorHeight);
    try {
      assert.equal(windows.glass.attributes.position.count, 0, `${id} has no guessed panes`);
      assert.equal(exterior.glass.attributes.position.count, 0, `${id} has no fallback glass`);
    } finally { dispose(windows); dispose(exterior); }
  }
});

test('the photographed sixth-floor laboratory stair window has one aperture, four lower lights and two upper lights', () => {
  const b = building('way/855459411'), info = buildingLevels(b, site.buildingOverrides[b.id]);
  const windows = laboratoryWindows(b, info.height, info.floorHeight);
  assert.equal(windows.length, 1, 'No unconfirmed classroom facade inherits this stair photo');
  const [window] = windows;
  assert.deepEqual(window.mullions, [0, .25, .5, .75, 1]);
  assert.deepEqual(window.upperMullions, [0, .5, 1]);
  assert.ok(Math.abs(window.bottom - (5 * info.floorHeight + 1)) < 1e-6);
  assert.deepEqual(laboratoryWindows(b, 5 * info.floorHeight, info.floorHeight), [], 'Unknown lower floors do not inherit the sixth-floor window');
  const geometry = laboratoryBodyGeometry(b, info.height, info.floorHeight), target = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  target.rotation.x = -Math.PI / 2; target.position.y = .12; target.updateMatrixWorld();
  const layout = laboratoryLayout(b), edge = layout.stair.opening.outer.slice(0, 2), dx = edge[1][0] - edge[0][0], dz = edge[1][1] - edge[0][1], length = Math.hypot(dx, dz);
  const normal = new THREE.Vector3(-dz / length, 0, dx / length);
  const eye = new THREE.Vector3((window.from[0] + window.to[0]) / 2, .12 + (window.bottom + window.top) / 2, (window.from[1] + window.to[1]) / 2).addScaledVector(normal, -.55);
  try {
    assert.equal(new THREE.Raycaster(eye, normal, 0, 1.1).intersectObject(target).length, 0, 'The glass occupies a real opening in the stair rear wall');
    eye.y -= info.floorHeight;
    assert.ok(new THREE.Raycaster(eye, normal, 0, 1.1).intersectObject(target).length, 'The same unconfirmed fifth-floor wall remains solid');
  } finally { geometry.dispose(); target.material.dispose(); }
});

test('theatre glazing is limited to the photographed outer curtain wall below the open fifth-floor terrace', () => {
  const b = building('local/theatre'), info = buildingLevels(b, site.buildingOverrides[b.id]);
  for (const section of info.sections) {
    const model = teachingWindowGeometry(b, [section], info.floorHeight);
    try {
      const p = model.glass.attributes.position;
      assert.equal(p.count > 0, section.id === 'curved-terrace', 'Neither laboratory connection nor inner auditorium wall gains glass');
      for (let i = 0; i < p.count; i++) assert.ok(p.getY(i) < .12 + 4 * info.floorHeight, 'Fifth-floor terrace stays open');
    } finally { dispose(model); }
  }
});

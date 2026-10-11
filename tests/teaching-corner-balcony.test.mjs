import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingGeometry } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingCornerBalconyLayout, teachingRailGeometry } from '../src/architecture-geometry.ts';
import { teachingDetailGeometry } from '../src/teaching-details.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(item => item.id === 'way/855459420');
const info = buildingLevels(building, site.buildingOverrides[building.id]);
const section = info.sections.find(item => item.id === 'main'), layout = teachingCornerBalconyLayout(section);
const BASE = .12;
const point = ([x, z], y) => new THREE.Vector3(x, y, z);
const vector = ([x, z]) => new THREE.Vector3(x, 0, z);
const mesh = geometry => { const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); object.updateMatrixWorld(); return object; };
const dispose = geometry => Object.values(geometry).forEach(part => part.dispose());

test('the photo-confirmed three-metre quarter-circle slab occupies only the second-floor southeast atrium corner', () => {
  assert.deepEqual(layout.corner, [119.8864, 56.2645]);
  assert.equal(layout.radius, 3);
  const original = JSON.stringify({ building, photos: site.photos });
  const sample = vector(layout.u).add(vector(layout.v)).multiplyScalar(1.2).add(point(layout.corner, 0));
  for (const cutoff of [undefined, info.floorHeight, 2 * info.floorHeight, 5 * info.floorHeight]) {
    const details = teachingDetailGeometry(building, info.sections, info.floorHeight, cutoff), slab = mesh(details.columns);
    try {
      for (let floor = 1; floor <= 5; floor++) {
        const origin = sample.clone(); origin.y = BASE + (floor - 1) * info.floorHeight + .9;
        const hit = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 1).intersectObject(slab)[0];
        const present = floor === 2 && (cutoff === undefined || cutoff > info.floorHeight);
        assert.equal(!!hit, present, `The corner slab ${present ? 'exists' : 'does not repeat'} on floor ${floor}`);
        if (hit) assert.ok(Math.abs(hit.point.y - (BASE + info.floorHeight + .25)) < 1e-4);
      }
      if (cutoff !== info.floorHeight) {
        const positions = details.columns.getAttribute('position'), normals = details.columns.getAttribute('normal');
        let area = 0;
        for (let i = 0; i < positions.count; i += 3) {
          const a = new THREE.Vector3().fromBufferAttribute(positions, i), b = new THREE.Vector3().fromBufferAttribute(positions, i + 1), c = new THREE.Vector3().fromBufferAttribute(positions, i + 2);
          if ([a, b, c].every(p => Math.abs(p.y - (BASE + info.floorHeight + .25)) < 1e-4) && normals.getY(i) > .9) area += b.sub(a).cross(c.sub(a)).length() / 2;
        }
        assert.ok(Math.abs(area - Math.PI * 3 ** 2 / 4) < .02, 'The added top area is one quarter of a radius-three circle');
      }
      assert.ok(details.columns.userData.photoOcclusionMask.every(value => value === 0), 'The thin corridor platform keeps photo visibility');
    } finally { dispose(details); slab.material.dispose(); }
  }
  assert.equal(JSON.stringify({ building, photos: site.photos }), original, 'No courtyard outline or photograph calibration changes');
});

test('the second-floor platform meets both original walkways without a gap or step', () => {
  const height = 2 * info.floorHeight, details = teachingDetailGeometry(building, info.sections, info.floorHeight, height);
  const body = buildingGeometry(section, height, info.floorHeight, building.groundPassages,
    building.floorCorridors.filter(item => item.partId === section.id), building.stairwells.filter(item => item.partId === section.id),
    building.classroomWindows, building.solidCores.filter(item => item.partId === section.id), building.cutouts.filter(item => item.partId === section.id), true);
  body.rotateX(-Math.PI / 2); body.translate(0, BASE, 0);
  const original = mesh(body), added = mesh(details.columns);
  try {
    for (const [along, across] of [[layout.u, layout.v], [layout.v, layout.u]]) for (const offset of [-.02, .02]) {
      const origin = point(layout.corner, BASE + info.floorHeight + .9).addScaledVector(vector(along), 1.5).addScaledVector(vector(across), offset);
      const hit = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 1).intersectObjects([original, added])[0];
      assert.ok(hit, 'Both sides of each platform/walkway joint have a floor');
      assert.ok(Math.abs(hit.point.y - (BASE + info.floorHeight + .25)) < 1e-4, 'The original and curved slabs share the same top');
    }
  } finally { body.dispose(); dispose(details); original.material.dispose(); added.material.dispose(); }
});

test('the old second-floor straight guards are replaced by a curved blue guard while higher-floor corners stay straight', () => {
  const details = teachingDetailGeometry(building, info.sections, info.floorHeight), detailRails = mesh(details.rails);
  const guards = mesh(teachingRailGeometry(building, info.sections, info.floorHeight));
  try {
    for (const [along, across] of [[layout.u, layout.v], [layout.v, layout.u]]) for (const floor of [2, 3, 4, 5]) {
      const center = point(layout.corner, BASE + (floor - 1) * info.floorHeight + .25).addScaledVector(vector(along), 1.5).addScaledVector(vector(across), -.09);
      const direction = vector(across).negate();
      for (const [object, rise] of [[guards, 1.05], [detailRails, .28]]) {
        const origin = center.clone().addScaledVector(vector(across), .25); origin.y += rise;
        assert.equal(new THREE.Raycaster(origin, direction, 0, .5).intersectObject(object).length > 0, floor > 2, 'Only the second-floor corner loses the blocking straight guard');
      }
    }
    const radial = vector(layout.u).add(vector(layout.v)).normalize();
    for (const floor of [1, 2, 3, 4, 5]) for (const [object, rise] of [[guards, 1.05], [detailRails, .28]]) {
      const origin = point(layout.guardAt(.5), BASE + (floor - 1) * info.floorHeight + .25 + rise).addScaledVector(radial, .25);
      assert.equal(new THREE.Raycaster(origin, radial.clone().negate(), 0, .5).intersectObject(object).length > 0, floor === 2, 'The curved handrail and its lower detail occur only on floor two');
    }
    assert.ok(guards.geometry.userData.photoOcclusionMask.every(value => value === 0));
  } finally { dispose(details); guards.geometry.dispose(); guards.material.dispose(); detailRails.material.dispose(); }
});

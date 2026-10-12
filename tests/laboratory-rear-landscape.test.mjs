import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { passageShape } from '../src/building-geometry.ts';
import { laboratoryRearLandscape } from '../src/laboratory-rear-landscape.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const lab = campus.buildings.find(b => b.id === 'way/855459411');

test('the rear tiled walk joins across the facade setback without occupying rooms or blocking the existing road', () => {
  const saved = JSON.stringify(lab), model = laboratoryRearLandscape(lab);
  const roadShapes = lab.groundPassages.map(passageShape);
  try {
    const paving = polygonClipping.union(...model.footprints.map(ring => [ring]));
    assert.equal(paving.length, 1, 'The walk connects both photographed facade segments');
    for (const building of campus.buildings) assert.deepEqual(polygonClipping.intersection(paving, [building.outer, ...building.holes]), [], 'The paving stays outside all existing buildings');
    for (const tree of model.trees) {
      const [x, z] = tree.position, pit = [[x - .9, z - .9], [x + .9, z - .9], [x + .9, z + .9], [x - .9, z + .9], [x - .9, z - .9]];
      for (const road of roadShapes) assert.deepEqual(polygonClipping.intersection([pit], [road.outer, ...road.holes]), [], 'No tree pit occupies the existing four-metre road');
    }
    const target = new THREE.Mesh(model.geometry.curbs, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    target.updateMatrixWorld();
    for (const passage of lab.groundPassages) for (let i = 1; i < passage.points.length; i++) {
      const [a, b] = passage.points.slice(i - 1, i + 1), dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      for (const offset of [-1.8, 0, 1.8]) {
        const ray = new THREE.Raycaster(new THREE.Vector3(a[0] - dz / length * offset, .13, a[1] + dx / length * offset), new THREE.Vector3(dx / length, 0, dz / length), 0, length);
        assert.equal(ray.intersectObject(target).length, 0, 'Tree edging and outer curbs leave the full through-road clear');
      }
    }
    target.material.dispose();
    for (const geometry of Object.values(model.geometry)) assert.ok(geometry.userData.photoOcclusionMask.every(value => value === 0));
    assert.equal(JSON.stringify(lab), saved, 'Rendering preserves the approved model data');
  } finally { Object.values(model.geometry).forEach(geometry => geometry.dispose()); }
});

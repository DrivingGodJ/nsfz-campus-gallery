import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { undergroundDetailGeometry } from '../src/underground-details.ts';

const hall = { id: 'local/underground-badminton', type: 'undergroundRoom', height: -3.8, wallHeight: 6.2,
  outer: [[0, 0], [35, 0], [35, 87.4], [0, 87.4], [0, 0]], holes: [] };
function inspect(feature, openings, check) {
  const model = undergroundDetailGeometry(feature, undefined, openings);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = Object.fromEntries(Object.entries(model).map(([kind, geometry]) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld(); return [kind, mesh];
  }));
  const hits = (kind, x, y, z) => new THREE.Raycaster(new THREE.Vector3(x - .3, y, z), new THREE.Vector3(1, 0, 0), 0, .6).intersectObject(meshes[kind]);
  try { check(hits); } finally { Object.values(model).forEach(geometry => geometry.dispose()); material.dispose(); }
}

test('the photographed high window band survives short exterior panels, with real daylight openings and complete frames', () => {
  const door = [[0, 1], [0, 5]]; door.height = 2.7;
  inspect(hall, [door], hits => {
    for (const z of [.21, 3.17, 6.37]) {
      assert.equal(hits('walls', 0, 1.8, z).length, 0, 'Solid wall does not fill the high glass');
      assert.ok(hits('glass', 0, 1.8, z).length, 'Short corner and door-head panels retain the window band');
      for (const y of [1.45, 2.2]) assert.ok(hits('metal', 0, y, z).length, 'Upper and lower window frames are present');
    }
    assert.ok(hits('walls', 0, -2.8, .21).length, 'The lower exterior remains a solid wall');
    for (const kind of ['walls', 'metal', 'glass']) assert.equal(hits(kind, 0, -2.2, 3.17).length, 0, 'Frames and walls leave the real door clear');
  });
});

test('lower stair roofs do not create glass windows in interior roof seams', () => {
  const feature = { ...hall, ceilingCutouts: [{ height: 3.84,
    footprint: { outer: [[0, 0], [4, 0], [4, 20], [0, 20], [0, 0]], holes: [] } }] };
  inspect(feature, [], hits => {
    assert.equal(hits('glass', 4, 1.8, 10).length, 0, 'The internal high seam is never treated as an exterior window');
    assert.ok(hits('walls', 4, 1.8, 10).length, 'A real upper partition remains above the low roof');
    assert.equal(hits('walls', 0, 1.8, 25).length, 0);
    assert.ok(hits('glass', 0, 1.8, 25).length, 'The original exterior window continues beyond the low stair area');
  });
});

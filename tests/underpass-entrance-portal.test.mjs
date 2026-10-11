import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { curvedStairPoint, entrancePortalLayout } from '../src/structure-geometry.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));

test('the entrance has broad solid piers and a lintel, facing the approach while keeping the full stair opening clear', () => {
  const entrance = campus.features.find(feature => feature.id === 'local/underpass-entrance');
  const before = JSON.stringify(entrance), stair = entrance.curvedStair, layout = entrancePortalLayout(stair);
  assert.deepEqual(layout.position, curvedStairPoint(stair, 0), 'The portal stays at the approved stair entry');
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const group = new THREE.Group(); group.position.set(...layout.position); group.rotation.y = layout.rotation;
  for (const box of layout.boxes) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.size), material);
    mesh.position.set(...box.position); group.add(mesh);
  }
  group.updateMatrixWorld(true);
  const front = new THREE.Vector3(0, 0, 1).transformDirection(group.matrixWorld);
  const expected = new THREE.Vector3(Math.sin(stair.startAngle), 0, -Math.cos(stair.startAngle)).multiplyScalar(Math.sign(stair.sweep));
  assert.ok(front.distanceTo(expected) < 1e-8, 'The red inscription faces out toward the existing approach');
  const shoot = (x, y) => {
    const eye = group.localToWorld(new THREE.Vector3(x, y, 1));
    return new THREE.Raycaster(eye, front.clone().negate(), 0, 2).intersectObjects(group.children);
  };
  try {
    for (const x of [-stair.width * .49, 0, stair.width * .49]) assert.equal(shoot(x, 1.6).length, 0, 'Wide piers never narrow the stair route');
    assert.ok(shoot(0, 2.66).length, 'The photographed header is an opaque beam, not an empty frame');
    for (const side of [-1, 1]) assert.ok(shoot(side * (stair.width / 2 + .31), 1.6).length, 'Both broad side piers are solid');
    assert.equal(group.children.length, 3);
    assert.equal(JSON.stringify(entrance), before, 'Appearance changes do not move the entrance or bend its tunnel');
  } finally { group.children.forEach(mesh => mesh.geometry.dispose()); material.dispose(); }
});

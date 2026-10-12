import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { bridgeRailGeometry } from '../src/bridge-rail-geometry.ts';
import { curvedStairPoint } from '../src/structure-geometry.ts';
import { undergroundEntranceStair } from '../src/underground-geometry.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';
import { undergroundRailGeometry } from '../src/underground-rail-geometry.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const mesh = geometry => { const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); object.updateMatrixWorld(); return object; };

test('stainless guards have frequent slender vertical bars, a lower crossbar, and the existing top height', () => {
  const geometry = undergroundRailGeometry([[[0, 0, 0], [6, 0, 0]]]), object = mesh(geometry);
  const across = (x, y) => new THREE.Raycaster(new THREE.Vector3(x, y, -.1), new THREE.Vector3(0, 0, 1), 0, .2).intersectObject(object);
  try {
    geometry.computeBoundingBox();
    assert.ok(Math.abs(geometry.boundingBox.max.y - 1.065) < 1e-6);
    assert.ok(Math.abs(geometry.boundingBox.min.y) < 1e-6);
    for (let x = .18; x < 6; x += .18) assert.ok(across(x, .6).length, 'Each 18 cm interval has a slim vertical picket');
    for (const x of [.09, 1.17, 2.97, 4.77]) {
      assert.equal(across(x, .6).length, 0, 'Pickets keep visible gaps rather than becoming a solid wall');
      assert.ok(across(x, .15).length, 'The photographed lower horizontal bar is continuous');
      assert.ok(across(x, 1.03).length, 'The slim top handrail is continuous');
    }
  } finally { geometry.dispose(); object.material.dispose(); }
});

test('the actual curved entrance retains both rail routes and height envelopes while keeping its center clear', () => {
  const feature = campus.features.find(item => item.id === 'local/underpass-entrance'), stair = feature.curvedStair, before = JSON.stringify(feature);
  const chains = [-1, 1].map(side => Array.from({ length: stair.steps + 1 }, (_, i) => curvedStairPoint(stair, i / stair.steps, stair.radius + side * (stair.width / 2 - .12))));
  const old = bridgeRailGeometry(chains, true), geometry = undergroundRailGeometry(chains), object = mesh(geometry);
  try {
    const previous = new THREE.Box3();
    for (const part of Object.values(old)) { part.computeBoundingBox(); previous.union(part.boundingBox); }
    geometry.computeBoundingBox();
    assert.ok(Math.abs(geometry.boundingBox.max.y - previous.max.y) < 1e-6, 'The entrance rail height is unchanged');
    assert.ok(Math.abs(geometry.boundingBox.min.y - previous.min.y) < 1e-6, 'Posts still reach the same stair bases');
    const vertices = geometry.attributes.position;
    for (let i = 0; i < vertices.count; i++) {
      const radius = Math.hypot(vertices.getX(i) - stair.center[0], vertices.getZ(i) - stair.center[1]);
      assert.ok(Math.abs(radius - stair.radius) > stair.width / 2 - .16, 'Neither guard intrudes into the center walking lane');
    }
    for (const t of [.05, .25, .5, .75, .95]) {
      const p = curvedStairPoint(stair, t), eye = new THREE.Vector3(p[0], p[1] + .6, p[2]);
      assert.equal(new THREE.Raycaster(eye, new THREE.Vector3(0, 1, 0), 0, 1.6).intersectObject(object).length, 0, 'The route remains open above every curved tread');
    }
    assert.equal(JSON.stringify(feature), before);
  } finally { Object.values(old).forEach(part => part.dispose()); geometry.dispose(); object.material.dispose(); }
});

test('the corridor exit uses the same metal style at its original stair height, leaving the door and central treads clear', () => {
  const feature = campus.features.find(item => item.id === 'local/underground-corridor'), before = JSON.stringify(feature), stair = undergroundEntranceStair(feature);
  const model = undergroundDetailGeometry(feature), guard = mesh(model.rails);
  try {
    model.rails.computeBoundingBox();
    assert.ok(Math.abs(model.rails.boundingBox.max.y - stair.topHeight - 1.045) < 1e-6);
    assert.ok(Math.abs(model.rails.boundingBox.min.y - stair.bottomHeight) < 1e-6);
    for (const t of [.02, .25, .5, .75, .98]) {
      const p = stair.at(stair.length * t), y = stair.topHeight + (stair.bottomHeight - stair.topHeight) * t;
      assert.equal(new THREE.Raycaster(new THREE.Vector3(p[0], y + .6, p[1]), new THREE.Vector3(0, 1, 0), 0, 1).intersectObject(guard).length, 0);
    }
    assert.equal(JSON.stringify(feature), before, 'No entrance, passage or step coordinates move');
  } finally { Object.values(model).forEach(part => part.dispose()); guard.material.dispose(); }
});

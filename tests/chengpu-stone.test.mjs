import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import fs from 'node:fs';
import clip from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { passageFootprint } from '../src/underground-geometry.ts';
import { riverBenches } from '../src/river-landscape.ts';
import { mottoStoneGeometry, mottoStoneInscriptionGeometry, mottoStoneLayout, mottoStoneRotation, mottoStoneWorldPoint } from '../src/motto-stone-geometry.ts';

test('the upright Chengpu stone stands alone and its vertical inscription faces forward without flipped UVs', () => {
  const model = { center: [68.65, 9.35], axis: [.6, .8], width: 2.5, depth: .9, totalHeight: 2.25,
    variant: 'upright', inscription: '誠樸', profile: [[-.5, 0], [-.5, .55], [-.35, 1], [-.15, .96], [.25, .7], [.5, .35], [.5, 0]] };
  const layout = mottoStoneLayout(model), legacy = mottoStoneLayout({ ...model, variant: undefined });
  assert.equal(layout.baseRocks.length, 0, 'No scattered-rock pedestal is added to this upright stone');
  assert.ok(layout.sign.size[0] < layout.sign.size[1], 'The two characters occupy a tall, narrow face');
  assert.equal(legacy.baseRocks.length, 3);
  assert.deepEqual(legacy.sign.size, [model.width * .84, model.totalHeight * .57], 'Existing horizontal stones retain their original lettering dimensions');
  assert.deepEqual(layout.outline, model.profile.map(([x, y]) => [x * model.width, y * model.totalHeight]));
  const geometry = mottoStoneGeometry(model), sign = mottoStoneInscriptionGeometry(model);
  const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const body = new THREE.Mesh(geometry, material), label = new THREE.Mesh(sign, material);
  for (const mesh of [body, label]) { mesh.position.set(model.center[0], .12, model.center[1]); mesh.rotation.y = mottoStoneRotation(model); mesh.updateMatrixWorld(); }
  try {
    geometry.computeBoundingBox();
    const positions = sign.getAttribute('position'), normals = sign.getAttribute('normal'), uv = sign.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
      assert.ok(positions.getZ(i) > geometry.boundingBox.max.z + .02, 'Lettering stays clear of the stone face');
      assert.equal(normals.getZ(i), 1);
      assert.equal(uv.getX(i), positions.getX(i) < 0 ? 0 : 1);
      assert.equal(uv.getY(i), positions.getY(i) < layout.sign.position[1] ? 0 : 1, 'The first painted character stays at the top');
    }
    const center = new THREE.Vector3(...mottoStoneWorldPoint(model, [0, layout.sign.position[1] + .12, 0]));
    const front = new THREE.Vector3(-model.axis[1], 0, model.axis[0]);
    const frontHits = new THREE.Raycaster(center.clone().addScaledVector(front, 5), front.clone().negate()).intersectObjects([body, label]);
    assert.equal(frontHits[0].object, label);
    assert.equal(new THREE.Raycaster(center.clone().addScaledVector(front, -5), front).intersectObject(label).length, 0, 'No reversed inscription appears on the rear');
  } finally { geometry.dispose(); sign.dispose(); material.dispose(); }
});

test('the marked tree is replaced by the Chengpu stone with its adjacent benches removed and the neighbouring tree and paths retained', () => {
  const read = file => JSON.parse(fs.readFileSync(new URL('../' + file, import.meta.url)));
  const campus = read('public/data/campus.json'), stone = campus.features.find(f => f.id === 'local/chengpu-stone');
  const trees = campus.features.find(f => f.id === 'local/river-bank-trees').trees;
  assert.deepEqual(stone.stone.center, [68.65, 9.35]);
  assert.equal(stone.stone.variant, 'upright');
  assert.equal(stone.stone.inscription, '誠樸');
  assert.ok(!trees.some(t => t.position[0] === 68.65 && t.position[1] === 9.35));
  const neighbour = trees.find(t => t.position[0] === 71 && t.position[1] === 15.35);
  assert.ok(neighbour, 'The neighbouring tree remains on this bank at the later marked ring-seat position');
  assert.equal(neighbour.radius, 2.25);
  assert.ok(Math.abs(neighbour.height - 9.95) < 1e-10);
  for (const path of campus.features.filter(f => f.type === 'path' && f.points && !f.representedBy)) {
    assert.equal(clip.intersection([stone.outer], [passageFootprint(path.points, path.width || 3).outer]).length, 0, path.id + ' remains open');
  }
  for (const z of [7.5, 11.2]) {
    assert.ok(!riverBenches.some(b => b.center[0] === 68.65 && b.center[1] === z));
  }
  assert.ok(riverBenches.some(b => b.center[0] === 111.5 && b.center[1] === -.016), 'The unrelated main-road bench stays');
  assert.deepEqual(applyCampusCorrections(campus, read('data/campus-corrections.json')), campus);
});

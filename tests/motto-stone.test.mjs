import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import clip from 'polygon-clipping';
import * as THREE from 'three';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { campusLocations } from '../src/locations.ts';
import { passageFootprint } from '../src/underground-geometry.ts';
import { mottoStoneGeometry, mottoStoneInscriptionGeometry, mottoStoneRotation, mottoStoneWorldPoint } from '../src/motto-stone-geometry.ts';
import { pavilionGeometry, PAVILION_BASE } from '../src/pavilion-geometry.ts';

const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
const campus = await read('public/data/campus.json'), site = await read('public/data/site.json');
const stone = campus.features.find(f => f.id === 'local/motto-stone'), model = stone.stone;
const polygon = shape => [shape.outer, ...(shape.holes || [])];

test('the centenary stone stays on the history pavilion steps, faces the forecourt, and leaves the paths open', () => {
  const feature = campus.features.find(f => f.id === 'local/centenary-stone');
  const pavilion = campus.buildings.find(b => b.id === 'way/1233313451');
  const body = pavilionGeometry(pavilion.appearance, 4.5);
  assert.equal(clip.difference(polygon(feature), polygon(pavilion)).length, 0, 'The base is supported by the terrace');
  for (const shape of [body.core, body.rearWing]) assert.equal(clip.intersection(polygon(feature), polygon(shape)).length, 0, 'The stone does not enter the pavilion');
  for (const path of campus.features.filter(f => f.type === 'path' && f.points && !f.representedBy)) {
    assert.equal(clip.intersection(polygon(feature), polygon(passageFootprint(path.points, path.width || 3))).length, 0, path.id + ' stays open');
  }
  assert.equal(feature.height + .12, PAVILION_BASE);
  const front = new THREE.Vector2(-feature.stone.axis[1], feature.stone.axis[0]);
  const forecourt = new THREE.Vector2(1.1 - feature.stone.center[0], 6.7 - feature.stone.center[1]).normalize();
  assert.ok(front.dot(forecourt) > .95, 'The inscription faces the entrance approach');
  assert.equal(feature.stone.inscription, '百年碑');
  assert.equal(feature.name, undefined, 'The landmark remains part of the existing history pavilion destination');
});

test('the motto stone occupies the marked dry bank, aligns with the shore, and faces its lettering into the lake', async () => {
  const lake = campus.features.find(f => f.id === 'way/855459418');
  assert.ok(Math.hypot(model.center[0] + 10.1, model.center[1] - 64.4) < 1, 'Position matches the circled bank using the photo markers as anchors');
  const [a, b] = lake.outer.slice(2, 4), tangent = new THREE.Vector2(b[0] - a[0], b[1] - a[1]).normalize();
  assert.ok(new THREE.Vector2(...model.axis).dot(tangent) > .99);
  assert.equal(clip.intersection(polygon(stone), polygon(lake)).length, 0, 'The whole stone and its base stay on dry land');
  for (const path of campus.features.filter(f => f.type === 'path' && f.points && !f.representedBy)) {
    assert.equal(clip.intersection(polygon(stone), polygon(passageFootprint(path.points, path.width || 3))).length, 0, path.id + ' stays clear');
  }
  const front = new THREE.Vector2(-model.axis[1], model.axis[0]);
  assert.ok(front.dot(new THREE.Vector2((a[0] + b[0]) / 2 - model.center[0], (a[1] + b[1]) / 2 - model.center[1])) > 3, 'Lettering faces the water, away from the nearby road');
  assert.equal(model.inscription, '誠樸雄偉');
  assert.ok(campusLocations(campus, site).some(location => location.id === stone.id));
  assert.deepEqual(applyCampusCorrections(campus, await read('data/campus-corrections.json')), campus);
});

test('the rock has one solid body and its lettering reads left to right only on the lake face without competing surfaces', () => {
  const geometry = mottoStoneGeometry(model), sign = mottoStoneInscriptionGeometry(model);
  const stoneMaterial = new THREE.MeshBasicMaterial(), signMaterial = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const body = new THREE.Mesh(geometry, stoneMaterial), label = new THREE.Mesh(sign, signMaterial);
  for (const mesh of [body, label]) { mesh.position.set(model.center[0], .12, model.center[1]); mesh.rotation.y = mottoStoneRotation(model); mesh.updateMatrixWorld(); }
  try {
    geometry.computeBoundingBox();
    assert.ok(geometry.boundingBox.min.z >= -model.depth / 2 - 1e-6);
    assert.ok(geometry.boundingBox.max.z <= model.depth / 2 + 1e-6);
    const positions = sign.getAttribute('position'), normals = sign.getAttribute('normal'), uv = sign.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
      assert.ok(positions.getZ(i) > geometry.boundingBox.max.z + .02, 'Lettering is outside the bevel, avoiding depth flicker');
      assert.equal(normals.getZ(i), 1);
      assert.equal(uv.getX(i), positions.getX(i) < 0 ? 0 : 1, 'Texture horizontal order is not mirrored');
    }
    const center = new THREE.Vector3(...mottoStoneWorldPoint(model, [0, model.totalHeight * .52 + .12, 0]));
    const front = new THREE.Vector3(-model.axis[1], 0, model.axis[0]);
    const frontHits = new THREE.Raycaster(center.clone().addScaledVector(front, 5), front.clone().negate()).intersectObjects([body, label]);
    assert.equal(frontHits[0].object, label, 'The lake view meets the readable inscription first');
    const backHits = new THREE.Raycaster(center.clone().addScaledVector(front, -5), front).intersectObject(label);
    assert.equal(backHits.length, 0, 'The rear face cannot show reversed letters');
  } finally { geometry.dispose(); sign.dispose(); stoneMaterial.dispose(); signMaterial.dispose(); }
});

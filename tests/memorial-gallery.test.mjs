import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { campusLocations } from '../src/locations.ts';
import { memorialGalleryGeometry } from '../src/memorial-gallery-geometry.ts';
import { bajinStatueGeometry } from '../src/bajin-statue-geometry.ts';

const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
const campus = await read('public/data/campus.json'), site = await read('public/data/site.json');
const gallery = campus.features.find(feature => feature.id === 'local/alumni-display-gallery');
const statue = campus.features.find(feature => feature.id === 'local/yuan-longping-statue');
const point = ([x, z], height) => new THREE.Vector3(x, height, z);

test('the alumni gallery and Yuan Longping portrait survive source map regeneration without adding selectable regions', async () => {
  assert.ok(gallery?.gallery && statue?.statue);
  assert.deepEqual(applyCampusCorrections(campus, await read('data/campus-corrections.json')), campus);
  const locations = campusLocations(campus, site);
  for (const feature of [gallery, statue]) {
    assert.equal(feature.hideLabel, true);
    assert.ok(!locations.some(location => location.id === feature.id), 'The photographed objects do not become new photo regions');
  }
  assert.equal(statue.statue.variant, 'yuanLongping');
  assert.ok(statue.statue.width >= .5 && statue.statue.width < 1 && statue.statue.depth >= .4 && statue.statue.depth < 1, 'The portrait has a small column footprint');
  assert.ok(statue.statue.totalHeight >= 2 && statue.statue.totalHeight <= 3, 'The portrait is a modest bust on a column, not an oversized monument');
});

test('the raised L-shaped gallery has usable entrance steps and an unobstructed route through both legs and the inner turn', () => {
  const original = JSON.stringify(gallery), geometry = memorialGalleryGeometry(gallery);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = Object.fromEntries(Object.entries(geometry).map(([name, part]) => {
    const mesh = new THREE.Mesh(part, material); mesh.updateMatrixWorld(); return [name, mesh];
  }));
  const down = new THREE.Vector3(0, -1, 0), height = gallery.height;
  const floorHeight = p => {
    const hits = new THREE.Raycaster(point(p, height + 1), down, 0, 2).intersectObject(meshes.floor);
    assert.ok(hits.length, 'The walking route and entrance treads have real upward-facing surfaces');
    return hits[0].point.y;
  };
  const clear = (from, to, eye) => {
    const a = point(from, eye), b = point(to, eye), length = a.distanceTo(b);
    const ray = new THREE.Raycaster(a, b.clone().sub(a).normalize(), .00001, length);
    for (const [name, mesh] of Object.entries(meshes)) assert.equal(ray.intersectObject(mesh).length, 0, `${name} leaves the walking line clear at eye height`);
  };
  try {
    assert.equal(gallery.points.length, 3, 'Two straight legs form the photographed L-shaped gallery');
    assert.ok(height > .15 && height < .5, 'The gallery is raised by only a few entrance steps');
    const legs = gallery.points.slice(1).map((end, i) => {
      const start = gallery.points[i], length = Math.hypot(end[0] - start[0], end[1] - start[1]);
      return { start, end, length, axis: [(end[0] - start[0]) / length, (end[1] - start[1]) / length] };
    });
    assert.ok(Math.abs(legs[0].axis[0] * legs[1].axis[0] + legs[0].axis[1] * legs[1].axis[1]) < .15, 'The two wings meet near a right angle');
    for (const leg of legs) {
      const from = leg.start.map((n, i) => n - leg.axis[i] * .1), to = leg.end.map((n, i) => n + leg.axis[i] * .1);
      for (const eye of [1.6, height + 1.6]) clear(from, to, eye);
      for (const fraction of [.1, .5, .9]) {
        const p = leg.start.map((n, i) => n + (leg.end[i] - n) * fraction);
        assert.ok(Math.abs(floorHeight(p) - height) < 1e-5, 'Both wings share the raised walking surface');
      }
    }
    const bend = gallery.points[1], incoming = bend.map((n, i) => n - legs[0].axis[i]), outgoing = bend.map((n, i) => n + legs[1].axis[i]);
    for (const eye of [1.6, height + 1.6]) clear(incoming, outgoing, eye);
    for (const fraction of [0, .5, 1]) {
      const p = incoming.map((n, i) => n + (outgoing[i] - n) * fraction);
      assert.ok(Math.abs(floorHeight(p) - height) < 1e-5, 'The inside turn has a continuous floor without a missing corner');
    }
    const last = legs.at(-1), entry = distance => last.end.map((n, i) => n + last.axis[i] * distance);
    const lower = floorHeight(entry(.45)), upper = floorHeight(entry(.15)), platform = floorHeight(entry(-.2));
    assert.ok(lower > .06 && upper > lower + .05 && platform > upper + .05, 'Two entrance treads rise gradually to the gallery platform');
    assert.ok(upper - lower < .15 && platform - upper < .15, 'The entrance avoids a single abrupt tall riser');
    assert.equal(JSON.stringify(gallery), original, 'Building the gallery leaves calibrated map data intact');
    let triangles = 0;
    for (const part of Object.values(geometry)) {
      assert.ok([...part.getAttribute('position').array].every(Number.isFinite));
      assert.ok([...part.getAttribute('normal').array].every(Number.isFinite));
      triangles += (part.index?.count ?? part.getAttribute('position').count) / 3;
    }
    assert.ok(Object.keys(geometry).length <= 7 && triangles < 6500, 'Frames and exhibition panels stay in a small set of merged meshes');
  } finally { material.dispose(); Object.values(geometry).forEach(part => part.dispose()); }
});

test('the integrated Yuan Longping portrait retains finite, low-cost geometry within its calibrated footprint and height', () => {
  const original = JSON.stringify(statue), geometry = bajinStatueGeometry(statue.statue), bounds = new THREE.Box3();
  try {
    let triangles = 0;
    for (const part of Object.values(geometry)) {
      assert.ok([...part.getAttribute('position').array].every(Number.isFinite));
      assert.ok([...part.getAttribute('normal').array].every(Number.isFinite));
      bounds.union(part.boundingBox);
      triangles += (part.index?.count ?? part.getAttribute('position').count) / 3;
    }
    const size = bounds.getSize(new THREE.Vector3());
    assert.ok(size.x <= statue.statue.width + 1e-6 && size.z <= statue.statue.depth + 1e-6);
    assert.ok(Math.abs(bounds.min.y) < 1e-6 && Math.abs(bounds.max.y - statue.statue.totalHeight) < 1e-6);
    assert.ok(triangles < 1600);
    assert.equal(JSON.stringify(statue), original);
  } finally { Object.values(geometry).forEach(part => part.dispose()); }
});

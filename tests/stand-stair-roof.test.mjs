import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { undergroundCeilingSections, undergroundFootprints } from '../src/underground-geometry.ts';
import { undergroundDetailGeometry, undergroundRoomFrame } from '../src/underground-details.ts';
import { sportsGroundPlatformLayers } from '../src/sports-ground-geometry.ts';
import { pointOnStairTread } from '../src/structure-geometry.ts';

test('a stand stair clears the podium and high room roof while retaining the lower roof and badminton floor', () => {
  const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
  const original = campus.features.find(feature => feature.id === 'local/underground-badminton');
  const { at } = undergroundRoomFrame(original), floor = original.height;
  const footprint = { outer: [at(0, 0), at(4, 0), at(4, 5), at(0, 5), at(0, 0)], holes: [] };
  const feature = { ...original, ceilingCutouts: [{ footprint, height: 3.84 }] };
  const before = JSON.stringify(feature), footprints = undergroundFootprints(feature);
  const sections = undergroundCeilingSections(feature, footprints);
  const polygons = shapes => shapes.map(shape => [shape.outer, ...shape.holes]);
  assert.deepEqual(sections.map(section => section.height).sort(), [3.84, original.wallHeight]);
  assert.deepEqual(polygonClipping.xor(polygons(footprints), polygonClipping.union(...sections.map(section => polygons(section.footprints)))), []);
  assert.deepEqual(polygonClipping.intersection(...sections.map(section => polygons(section.footprints))), [], 'The local roof sections do not overlap');

  const model = undergroundDetailGeometry(feature), baseline = undergroundDetailGeometry(original);
  const meshes = Object.fromEntries(Object.entries(model).map(([kind, geometry]) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld();
    return [kind, mesh];
  }));
  const ray = (point, y, direction, far, objects) => new THREE.Raycaster(new THREE.Vector3(point[0], y, point[1]), direction, 0, far).intersectObjects(objects);
  const down = new THREE.Vector3(0, -1, 0), up = new THREE.Vector3(0, 1, 0), corner = at(2, 2.5), neighbor = at(6, 2.5);
  try {
    assert.equal(ray(corner, .12, up, 3, [meshes.ceiling, meshes.metal, meshes.pipes, meshes.lights]).length, 0, 'No high roof or hanging fitting blocks the above-ground stair');
    const lowRoof = ray(corner, .12, down, .5, [meshes.ceiling]);
    assert.ok(lowRoof.length, 'The badminton hall remains covered below the stair floor');
    assert.ok(Math.abs(lowRoof[0].point.y - (floor + 3.84 - .06)) < 1e-5);
    const tallRoof = ray(neighbor, floor + 1.6, up, 8, [meshes.ceiling]);
    assert.ok(tallRoof.length && Math.abs(tallRoof[0].point.y - (floor + original.wallHeight - .06)) < 1e-5, 'The neighboring tall room roof stays unchanged');
    assert.deepEqual([...model.green.attributes.position.array], [...baseline.green.attributes.position.array], 'The original badminton floor elevation and shape stay unchanged');
    assert.deepEqual([...model.paint.attributes.position.array].filter((_, i) => i % 3 === 1 && model.paint.attributes.position.array[i] < floor + .1),
      [...baseline.paint.attributes.position.array].filter((_, i) => i % 3 === 1 && baseline.paint.attributes.position.array[i] < floor + .1), 'Court markings remain on the original floor');
    for (const kind of ['walls', 'metal', 'pipes', 'lights']) {
      const positions = model[kind].attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const point = [positions.getX(i), positions.getZ(i)];
        const u = (point[0] - at(0, 0)[0]) * (at(1, 0)[0] - at(0, 0)[0]) + (point[1] - at(0, 0)[1]) * (at(1, 0)[1] - at(0, 0)[1]);
        const v = (point[0] - at(0, 0)[0]) * (at(0, 1)[0] - at(0, 0)[0]) + (point[1] - at(0, 0)[1]) * (at(0, 1)[1] - at(0, 0)[1]);
        if (u > .35 && u < 3.65 && v > .35 && v < 4.65)
          assert.ok(positions.getY(i) <= floor + 3.84 + 1e-5, kind + ' does not stick up into the stair');
      }
    }
    const field = campus.features.find(feature => feature.type === 'runningTrack');
    const layers = sportsGroundPlatformLayers(field, campus.features.map(item => item.id === feature.id ? feature : item));
    assert.ok(layers.length && layers.some(layer => layer.bottom >= 2.4 - 1e-6));
    for (const layer of layers) assert.ok(!pointOnStairTread(corner, layer.shape.outer) || layer.shape.holes.some(hole => pointOnStairTread(corner, hole)), 'The podium cap is cut all the way through the stair footprint');
    assert.ok(layers.some(layer => pointOnStairTread(neighbor, layer.shape.outer) && !layer.shape.holes.some(hole => pointOnStairTread(neighbor, hole))), 'The adjacent field podium remains');
    const seam = at(4, 2.5), direction = new THREE.Vector3(...[at(1, 0)[0] - at(0, 0)[0], 0, at(1, 0)[1] - at(0, 0)[1]]);
    const start = [seam[0] - direction.x * .3, seam[1] - direction.z * .3];
    assert.equal(ray(start, floor + 1.6, direction, .6, [meshes.walls]).length, 0, 'The low-roof boundary does not add an internal partition');
    assert.equal(JSON.stringify(feature), before, 'The cut does not mutate model data');
  } finally {
    [...Object.values(model), ...Object.values(baseline)].forEach(geometry => geometry.dispose());
    Object.values(meshes).forEach(mesh => mesh.material.dispose());
  }
});

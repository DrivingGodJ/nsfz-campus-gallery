import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { BUILDING_COLOR_PROFILES, buildingColors, buildingMaterialColor, buildingRoofMaterials, theatreDrumMaterials, theatreDrumTexture } from '../src/building-colors.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { STANDS_ID, THEATRE_ID, standsArchitecture } from '../src/venue-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));

test('photo palettes belong to exact building ids and preserve missing material and unknown-building fallbacks', () => {
  const mapColor = color => `theme:${color}`;
  assert.equal(buildingColors({ id: 'unknown', category: 'office' }), undefined);
  assert.equal(buildingMaterialColor('unknown', 'body', '#d7d2c3', mapColor), 'theme:#d7d2c3');
  for (const [id, colors] of Object.entries(BUILDING_COLOR_PROFILES)) {
    assert.ok(campus.buildings.some(building => building.id === id), 'A reference cannot accidentally recolor a similarly named building');
    assert.equal(buildingColors({ id }), colors);
    for (const [kind, color] of Object.entries(colors)) {
      assert.match(color, /^#[0-9a-f]{6}$/i);
      assert.equal(buildingMaterialColor(id, kind, '#000000', mapColor), color, 'Photographed finishes retain their color under either map theme');
    }
    if (!colors.brick) assert.equal(buildingMaterialColor(id, 'brick', '#a87362', mapColor), 'theme:#a87362');
  }
});

test('stands retain ground housing finishes without any obsolete tower material, including floor cuts', () => {
  const building = campus.buildings.find(building => building.id === STANDS_ID), floorHeight = 3.6;
  assert.equal(buildingColors(STANDS_ID).tower, undefined, 'The removed tower has no surviving color profile');
  for (const cutoff of [undefined, 5.4]) {
    const model = standsArchitecture(building, 7.2, floorHeight, cutoff);
    try {
      const positions = model.body.getAttribute('position'), before = Array.from(positions.array);
      buildingRoofMaterials(model.body, cutoff === undefined);
      assert.deepEqual(Array.from(positions.array), before);
      assert.ok(model.body.groups.every(group => group.materialIndex === 0 || group.materialIndex === 1), 'Ground housing only uses its body and roof finishes');
      for (let i = 0; i < positions.count; i++) assert.ok(positions.getZ(i) <= floorHeight + 1e-4, 'Recoloring cannot restore the removed upper tower');
      if (cutoff === undefined) assert.ok(model.body.groups.some(group => group.materialIndex === 1));
      if (cutoff !== undefined) assert.ok(model.body.groups.every(group => group.materialIndex !== 1), 'The section cap remains a cut rather than a restored roof');
    } finally { Object.values(model).forEach(geometry => geometry.dispose()); }
  }
});

test('roof finishes keep walls, windows and passage ceilings on the original triangles', () => {
  const shape = { outer: [[0, 0], [12, 0], [12, 8], [0, 8], [0, 0]], holes: [] };
  const passage = { id: 'entrance', sourcePathId: 'path', width: 3, points: [[6, -2], [6, 10]] };
  const geometry = buildingGeometry(shape, 10.8, 3.6, [passage]);
  const positions = geometry.getAttribute('position'), before = Array.from(positions.array), normals = geometry.getAttribute('normal');
  geometry.userData.photoOcclusionMask = new Uint8Array(positions.count / 3).fill(1);
  const mask = geometry.userData.photoOcclusionMask;
  try {
    buildingRoofMaterials(geometry);
    assert.deepEqual(Array.from(positions.array), before, 'A finish must not move or replace the modeled walls and open passage');
    assert.equal(geometry.userData.photoOcclusionMask, mask);
    assert.equal(geometry.groups.reduce((sum, group) => sum + group.count, 0), positions.count);
    assert.ok(geometry.groups.some(group => group.materialIndex === 1));
    for (const group of geometry.groups) for (let i = group.start; i < group.start + group.count; i += 3) {
      const roof = [0, 1, 2].every(j => Math.abs(positions.getZ(i + j) - 10.8) < .001 && normals.getZ(i + j) > .5);
      assert.equal(group.materialIndex, roof ? 1 : 0, 'Walls, ground slab and the entrance ceiling keep the body finish');
    }
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2; mesh.updateMatrixWorld();
    assert.equal(new THREE.Raycaster(new THREE.Vector3(6, 1.6, -2), new THREE.Vector3(0, 0, 1), 0, 12).intersectObject(mesh).length, 0, 'The original ground-floor path remains open');
    material.dispose();
  } finally { geometry.dispose(); }
});

test('the theatre drum texture uses sRGB photo finishes, dark piers and a continuous top band', () => {
  const colors = buildingColors(THEATRE_ID), texture = theatreDrumTexture(colors.body, colors.drum);
  try {
    const { data, width, height } = texture.image;
    const pixel = (x, y) => Array.from(data.slice((y * width + x) * 4, (y * width + x) * 4 + 4));
    assert.deepEqual(pixel(0, 0), [71, 82, 94, 255]);
    assert.deepEqual(pixel(Math.floor(width / 2), 0), [223, 222, 214, 255]);
    assert.deepEqual(pixel(Math.floor(width / 2), height - 1), pixel(0, 0));
    const darkFraction = Array.from({ length: width }, (_, x) => pixel(x, 0)[0] === 71).filter(Boolean).length / width;
    assert.ok(darkFraction >= .3 && darkFraction <= .35);
    assert.equal(texture.colorSpace, THREE.SRGBColorSpace);
    assert.equal(texture.wrapS, THREE.RepeatWrapping);
  } finally { texture.dispose(); }
});

test('theatre upper arc finishes preserve the exact walls, floor cuts and occlusion geometry with continuous unfolded UVs', () => {
  const building = campus.buildings.find(building => building.id === THEATRE_ID), floorHeight = 3.6;
  const section = building.parts.find(part => part.id === 'main'), bottom = 4 * floorHeight;
  const terrace = building.parts.find(part => part.id === 'curved-terrace'), arc = terrace.outer.slice(terrace.roofTerrace.railEdges[0].length+4,-1);
  const expectedEdges = arc.slice(0,-1).map((p,i)=>section.outer.findIndex((q,j)=>j<section.outer.length-1&&Math.hypot(p[0]-q[0],p[1]-q[1])<1e-5&&Math.hypot(arc[i+1][0]-section.outer[j+1][0],arc[i+1][1]-section.outer[j+1][1])<1e-5));
  for (const cutoff of [bottom, 5 * floorHeight, undefined]) {
    const height = cutoff ?? 6 * floorHeight;
    const geometry = buildingGeometry(section, height, floorHeight, building.groundPassages,
      building.floorCorridors?.filter(corridor => corridor.partId === section.id),
      building.stairwells?.filter(stair => stair.partId === section.id), building.classroomWindows,
      building.solidCores?.filter(core => core.partId === section.id),
      building.cutouts?.filter(cut => cut.partId === section.id), cutoff !== undefined);
    try {
      const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal');
      const before = Array.from(positions.array), oldNormals = Array.from(normals.array), mask = geometry.userData.photoOcclusionMask;
      buildingRoofMaterials(geometry, cutoff === undefined);
      const oldRoofGroups = geometry.groups.filter(group => group.materialIndex === 1).map(group => ({ ...group }));
      theatreDrumMaterials(geometry, section, floorHeight, building);
      assert.deepEqual(Array.from(positions.array), before, 'No wall, opening or roof vertex can be moved by its finish');
      assert.deepEqual(Array.from(normals.array), oldNormals);
      assert.equal(geometry.userData.photoOcclusionMask, mask, 'The photo compositor retains its original face mask');
      assert.equal(geometry.groups.reduce((sum, group) => sum + group.count, 0), positions.count);
      assert.deepEqual(geometry.groups.filter(group => group.materialIndex === 1), oldRoofGroups);
      const uv = geometry.getAttribute('uv'), arcGroups = geometry.groups.filter(group => group.materialIndex === 2);
      assert.equal(uv.count, positions.count);
      if (cutoff === bottom) { assert.equal(arcGroups.length, 0, 'Selecting floors 1–4 cannot add the upper drum'); continue; }
      assert.ok(arcGroups.length > 0);
      const seenEdges = new Set(), sharedUVs = new Map();
      for (const group of arcGroups) for (let i = group.start; i < group.start + group.count; i += 3) {
        const center = new THREE.Vector3();
        for (let j = 0; j < 3; j++) {
          const v = i + j, x = positions.getX(v), z = -positions.getY(v), y = positions.getZ(v);
          assert.ok(y >= bottom - .001 && Math.abs(normals.getZ(v)) < .1, 'Only walls above floor 4 get the striped material');
          assert.ok(Number.isFinite(uv.getX(v)) && uv.getX(v) >= -.001);
          assert.ok(uv.getY(v) >= -.001 && uv.getY(v) <= 1.001);
          const key = [x, z, y].map(n => n.toFixed(4)).join(','), previous = sharedUVs.get(key);
          if (previous) assert.ok(Math.abs(previous[0] - uv.getX(v)) < .001 && Math.abs(previous[1] - uv.getY(v)) < .001, 'Stripes continue across adjacent arc chords');
          sharedUVs.set(key, [uv.getX(v), uv.getY(v)]);
          center.add(new THREE.Vector3(x, 0, z).multiplyScalar(1 / 3));
        }
        const edge = section.outer.slice(0, -1).findIndex((from, e) => {
          const to = section.outer[e + 1], line = new THREE.Line3(new THREE.Vector3(from[0], 0, from[1]), new THREE.Vector3(to[0], 0, to[1]));
          return line.closestPointToPoint(center, true, new THREE.Vector3()).distanceTo(center) < .002;
        });
        assert.ok(expectedEdges.includes(edge), 'The rear connection, notch, straight walls and roof retain their original material');
        seenEdges.add(edge);
      }
      assert.deepEqual([...seenEdges].sort((a, b) => a - b), expectedEdges.slice().sort((a,b)=>a-b));
      if (cutoff !== undefined) assert.ok(geometry.groups.every(group => group.materialIndex !== 1), 'A selected floor cap does not become a physical roof');
    } finally { geometry.dispose(); }
  }
});

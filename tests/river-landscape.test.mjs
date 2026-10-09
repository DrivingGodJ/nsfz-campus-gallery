import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { RIVER_IDS, riverWaterFootprints, riverBankSamples, riverLandscapeGeometry } from '../src/river-landscape.ts';
import { palmCrownGeometry, treeInstances, treeTrunkGeometry } from '../src/tree-geometry.ts';
import { passageFootprint } from '../src/underground-geometry.ts';
import { pavilionGeometry } from '../src/pavilion-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
test('joined river banks stay out of crossing approaches and contain photograph-confirmed details', () => {
  const original = JSON.stringify(campus), geometry = riverLandscapeGeometry(campus.features, campus.buildings);
  assert.equal(RIVER_IDS.length, 3);
  assert.equal(riverWaterFootprints(campus.features).length, 1, 'The linked river channel has no internal dam');
  assert.ok(riverBankSamples(campus.features).length > 140);
  let triangles = 0;
  for (const [key, part] of Object.entries(geometry)) {
    const position = part.getAttribute('position');
    assert.ok(position.count > 0, key + ' is visible'); triangles += position.count / 3;
    for (let i = 0; i < position.count; i++) for (const value of [position.getX(i), position.getY(i), position.getZ(i)]) assert.ok(Number.isFinite(value));
    assert.ok(part.userData.photoOcclusionMask.every(value => value === 0), 'Small scenery does not create artificial marker occlusion layers');
  }
  assert.ok(triangles < 24000, 'All river banks, plants, paths and furniture stay in seven bounded material batches');
  const crossing = campus.features.find(feature => feature.id === 'local/lake-bridge');
  const obstruction = ['rock','timber','shrubs','stone'].map(key => new THREE.Mesh(geometry[key], new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })));
  obstruction.forEach(mesh => mesh.updateMatrixWorld());
  const [a,b] = crossing.points;
  for (let t = 0; t <= 1; t += .05) {
    const p = new THREE.Vector3(a[0] + (b[0]-a[0])*t, 1.4, a[1] + (b[1]-a[1])*t);
    assert.equal(new THREE.Raycaster(p, new THREE.Vector3(0,-1,0), 0, 1.25).intersectObjects(obstruction).length, 0, 'The pedestrian center of the crossing remains clear');
  }
  assert.equal(JSON.stringify(campus), original);
  Object.values(geometry).forEach(part => part.dispose()); obstruction.forEach(mesh => mesh.material.dispose());
});
test('columnar, plane and palm trees keep their declared crown envelopes in shared geometry', () => {
  const plane = treeTrunkGeometry(), column = treeTrunkGeometry(true);
  assert.ok(plane.getAttribute('position').count < 400); assert.ok(column.getAttribute('position').count < 80);
  const crown = new THREE.IcosahedronGeometry(1,1), palm = palmCrownGeometry();
  assert.ok(palm.getAttribute('position').count < 300, 'Palm fronds remain a small shared mesh');
  for (const kind of ['plane','columnar','palm']) {
    const tree = {position:[102,8],radius:2.3,height:12,kind}, instances = treeInstances(tree);
    const leaf = kind === 'palm' ? palm : crown;
    for (const matrix of instances.crowns) for (let i = 0; i < leaf.getAttribute('position').count; i++) {
      const p = new THREE.Vector3().fromBufferAttribute(leaf.getAttribute('position'),i).applyMatrix4(matrix);
      assert.ok(p.y <= tree.height + .13); assert.ok(Math.hypot(p.x-tree.position[0],p.z-tree.position[1]) <= tree.radius + .001);
      assert.ok(p.y > 3.2, 'Mature avenue foliage is raised above pedestrian eye height');
    }
  }
  plane.dispose(); column.dispose(); crown.dispose(); palm.dispose();
});

test('tree trunks leave physical roads, building bodies, water and ground photo cameras clear', async () => {
  const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
  const trees = campus.features.flatMap(feature => (feature.trees ?? []).map(tree => ({ ...tree, group: feature.id })));
  const inside = (point, ring) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
    }
    return hit;
  };
  const edgeDistance = (p, a, b) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], denominator = dx * dx + dz * dz;
    const t = denominator ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / denominator)) : 0;
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
  };
  const roads = campus.features.filter(feature => ['path','bridge'].includes(feature.type) && feature.points)
    .map(feature => ({ ...passageFootprint(feature.points, feature.width || 2), id: feature.id }));
  const bodies = campus.buildings.flatMap(building => {
    if (building.appearance?.type !== 'glass-pavilion') return [building];
    const model = pavilionGeometry(building.appearance, 5);
    return [model.core, model.rearWing]; // The low surrounding plaza permits planted tree wells.
  });
  const waters = riverWaterFootprints(campus.features);
  const cameras = site.photos.filter(photo => photo.captureType === 'ground' && !photo.floor);
  for (const tree of trees) {
    const radius = Math.max(.2, tree.radius * .13), point = tree.position;
    for (const road of roads) {
      const clearance = Math.min(...road.outer.map((a,i) => edgeDistance(point, a, road.outer[(i + 1) % road.outer.length])));
      assert.ok(!inside(point, road.outer) && clearance >= radius + .04, `${tree.group} trunk enters ${road.id}`);
    }
    assert.ok(!bodies.some(body => inside(point, body.outer) && !body.holes.some(hole => inside(point, hole))), tree.group + ' enters a building');
    assert.ok(!waters.some(water => inside(point, water.outer)), tree.group + ' is planted in the river');
    for (const photo of cameras) assert.ok(Math.hypot(point[0] - photo.position.x, point[1] - photo.position.z) >= radius + .08,
      `${tree.group} intersects the near plane of ${photo.title}`);
  }
});

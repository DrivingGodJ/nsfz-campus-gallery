import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import clip from 'polygon-clipping';
import * as THREE from 'three';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { passageFootprint } from '../src/underground-geometry.ts';
import { bellGeometry, bellTowerLayout, monumentLayout, monumentSignGeometry, landmarkWorldPoint, landmarkRotation } from '../src/gate-landmark-geometry.ts';
import { campusLocations } from '../src/locations.ts';

const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
const campus = await read('public/data/campus.json'), site = await read('public/data/site.json');
const monument = campus.features.find(f => f.id === 'local/gate-monument'), tower = campus.features.find(f => f.id === 'local/gate-bell-tower');
const polygon = shape => [shape.outer, ...(shape.holes || [])];
const area = polygons => polygons.reduce((sum, [outer, ...holes]) => {
  const ringArea = ring => Math.abs(ring.slice(1).reduce((n, p, i) => n + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
  return sum + ringArea(outer) - holes.reduce((n, ring) => n + ringArea(ring), 0);
}, 0);

test('gate landmarks flank the entrance in the photographed order and keep roads, stairs and existing buildings clear', async () => {
  const road = campus.features.find(f => f.id === 'way/855459415');
  const [a, b] = road.points, forward = new THREE.Vector2(b[0] - a[0], b[1] - a[1]).normalize();
  const center = monument.landmark.center.map((n, i) => (n + tower.landmark.center[i]) / 2);
  const side = point => forward.y * (point[0] - center[0]) - forward.x * (point[1] - center[1]);
  assert.ok(side(monument.landmark.center) > 0, 'Monument sits on the left when looking into the campus');
  assert.ok(side(tower.landmark.center) < 0, 'Bell tower sits on the right');
  const spacing = Math.hypot(...monument.landmark.center.map((n, i) => n - tower.landmark.center[i]));
  assert.ok(spacing < 25, 'Both landmarks sit closer to the gate center');
  const acrossRoad = point => forward.y * (point[0] - a[0]) - forward.x * (point[1] - a[1]);
  const monumentEdge = Math.min(...monument.outer.map(acrossRoad)), towerEdge = Math.max(...tower.outer.map(acrossRoad));
  assert.ok(monumentEdge >= road.width / 2 && monumentEdge < road.width / 2 + .1, 'The monument outer end touches the road edge');
  assert.ok(towerEdge <= -road.width / 2 && towerEdge > -road.width / 2 - .15, 'The smaller bell tower sits right beside the road');
  assert.ok(monumentEdge - towerEdge >= road.width, 'The full entrance road stays open');
  const angle = Math.atan2(monument.landmark.axis[1], monument.landmark.axis[0]) - Math.atan2(tower.landmark.axis[1], tower.landmark.axis[0]);
  assert.ok(angle < 0 && angle > -Math.PI / 9, 'The monument tilts toward the marked street-facing curve');
  const inward = [-tower.landmark.axis[1], tower.landmark.axis[0]];
  const frontEdge = feature => Math.min(...feature.outer.map(point => point[0] * inward[0] + point[1] * inward[1]));
  assert.ok(Math.abs(frontEdge(monument) - frontEdge(tower)) < 1e-7, 'The tower and monument street-facing base edges share the same frontage');
  assert.ok(tower.landmark.totalHeight + .12 <= 3 * 3.6 + 1e-7, 'The whole tower is no taller than three storeys');
  const roads = campus.features.filter(f => f.type === 'path' && !f.representedBy).flatMap(f => f.points.slice(1).map((to, i) => polygon(passageFootprint([f.points[i], to], f.width || 3))));
  for (const feature of [monument, tower]) {
    for (const footprint of roads) assert.ok(area(clip.intersection(polygon(feature), footprint)) < 1e-7, 'Landmark does not block an existing road');
    for (const building of campus.buildings) assert.ok(area(clip.intersection(polygon(feature), polygon(building))) < 1e-7);
    assert.ok(area(clip.difference(polygon(feature), [campus.boundary])) < 1e-7, 'Landmark stays inside the campus frontage');
    const entrance = campus.features.find(f => f.id === 'local/underpass-entrance');
    assert.ok(Math.hypot(feature.landmark.center[0] - entrance.curvedStair.center[0], feature.landmark.center[1] - entrance.curvedStair.center[1]) > entrance.curvedStair.radius + entrance.curvedStair.width / 2 + feature.landmark.width / 2);
    assert.ok(campusLocations(campus, site).some(location => location.id === feature.id && location.name === feature.name));
  }
  assert.deepEqual(applyCampusCorrections(campus, await read('data/campus-corrections.json')), campus, 'Both models survive refreshing the OSM map');
});

test('the school name reads left to right and upright from outside the gate', () => {
  const model = monument.landmark, geometry = monumentSignGeometry(model);
  const material = new THREE.MeshBasicMaterial({ side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(model.center[0], .12, model.center[1]);
  mesh.rotation.y = landmarkRotation(model); mesh.updateMatrixWorld();
  const inward = new THREE.Vector3(-model.axis[1], 0, model.axis[0]);
  const target = new THREE.Vector3(model.center[0], model.totalHeight - .4, model.center[1]);
  const camera = new THREE.PerspectiveCamera(40, 1.6, .1, 100);
  camera.position.copy(target).addScaledVector(inward, -30);
  camera.lookAt(target); camera.updateMatrixWorld();
  try {
    const positions = geometry.getAttribute('position'), uv = geometry.getAttribute('uv');
    const project = i => new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld).project(camera);
    const leftBottom = Array.from({length: uv.count}, (_, i) => i).find(i => uv.getX(i) === 0 && uv.getY(i) === 0);
    const rightBottom = Array.from({length: uv.count}, (_, i) => i).find(i => uv.getX(i) === 1 && uv.getY(i) === 0);
    assert.ok(project(leftBottom).x < project(rightBottom).x, 'Texture left edge projects to the viewer left');
    assert.ok(project(leftBottom + 1).y > project(leftBottom).y, 'The name remains upright');
    assert.ok(new THREE.Raycaster(camera.position, target.clone().sub(camera.position).normalize()).intersectObject(mesh).length > 0, 'Text faces the street');
    const inside = target.clone().addScaledVector(inward, 30);
    assert.equal(new THREE.Raycaster(inside, target.clone().sub(inside).normalize()).intersectObject(mesh).length, 0, 'No mirrored text is shown on the back face');
  } finally { geometry.dispose(); material.dispose(); }
});

test('the monument keeps open pillar gaps and a curved sign, and the bell chamber is open on both sides', () => {
  const model = monument.landmark, layout = monumentLayout(model);
  assert.equal(layout.pillars.length, 6);
  assert.ok(Math.abs(layout.pillars[0].center[2] - layout.pillars[2].center[2]) > .5 * model.totalHeight / 6.8, 'Column line curves in plan like the entrance photo');
  assert.equal(layout.beamBottom + layout.beamHeight, model.totalHeight);
  const sign = monumentSignGeometry(model), positions = sign.getAttribute('position');
  assert.equal(sign.getAttribute('uv').count, positions.count);
  assert.ok(sign.index.count > 100);
  assert.ok(Math.abs(positions.getZ(0) - positions.getZ(32)) > .5 * model.totalHeight / 6.8, 'School name surface wraps around the curved front beam');
  sign.dispose();
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = boxes => boxes.map(box => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.size), material);
    mesh.position.set(...box.position); mesh.rotation.y = box.rotation || 0; mesh.updateMatrixWorld(); return mesh;
  });
  const columns = meshes(layout.boxes), clock = bellTowerLayout(tower.landmark), towerMeshes = meshes(clock.boxes);
  for (const [feature, createLayout, width, depth, height] of [[monument, monumentLayout, 14, 4, 6.8], [tower, bellTowerLayout, 6.2, 5.5, 18]]) {
    const model = feature.landmark, scale = model.totalHeight / height;
    assert.ok(Math.abs(model.width / width - scale) < 1e-7 && Math.abs(model.depth / depth - scale) < 1e-7, 'Both footprints shrink with their heights');
    const original = createLayout({...model, width, depth, totalHeight: height}), smaller = createLayout(model);
    original.boxes.forEach((box, i) => {
      for (const property of ['position', 'size']) box[property].forEach((n, j) => assert.ok(Math.abs(smaller.boxes[i][property][j] - n * scale) < 1e-7, 'Pillars, bases and carved trim all scale together'));
    });
  }
  try {
    const gap = layout.pillars.slice(0, 2).reduce((sum, p) => sum + p.center[0] / 2, 0);
    assert.equal(new THREE.Raycaster(new THREE.Vector3(gap, 3, -10), new THREE.Vector3(0, 0, 1)).intersectObjects(columns).length, 0, 'Monument is a colonnade rather than a solid wall');
    const y = (clock.chamberBottom + clock.chamberTop) / 2;
    for (const direction of [new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)]) {
      const ray = new THREE.Raycaster(direction.clone().multiplyScalar(-10).setY(y), direction);
      assert.equal(ray.intersectObjects(towerMeshes).length, 0, 'Bell remains visible through both sides of the top chamber');
    }
    assert.ok(clock.bell.bottom > clock.chamberBottom);
    assert.ok(clock.bell.bottom + clock.bell.height < clock.chamberTop);
    assert.equal(clock.mast.top, tower.landmark.totalHeight);
    for (const feature of [monument, tower]) {
      const boxes = feature === monument ? layout.boxes : clock.boxes;
      for (const box of boxes) assert.ok(landmarkWorldPoint(feature.landmark, box.position).every(Number.isFinite));
    }
  } finally { [...columns, ...towerMeshes].forEach(mesh => mesh.geometry.dispose()); material.dispose(); }
});

test('the bell mouth is a single closed shell with real thickness, an open cavity and no overlapping rim faces', () => {
  for (const model of [tower.landmark, { ...tower.landmark, width: 6.2, depth: 5.5, totalHeight: 18 }]) {
    const layout = bellTowerLayout(model), geometry = bellGeometry(model);
    const positions = geometry.getAttribute('position'), index = geometry.index, edges = new Map(), faces = new Set();
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), mesh = new THREE.Mesh(geometry, material);
    mesh.updateMatrixWorld();
    try {
      assert.ok(Array.from(geometry.getAttribute('normal').array).every(Number.isFinite));
      for (let i = 0; i < index.count; i += 3) {
        const ids = [0, 1, 2].map(j => index.getX(i + j));
        const face = [...ids].sort((a, b) => a - b).join(',');
        assert.ok(!faces.has(face), 'No duplicated triangles'); faces.add(face);
        const [a, b, c] = ids.map(id => new THREE.Vector3().fromBufferAttribute(positions, id));
        assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).length() > layout.scale ** 2 * 1e-8, 'No collapsed faces at the rim or poles');
        for (let j = 0; j < 3; j++) {
          const edge = [ids[j], ids[(j + 1) % 3]].sort((a, b) => a - b).join(',');
          edges.set(edge, (edges.get(edge) || 0) + 1);
        }
      }
      assert.ok([...edges.values()].every(count => count === 2), 'Each shell edge joins exactly two faces, including the rounded mouth and rotational seam');
      const uniqueHits = (origin, direction) => new THREE.Raycaster(origin, direction).intersectObject(mesh)
        .filter((hit, i, hits) => i === 0 || hit.distance - hits[i - 1].distance > layout.scale * 1e-6);
      for (let i = 0; i < 13; i++) {
        const angle = (i + .27) / 13 * Math.PI * 2, direction = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
        const origin = direction.clone().multiplyScalar(layout.bell.radius * 2).setY(layout.bell.height * .22);
        const hits = uniqueHits(origin, direction.negate());
        assert.equal(hits.length, 4, 'A view through the shell crosses distinct outer and inner walls on both sides');
        assert.ok(hits[1].distance - hits[0].distance > .02 * layout.scale, 'The outer and inner wall never fight at the same depth');
        assert.ok(hits[3].distance - hits[2].distance > .02 * layout.scale);
      }
      material.side = THREE.FrontSide;
      const opening = uniqueHits(new THREE.Vector3(layout.bell.radius * .18, -layout.bell.height, 0), new THREE.Vector3(0, 1, 0));
      assert.ok(opening.length > 0 && opening[0].point.y > layout.bell.height * .8, 'The mouth remains open and reveals the inside of the upper bell');
      const rim = uniqueHits(new THREE.Vector3(layout.bell.radius - .025 * layout.scale, -layout.bell.height, 0), new THREE.Vector3(0, 1, 0));
      assert.ok(rim.length > 0 && Math.abs(rim[0].point.y) < .001 * layout.scale, 'The rounded lower edge belongs to the same shell');
      assert.ok(rim[0].face.normal.y < 0, 'The underside faces downward without double-sided rendering');
    } finally { geometry.dispose(); material.dispose(); }
  }
});

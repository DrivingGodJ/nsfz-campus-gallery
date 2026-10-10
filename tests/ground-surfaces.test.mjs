import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { groundSurfaces } from '../src/ground-geometry.ts';
import { buildingGeometry, snapFootprint } from '../src/building-geometry.ts';
import { passageFootprint, undergroundLayout } from '../src/underground-geometry.ts';
import { curvedStairPoint } from '../src/structure-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const polygon = shape => [shape.outer, ...(shape.holes || [])];
const polygons = shapes => shapes.map(polygon);
const ringArea = ring => Math.abs(ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
const area = geometry => geometry.reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((n, ring) => n + ringArea(ring), 0), 0);
const roads = campus.features.filter(feature => feature.type === 'path' && feature.points && !feature.representedBy)
  .map(feature => passageFootprint(feature.points, feature.width || 3));
roads.push(...campus.features.filter(feature => feature.type === 'bridge' && !feature.archRise && feature.deckHeight <= .12)
  .map(feature => passageFootprint(feature.points, feature.width)));
const roadMask = polygonClipping.union(...roads.map(polygon));

test('curved underground entrances leave a real opening in every ground layer while adjacent land stays solid', () => {
  const layout = groundSurfaces(campus), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const surfaces = [...layout.campus, ...layout.background,
    ...campus.features.flatMap(feature => layout.features.get(feature.id) || [])];
  const meshes = surfaces.map(shape => {
    const outline = new THREE.Shape(shape.outer.map(([x,z]) => new THREE.Vector2(x,-z)));
    outline.holes = shape.holes.map(ring => new THREE.Path(ring.map(([x,z]) => new THREE.Vector2(x,-z))));
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(outline), material);
    mesh.rotation.x = -Math.PI / 2; mesh.updateMatrixWorld();
    return mesh;
  });
  const above = point => new THREE.Raycaster(new THREE.Vector3(point[0],1,point[2]),new THREE.Vector3(0,-1,0),0,2).intersectObjects(meshes);
  try {
    const entrances = campus.features.filter(feature => feature.type === 'tunnelEntrance' && feature.curvedStair);
    assert.ok(entrances.length);
    for (const { curvedStair: stair } of entrances) {
      for (const progress of [.2,.5,.8]) {
        assert.equal(above(curvedStairPoint(stair,progress)).length,0,'No ground sheet seals the stairs or blocks an entrance sightline');
      }
      assert.ok(above(curvedStairPoint(stair,.5,stair.radius + stair.width / 2 + .5)).length,'The hole does not expose unrelated underground land');
    }
  } finally { meshes.forEach(mesh => mesh.geometry.dispose()); material.dispose(); }
});

test('ground layers leave all rooms that cross ground level hollow while preserving ordinary tunnel cover', () => {
  const layout = groundSurfaces(campus);
  const voids = [...undergroundLayout(campus.features).areas.values()]
    .filter(a => a.feature.height + a.feature.wallHeight > .12).flatMap(a => a.footprints);
  assert.ok(voids.length > 0);
  const surfaces = [...layout.campus, ...layout.background, ...campus.features.filter(f => ['green', 'sport', 'plaza'].includes(f.type)).flatMap(f => layout.features.get(f.id) || [])];
  for (const surface of surfaces) assert.ok(area(polygonClipping.intersection(snapFootprint([polygon(surface)]), snapFootprint(polygons(voids)))) < .005,
    'No ground face passes horizontally through an underground room');
  const fixture = { boundary: [[-20,-20],[20,-20],[20,20],[-20,20],[-20,-20]], buildings: [], features: [
    {id:'low-tunnel',type:'tunnel',points:[[-10,0],[10,0]],width:4,height:-4,wallHeight:3}
  ]};
  const normal = groundSurfaces(fixture);
  assert.equal(area(polygons(normal.campus)), 1600, 'An entirely submerged tunnel keeps normal ground above it');
});

test('each lake renders once, with all overlapping lawn, campus and background faces removed', () => {
  const before = JSON.stringify(campus), layout = groundSurfaces(campus);
  const waters = campus.features.filter(feature => feature.type === 'water');
  const waterShapes = waters.flatMap(feature => layout.features.get(feature.id));
  assert.equal(waters.length, 5);
  const green = campus.features.find(feature => feature.id === 'way/1233313452');
  assert.ok(area(polygonClipping.intersection(polygon(green), polygons(waterShapes))) > 800, 'The original map contains a large lake/lawn overlap that previously caused flicker');
  const land = [...layout.campus, ...layout.background,
    ...campus.features.filter(feature => ['green', 'sport'].includes(feature.type)).flatMap(feature => layout.features.get(feature.id) || [])];
  for (const lake of waters) {
    const visible = polygons(layout.features.get(lake.id));
    assert.ok(area(visible) > 0);
    for (const ground of land) assert.ok(area(polygonClipping.intersection(visible, polygon(ground))) < 1e-7, 'No different-colored face competes with ' + lake.id);
    assert.ok(area(polygonClipping.intersection(visible, roadMask)) < 1e-7, 'Lake edges do not compete with roads or road-level bridge decks');
    const excluded = polygonClipping.union(roadMask, ...waters.slice(0, waters.indexOf(lake)).map(polygon));
    const expected = polygonClipping.difference(polygon(lake), excluded);
    assert.ok(area(polygonClipping.difference(expected, visible)) < 1e-7, 'All lake area outside visible paths is retained');
    assert.ok(area(polygonClipping.difference(visible, expected)) < 1e-7, 'The lake outline stays in its original position');
  }
  for (let i = 0; i < waterShapes.length; i++) for (let j = i + 1; j < waterShapes.length; j++) {
    assert.ok(area(polygonClipping.intersection(polygon(waterShapes[i]), polygon(waterShapes[j]))) < 1e-7);
  }
  assert.equal(JSON.stringify(campus), before, 'Ground rendering does not rewrite the map or locations');
});

test('triangulated lake holes remain empty and only the lake is hit over its interior', () => {
  const layout = groundSurfaces(campus), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const entries = [
    ...campus.features.flatMap(feature => (layout.features.get(feature.id) || []).map(shape => ({ shape, water: feature.type === 'water', height: .06 }))),
    ...layout.campus.map(shape => ({ shape, water: false, height: .02 })),
    ...layout.background.map(shape => ({ shape, water: false, height: -.08 }))
  ];
  const meshes = entries.map(entry => {
    const outline = new THREE.Shape(entry.shape.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    outline.holes = entry.shape.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    const geometry = new THREE.ShapeGeometry(outline), vertices = geometry.getAttribute('position'), indices = geometry.getIndex();
    let trianglesArea = 0;
    for (let i = 0; i < indices.count; i += 3) {
      const p = [0, 1, 2].map(j => new THREE.Vector2(vertices.getX(indices.getX(i + j)), vertices.getY(indices.getX(i + j))));
      trianglesArea += Math.abs(p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0]))) / 2;
    }
    assert.ok(Math.abs(trianglesArea - area([polygon(entry.shape)])) < .15, 'Triangulation retains lake cutouts instead of silently filling them');
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.water = entry.water; mesh.position.y = entry.height; mesh.rotation.x = -Math.PI / 2; mesh.updateMatrixWorld();
    return mesh;
  });
  try {
    let checked = 0;
    for (const mesh of meshes.filter(mesh => mesh.userData.water)) {
      const vertices = mesh.geometry.getAttribute('position'), indices = mesh.geometry.getIndex();
      for (let i = 0; i < indices.count; i += 3) {
        const points = [0, 1, 2].map(j => new THREE.Vector3().fromBufferAttribute(vertices, indices.getX(i + j)));
        if (new THREE.Triangle(...points).getArea() < .1) continue;
        const center = points.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(1 / 3);
        const origin = new THREE.Vector3(center.x, 1, -center.y);
        const hits = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0), 0, 2).intersectObjects(meshes);
        assert.equal(hits.length, 1, 'There is only one visible ground face at a lake point');
        assert.ok(hits[0].object.userData.water);
        checked++;
      }
    }
    assert.ok(checked > 30, 'Checks cover all three triangulated lakes');
  } finally { meshes.forEach(mesh => mesh.geometry.dispose()); material.dispose(); }
});

test('the unlabeled forecourt is paved once without overlapping water, roads, buildings or the underlying lawn', () => {
  const layout = groundSurfaces(campus);
  const plazas = campus.features.filter(feature => feature.type === 'plaza');
  assert.ok(plazas.length > 0);
  const paving = plazas.flatMap(feature => layout.features.get(feature.id) || []).map(polygon);
  assert.ok(area(paving) > 300, 'The forecourt covers usable space in front of both buildings');
  assert.ok(plazas.every(feature => !feature.name), 'The requested plaza has no map label');
  const excluded = polygonClipping.union(roadMask,
    ...campus.features.filter(feature => feature.type === 'water').map(polygon),
    ...campus.buildings.map(polygon));
  assert.ok(area(polygonClipping.intersection(paving, excluded)) < 1e-7, 'Paving leaves roads, lakes and buildings clear');
  const underlying = [...layout.campus, ...layout.background,
    ...campus.features.filter(feature => ['green', 'sport'].includes(feature.type)).flatMap(feature => layout.features.get(feature.id) || [])];
  for (const surface of underlying) assert.ok(area(polygonClipping.intersection(paving, polygon(surface))) < 1e-7,
    'Plaza and differently colored ground faces never cover the same area');
});

test('joined road bends cover their full width and the bridge approach meets the fork without a gap', () => {
  const routes = [ { points:[[0,0],[10,0],[10,10]],width:4 }, ...campus.features.filter(f=>['way/855459414','local/bridge-upper-approach'].includes(f.id)) ];
  const targets=routes.map(route=>{
    const result=new THREE.Mesh(buildingGeometry(passageFootprint(route.points,route.width),.04,3.6),new THREE.MeshBasicMaterial());
    result.rotation.x=-Math.PI/2; result.position.y=.075; result.updateMatrixWorld(); return result;
  });
  try {
    const fork=routes[1].points[1], entrance=routes[2].points[0];
    for(const [point,meshes] of [[[11, -1],[targets[0]]],[[9,1],[targets[0]]],[fork,targets.slice(1)],[entrance,targets.slice(1)]]) {
      const hits=new THREE.Raycaster(new THREE.Vector3(point[0],1,point[1]),new THREE.Vector3(0,-1,0),0,2).intersectObjects(meshes);
      assert.ok(hits.length,'There is a road surface at each outside miter, inside bend and shared entrance');
      assert.ok(Math.abs(hits[0].point.y-.115)<1e-6,'The repaired road retains its original surface height');
    }
    const layout=groundSurfaces({ boundary:[[-5,-5],[15,-5],[15,15],[-5,15],[-5,-5]],buildings:[],features:[{id:'bend',type:'path',...routes[0]}] });
    const rendered=polygon(passageFootprint(routes[0].points,4));
    assert.ok(area(polygonClipping.intersection(rendered,polygons(layout.campus)))<1e-7,'Ground cuts use the same joined boundary as the visible road');
  } finally { targets.forEach(target=>{target.geometry.dispose();target.material.dispose();}); }
});

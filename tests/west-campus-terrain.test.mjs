import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { terrainRoadGeometry, westCampusTerrainGeometry, WEST_TERRACE_ID, WEST_STAIR_ID } from '../src/west-campus-terrain.ts';
import { rampSurfaceHeight, stairSurfaceHeight } from '../src/terrain-height.ts';
import { roadFootprint } from '../src/road-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const terrace = campus.features.find(f => f.id === WEST_TERRACE_ID);
const raised = ['way/1233313436', 'way/1233313437', 'way/1233313439', 'local/unknown-west-corner'];
const area = polygons => polygons.reduce((sum, polygon) => sum + polygon.reduce((n, ring, i) => {
  const a = Math.abs(ring.slice(1).reduce((a, p, j) => a + ring[j][0] * p[1] - p[0] * ring[j][1], 0)) / 2;
  return n + (i ? -a : a);
}, 0), 0);
const mesh = geometry => { const o = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));o.updateMatrixWorld();return o; };
const down = (objects, point) => new THREE.Raycaster(new THREE.Vector3(point[0], 7, point[1]), new THREE.Vector3(0,-1,0), 0, 10).intersectObjects(objects)[0];

test('the 2.6 metre west terrace supports the four buildings and abuts the unchanged dorm without intruding', () => {
  assert.equal(terrace.height, 2.6);
  for (const id of raised) {
    const building = campus.buildings.find(b => b.id === id);
    assert.equal(building.baseElevation, 2.6);
    assert.ok(area(polygonClipping.difference([building.outer], [terrace.platform.outer])) < .001, id + ' is wholly supported');
  }
  const dorm = campus.buildings.find(b => b.id === 'way/1233313434');
  assert.equal(dorm.baseElevation ?? 0, 0);
  assert.ok(area(polygonClipping.intersection([dorm.outer], [terrace.platform.outer])) < .001);
  assert.ok(terrace.platform.outer.some(p => Math.hypot(p[0] - dorm.outer[0][0], p[1] - dorm.outer[0][1]) < .0001));
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus, 'The model survives a map refresh');
});

test('the bent lower ramp and blue-corner stairs have unobstructed continuous supported surfaces', () => {
  const geometry = westCampusTerrainGeometry(campus.features, campus.buildings), ramp = campus.features.find(f => f.id === 'local/west-lower-ramp'), stair = campus.features.find(f => f.id === WEST_STAIR_ID);
  const road = terrainRoadGeometry(ramp, campus.features), objects = [mesh(geometry.body),mesh(geometry.paving),mesh(geometry.stairs),mesh(road)];
  try {
    const before = JSON.stringify(campus);
    for (let i = 1; i < ramp.points.length; i++) for (const t of [.15,.5,.85]) {
      const a = ramp.points[i-1], b = ramp.points[i], p = a.map((v,j) => v + (b[j]-v)*t), hit = down(objects,p);
      assert.ok(hit);assert.ok(Math.abs(hit.point.y - rampSurfaceHeight(ramp,p) - .115) < .015, 'Whole platform must not fill or cover the slope');
    }
    for (let i = 0; i < stair.riseStair.steps; i++) {
      const t = (i+.5)/stair.riseStair.steps, p = stair.points[0].map((v,j)=>v+(stair.points[1][j]-v)*t), hit=down(objects,p);
      assert.ok(hit);assert.ok(Math.abs(hit.point.y - stairSurfaceHeight(stair,p) - .115) < .0001, 'Each visible tread matches the photo height query');
    }
    const highRoad = campus.features.find(f=>f.id==='way/1233313448'), high = terrainRoadGeometry(highRoad,campus.features);
    try { const a=highRoad.points[0],b=highRoad.points.at(-1),length=Math.hypot(b[0]-a[0],b[1]-a[1]),p=b.map((v,i)=>v-(b[i]-a[i])*.02/length),hit=down([mesh(high)],p);assert.ok(hit&&Math.abs(hit.point.y-2.715)<.0001,'High landing meets the complete stair width'); } finally { high.dispose(); }
    for(const building of campus.buildings.filter(b=>raised.includes(b.id))) {
      const overlap=polygonClipping.intersection([building.outer],[roadFootprint(ramp).outer]);
      for(const [ring] of overlap) {const p=ring.slice(0,-1).reduce((p,q)=>p.map((v,i)=>v+q[i]/(ring.length-1)),[0,0]),hit=down([mesh(geometry.body)],p);assert.ok(hit&&Math.abs(hit.point.y-2.6)<.0001,'Building wall corners keep their full flat foundation');}
    }
    for (const part of Object.values(geometry)) {
      const p=part.attributes.position;for(let i=0;i<p.count;i++)assert.ok(Number.isFinite(p.getX(i))&&Number.isFinite(p.getY(i))&&Number.isFinite(p.getZ(i)));
    }
    assert.ok(Object.values(geometry).reduce((n,g)=>n+g.attributes.position.count/3,0)<10000,'Five static batches keep detail bounded');
    assert.equal(JSON.stringify(campus),before);
  } finally { Object.values(geometry).forEach(g=>g.dispose());road.dispose();objects.forEach(o=>o.material.dispose()); }
});

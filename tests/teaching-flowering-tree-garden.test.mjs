import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { roadFootprint } from '../src/road-geometry.ts';
import { benchGeometry } from '../src/bench-geometry.ts';
import { riverLandscapeGeometry } from '../src/river-landscape.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { seasonalMapColor } from '../src/season-palette.ts';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const corrections=JSON.parse(fs.readFileSync(new URL('../data/campus-corrections.json',import.meta.url)));
const path=campus.features.find(f=>f.id==='local/teaching-flowering-tree-path');
const tree=campus.features.find(f=>f.id==='local/teaching-flowering-tree').trees[0];
const bench=campus.features.find(f=>f.id==='local/teaching-flowering-tree-bench');
const polygon=s=>[s.outer,...s.holes??[]];

test('the photographed tree blooms in spring and switches to seasonal foliage instead of keeping a white crown all year',()=>{
  const expected={spring:'#e7e8d8',summer:'#73955f',autumn:'#c2a05f',winter:'#aab5a7'};
  for(const [season,color] of Object.entries(expected))assert.equal(seasonalMapColor('light',season,tree.crownColor),color);
  assert.equal(new Set(Object.keys(expected).map(season=>seasonalMapColor('dark',season,tree.crownColor))).size,4,'Season switching also works in the dark theme');
});

test('the marked garden route connects both existing paths without entering buildings, the lake or the bench',()=>{
  const footprint=roadFootprint(path);
  assert.equal(path.width,1.2);
  for(const shape of [...campus.buildings,...campus.features.filter(f=>f.type==='water'&&f.outer),bench])
    assert.equal(clip.intersection(polygon(footprint),polygon(shape)).length,0,'The full usable width stays on open land');
  for(const id of ['way/1277839756','local/river-north-bank-path'])
    assert.ok(clip.intersection(polygon(footprint),polygon(roadFootprint(campus.features.find(f=>f.id===id)))).length,'Both path ends meet their existing walking surfaces');
  for(const t of [tree,...campus.features.filter(f=>f.type==='trees'||f.type==='forest').flatMap(f=>f.trees??[])]){
    const r=Math.max(.2,t.radius*.13),[x,z]=t.position;
    const trunk={outer:[[x-r,z-r],[x+r,z-r],[x+r,z+r],[x-r,z+r],[x-r,z-r]],holes:[]};
    assert.equal(clip.intersection(polygon(footprint),polygon(trunk)).length,0,'Tree trunks leave the new walking route clear');
  }
  const landscape=riverLandscapeGeometry(campus.features,campus.buildings),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  try{
    const mesh=new THREE.Mesh(landscape.paths,material);mesh.updateMatrixWorld();
    for(const [x,z] of path.points.slice(6,-6))
      assert.ok(new THREE.Raycaster(new THREE.Vector3(x,1,z),new THREE.Vector3(0,-1,0),0,1).intersectObject(mesh).length,'The actual tan garden surface remains visible along the new route');
  }finally{Object.values(landscape).forEach(g=>g.dispose());material.dispose();}
});

test('the green-point flowering tree and yellow-point usable bench stay beside the route and survive regeneration',()=>{
  assert.deepEqual(tree.position,[75.803,49.245]);
  assert.equal(tree.crownColor,'#e7e8d8');
  assert.deepEqual(bench.bench.center,[77.58,45.248]);
  const geometries=benchGeometry(bench.bench),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  try{
    const mesh=new THREE.Mesh(geometries.seat,material);
    mesh.position.set(bench.bench.center[0],bench.height,bench.bench.center[1]);
    mesh.rotation.y=-Math.atan2(bench.bench.axis[1],bench.bench.axis[0]);mesh.updateMatrixWorld();
    const [x,z]=bench.bench.center;
    const hit=new THREE.Raycaster(new THREE.Vector3(x,1.2,z),new THREE.Vector3(0,-1,0)).intersectObject(mesh)[0];
    assert.ok(hit&&Math.abs(hit.point.y-(bench.height+bench.bench.seatHeight))<1e-6,'The yellow marker contains a real seat at a usable height');
    geometries.supports.computeBoundingBox();assert.ok(Math.abs(geometries.supports.boundingBox.min.y)<1e-6,'Both bench feet reach the ground');
  }finally{Object.values(geometries).forEach(g=>g.dispose());material.dispose();}
  assert.deepEqual(applyCampusCorrections(campus,corrections),campus,'Refreshing the source map retains all three additions');
});

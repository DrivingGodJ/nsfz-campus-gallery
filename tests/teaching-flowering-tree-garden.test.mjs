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
const ringBench=campus.features.find(f=>f.id==='local/teaching-flowering-tree-ring-bench');
const polygon=s=>[s.outer,...s.holes??[]];

test('the photographed tree blooms in spring and switches to seasonal foliage instead of keeping a white crown all year',()=>{
  const expected={spring:'#e7e8d8',summer:'#73955f',autumn:'#c2a05f',winter:'#aab5a7'};
  for(const [season,color] of Object.entries(expected))assert.equal(seasonalMapColor('light',season,tree.crownColor),color);
  assert.equal(new Set(Object.keys(expected).map(season=>seasonalMapColor('dark',season,tree.crownColor))).size,4,'Season switching also works in the dark theme');
});

test('the marked garden route connects both existing paths without entering buildings, the lake or the bench',()=>{
  const footprint=roadFootprint(path);
  assert.equal(path.width,1.2);
  for(const shape of [...campus.buildings,...campus.features.filter(f=>f.type==='water'&&f.outer),bench,ringBench])
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
    for(const [x,z] of path.points.slice(6,-6).filter(p=>Math.hypot(p[0]-tree.position[0],p[1]-tree.position[1])>1.55))
      assert.ok(new THREE.Raycaster(new THREE.Vector3(x,1,z),new THREE.Vector3(0,-1,0),0,1).intersectObject(mesh).length,'The actual tan garden surface remains visible along the new route');
  }finally{Object.values(landscape).forEach(g=>g.dispose());material.dispose();}
});

test('the marked tree is centred inside its ring bench while the original short bench survives regeneration',()=>{
  assert.deepEqual(tree.position,[76.5843,42.2968]);
  assert.deepEqual(ringBench.bench.center,tree.position);
  assert.equal(ringBench.bench.innerRadius,.8);
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
  assert.deepEqual(applyCampusCorrections(campus,corrections),campus,'Refreshing the source map retains the relocated tree, both benches and the ring path');
});

test('the surrounding path is a complete walkable ring with an open tree well and two connected approach paths',()=>{
  const footprint=roadFootprint(path),[x,z]=tree.position;
  assert.equal(footprint.holes.length,1,'The old through-path is removed from the central tree well');
  const landscape=riverLandscapeGeometry(campus.features,campus.buildings),material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(landscape.paths,material);mesh.updateMatrixWorld();
  const hits=(px,pz)=>new THREE.Raycaster(new THREE.Vector3(px,1,pz),new THREE.Vector3(0,-1,0),0,1).intersectObject(mesh);
  try{
    assert.equal(hits(x,z).length,0,'The paving does not cover the tree roots');
    for(let i=0;i<64;i++){
      const angle=(i+.5)*Math.PI*2/64;
      for(const radius of [1.48,1.85,2.22])assert.ok(hits(x+Math.cos(angle)*radius,z+Math.sin(angle)*radius).length,'The full walking width continues around every side of the seat');
      assert.equal(hits(x+Math.cos(angle)*1.3,z+Math.sin(angle)*1.3).length,0,'The wood seat is separated from the surrounding walking surface');
    }
    for(const p of [path.points[25],path.points[47]])assert.ok(hits(...p).length,'Both original approach paths still reach the circular path');
  }finally{Object.values(landscape).forEach(g=>g.dispose());material.dispose();}
});

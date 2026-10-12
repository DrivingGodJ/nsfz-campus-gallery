import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { teachingStairGeometry } from '../src/teaching-stairs.ts';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const corrections=JSON.parse(fs.readFileSync(new URL('../data/campus-corrections.json',import.meta.url)));
const site=JSON.parse(fs.readFileSync(new URL('../public/data/site.json',import.meta.url)));
const building=campus.buildings.find(b=>b.id==='way/855459420');
const stair=building.stairwells.find(s=>s.partId==='sixth-floor-wing'&&!s.followWalls);
const round=building.stairwells.find(s=>s.followWalls);
const info=buildingLevels(building,site.buildingOverrides[building.id]);
const section=info.sections.find(s=>s.id===stair.partId);
const oldStair={...stair,roofAccess:{height:2.6,openEdges:[0,4]}},oldRound={...round,roofAccess:{height:2.6,openEdges:[9]}};
const fullGreen=[
  [84.78013732144802,73.42925836758992],[97.09476927188014,71.53681399456066],
  [97.88431102843745,76.72710529800909],[85.6242094333004,78.59209929989959],
  [84.78013732144802,73.42925836758992],
];
function body(stairs,cut){
  return buildingGeometry(section,cut?cut*info.floorHeight:section.height,info.floorHeight,building.groundPassages,
    building.floorCorridors.filter(c=>c.partId===section.id),stairs,building.classroomWindows,
    building.solidCores.filter(c=>c.partId===section.id),building.cutouts.filter(c=>c.partId===section.id),!!cut);
}
function mesh(geometry,body=false){const object=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  if(body){object.rotation.x=-Math.PI/2;object.position.y=.12}object.updateMatrixWorld();return object;}

test('the square seventh-level roof room follows the green horizontal box, excludes the lower room and rises3.6metres',()=>{
  assert.equal(stair.roofAccess.height,3.6);assert.deepEqual(stair.roofAccess.openEdges,[]);
  assert.deepEqual(stair.roofAccess.footprint.outer,fullGreen);
  assert.deepEqual(stair.opening.outer,[
    [88.28336091436184,76.26365190110802],[88.78209915909265,72.81425905691522],
    [97.09476927188014,71.53681399456066],[97.88431102843745,76.72710529800909],
    [88.59027271957042,78.14090481385101],[88.28336091436184,76.26365190110802],
  ],'Ordinary floors retain the original square stair enclosure');
  const [a,b]=[section.holes[0][3],section.holes[0][0]],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
  for(const p of [fullGreen[0],fullGreen[3]])assert.ok(Math.abs((p[0]-a[0])*dz-(p[1]-a[1])*dx)/length<1e-9,'The green box reaches the existing courtyard boundary exactly');
  assert.equal(round.roofAccess,undefined,'The red half-round staircase stops at six floors');
  const saved=corrections.buildings.find(b=>b.id===building.id);
  assert.deepEqual(saved.stairwells.find(s=>s.origin[0]===stair.origin[0]).roofAccess,stair.roofAccess);
  assert.equal(saved.stairwells.find(s=>s.followWalls).roofAccess,undefined,'Map refresh cannot restore the removed round roof room');
  const geometry=body([stair,round]),object=mesh(geometry,true),roof=.12+section.height;
  const down=(p,y)=>new THREE.Raycaster(new THREE.Vector3(p[0],y,p[1]),new THREE.Vector3(0,-1,0)).intersectObject(object)[0];
  try{
    for(const t of [.2,.5,.8]){
      const west=fullGreen[0].map((n,i)=>n+(fullGreen[3][i]-n)*t),east=fullGreen[1].map((n,i)=>n+(fullGreen[2][i]-n)*t);
      const p=west.map((n,i)=>n+(east[i]-n)*.12),top=down(p,roof+5);
      assert.ok(top&&Math.abs(top.point.y-roof-3.6)<1e-4,'The added left corridor area has the full new top cap');
      const floor=down(p,roof+1);assert.ok(floor&&Math.abs(floor.point.y-roof-.25)<1e-4,'The extension retains a roof-level floor');
    }
    const lower=[93.5,80.0],cap=down(lower,roof+5);
    assert.ok(cap&&Math.abs(cap.point.y-roof)<1e-4,'The small room below the marked rectangle retains its original roof height');
    const positions=geometry.attributes.position;
    for(let i=0;i<positions.count;i++)if(positions.getX(i)<80)assert.ok(positions.getZ(i)<=section.height+1e-4,'No seventh-level mass remains over the half-round stair');
  }finally{geometry.dispose();object.material.dispose()}
});

test('the new green rooftop footprint leaves all six occupied-floor cutaways and the square flights unchanged',()=>{
  for(const floor of [1,2,3,4,5,6]){
    const old=body([oldStair,oldRound],floor),now=body([stair,round],floor);
    assert.deepEqual(now.attributes.position.array,old.attributes.position.array,'All occupied walls and slabs match for the same selected floor');
    old.dispose();now.dispose();
  }
  const make=(s,cut)=>teachingStairGeometry({...building,stairwells:[s]},info.sections,info.floorHeight,cut&&cut*info.floorHeight);
  for(const [before,after,cut]of[[oldStair,stair,undefined],[oldRound,round,5]]){
    const old=make(before,cut),now=make(after,cut);
    for(const name of ['concrete','rails']){assert.deepEqual(now[name].attributes.position.array,old[name].attributes.position.array,
      'The square flights stay unchanged, and all half-round flights before the removed sixth-to-roof flight stay unchanged');old[name].dispose();now[name].dispose()}
  }
});

test('the complete model preserves existing occupied walls and slabs below its sixth-floor roof slab',()=>{
  const old=body([oldStair,oldRound]),now=body([stair,round]),limit=section.height-.25;
  const triangles=geometry=>{
    const p=geometry.attributes.position,result=[];
    for(let i=0;i<p.count;i+=3){const points=Array.from({length:3},(_,k)=>[p.getX(i+k),p.getY(i+k),p.getZ(i+k)]);
      if(points.every(p=>p[2]<=limit+1e-5)&&points.some(p=>p[2]<limit-1e-5))result.push(JSON.stringify(points.map(p=>p.map(n=>Math.round(n*1e5)/1e5)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));
    }return result.sort();
  };
  try{assert.deepEqual(triangles(now),triangles(old),'Only the normal roof cap and the seventh-level roof room change; all lower complete-model surfaces remain identical')}
  finally{old.dispose();now.dispose()}
});

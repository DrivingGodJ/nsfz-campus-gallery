import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import {buildingGeometry} from '../src/building-geometry.ts';
import {buildingLevels} from '../src/building-model.ts';
import {teachingRailGeometry} from '../src/architecture-geometry.ts';
import {riverLandscapeGeometry, riverBenches} from '../src/river-landscape.ts';
import {pergolaFootprint, pergolaLayout} from '../src/garden-geometry.ts';
import {wisteriaArchitecture, libraryAnnexLayout} from '../src/wisteria-architecture.ts';
const campus=JSON.parse(await fs.readFile(new URL('../public/data/campus.json',import.meta.url)));
const site=JSON.parse(await fs.readFile(new URL('../public/data/site.json',import.meta.url)));
const corrections=JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json',import.meta.url)));
const building=campus.buildings.find(b=>b.id==='way/855459420'),info=buildingLevels(building,site.buildingOverrides[building.id]),section=info.sections.find(s=>s.id==='main');
const mesh=g=>{const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));m.updateMatrixWorld();return m;};
const cleanup=meshes=>meshes.forEach(m=>{m.geometry.dispose();m.material.dispose();});
const area=polys=>polys.reduce((sum,poly)=>sum+poly.reduce((sum,ring,i)=>sum+(i?-1:1)*Math.abs(ring.slice(1).reduce((s,p,i)=>s+ring[i][0]*p[1]-p[0]*ring[i][1],0))/2,0),0);

test('the west stair-side room is enclosed on floors two through four, with a clear door below its lintel',()=>{
  const room=building.solidCores.find(c=>c.partId==='main'&&c.startFloor===2&&c.endFloor===4);
  assert.equal(room.startFloor,2);
  const upper=building.solidCores.find(c=>c.partId==='main'&&c.startFloor===5&&c.outer[0][0]===room.outer[0][0]);
  assert.ok(upper&&upper.outer.length===6,'Floor five keeps its original compact room');
  assert.deepEqual(corrections.buildings.find(b=>b.id===building.id).solidCores,building.solidCores);
  const geometry=buildingGeometry(section,section.height,info.floorHeight,building.groundPassages,building.floorCorridors.filter(c=>c.partId==='main'),building.stairwells.filter(s=>s.partId==='main'),building.classroomWindows,building.solidCores.filter(c=>c.partId==='main'),building.cutouts.filter(c=>c.partId==='main'));
  geometry.rotateX(-Math.PI/2);geometry.translate(0,.12,0);
  const body=mesh(geometry),rails=mesh(teachingRailGeometry(building,info.sections,info.floorHeight));
  const a=room.outer[9],u=new THREE.Vector3(.9868974432552757,0,-.16134880382636804),v=new THREE.Vector3(-u.z,0,u.x);
  const width=(room.outer[3][0]-a[0])*u.x+(room.outer[3][1]-a[1])*u.z;
  assert.ok(width>3.8,'The recessed entrance wall moves out to the stair-side plane');
  for(const p of room.outer.slice(3,8)){
    const delta=[p[0]-room.outer[3][0],p[1]-room.outer[3][1]];
    assert.ok(Math.abs(delta[0]*u.x+delta[1]*u.z)<1e-4,'The entrance has no inset from the stair-side wall plane');
  }
  const at=(along,across,y)=>new THREE.Vector3(a[0],y,a[1]).addScaledVector(u,along).addScaledVector(v,across);
  try{
    for(let floor=1;floor<=5;floor++){
      const base=.12+(floor-1)*info.floorHeight, enclosed=floor>=2&&floor<=4;
      const wall=new THREE.Raycaster(at(width+.4,.5,base+1.5),u.clone().negate(),0,.8).intersectObject(body);
      assert.equal(!!wall.length,enclosed,`Only floors two through four have the copied side wall on floor ${floor}`);
      const door=new THREE.Raycaster(at(width+.4,1.4,base+1.5),u.clone().negate(),0,.8);
      assert.equal(door.intersectObject(body).length,0,'The corridor-side door is a real opening');
      assert.equal(!!new THREE.Raycaster(at(width+.4,1.4,base+2.8),u.clone().negate(),0,.8).intersectObject(body).length,enclosed,'The opening retains its lintel');
      if(enclosed){
        assert.ok(new THREE.Raycaster(at(1,3.4,base+1.5),v.clone().negate(),0,.8).intersectObject(body).length,'The small room has its south closing wall');
        assert.equal(new THREE.Raycaster(at(-.4,1.5,base+.75),u,0,.8).intersectObject(rails).length,0,'No obsolete blue guard survives outside the new west wall');
        const down=new THREE.Raycaster(at(1,1.5,base+1),new THREE.Vector3(0,-1,0),0,1).intersectObject(body)[0];
        assert.ok(down&&Math.abs(down.point.y-(base+.25))<1e-5,'The room is hollow with a supported floor');
      }
    }
  }finally{cleanup([body,rails]);}
});

test('the river-side seat is removed and the inland seat sits beside and parallel to the main path',()=>{
  const geometry=riverLandscapeGeometry(campus.features,campus.buildings),timber=mesh(geometry.timber);
  try{
    for(const z of [6.25,9.95])assert.equal(new THREE.Raycaster(new THREE.Vector3(102.6,1,z),new THREE.Vector3(0,-1,0),0,1).intersectObject(timber).length,0,'Neither old seat remains beside the tree');
    const seat=riverBenches.find(b=>b.center[0]>100),hit=new THREE.Raycaster(new THREE.Vector3(seat.center[0],1,seat.center[1]),new THREE.Vector3(0,-1,0),0,1).intersectObject(timber)[0];
    assert.ok(hit&&Math.abs(hit.point.y-.525)<1e-5,'The moved backless wood seat renders at the roadside');
    const road=campus.features.find(f=>f.id==='way/1277839758'),[a,b]=road.points,dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);
    const distance=Math.abs(dx*(seat.center[1]-a[1])-dz*(seat.center[0]-a[0]))/length;
    assert.ok(distance>road.width/2+.4&&distance<road.width/2+1.5,'The bench leaves the walking surface clear while staying beside it');
    assert.ok(Math.abs(Math.cos(seat.angle)*dx/length-Math.sin(seat.angle)*dz/length)>.999,'The seat follows the path direction');
  }finally{timber.material.dispose();Object.values(geometry).forEach(g=>g.dispose());}
});

test('the new arcade branch has a continuous roof and floor, clear central passage, and joins the existing covered end at its side opening',()=>{
  const feature=campus.features.find(f=>f.id==='local/wisteria-pergola'),library=campus.buildings.find(b=>b.id==='way/855459419');
  assert.deepEqual(corrections.features.find(f=>f.id===feature.id),feature);
  const footprint=pergolaFootprint(feature),layout=pergolaLayout(feature),annex=libraryAnnexLayout(library),model=wisteriaArchitecture(feature,library),meshes=Object.fromEntries(Object.entries(model).map(([k,g])=>[k,mesh(g)]));
  assert.equal(clip.union(footprint.map(s=>[s.outer,...s.holes]),[annex.footprint.outer]).length,1,'Both arcade floors join through the existing covered end');
  const route=feature.branches[0];assert.ok(route.reduce((n,p,i)=>n+(i?Math.hypot(p[0]-route[i-1][0],p[1]-route[i-1][1]):0),0)>20);
  try{
    for(const obstacle of [...campus.buildings,...campus.features.filter(f=>f.type==='water'||f.id==='local/library-parallel-bars'),annex.footprint])assert.ok(area(clip.intersection(footprint.map(s=>[s.outer,...s.holes]),[obstacle.outer,...(obstacle.holes||[])]))<1e-6,'The branch leaves buildings, warehouse, parallel bars and water clear');
    assert.ok(route.at(-1)[0]>=90&&route.slice(3).every(p=>p[1]>105),'The branch follows the marked outer strip and reaches its far end');
    const start=route[0],offset=[start[0]-annex.at(0,0)[0],start[1]-annex.at(0,0)[1]],sideU=offset[0]*annex.along[0]+offset[1]*annex.along[1];
    const inside=annex.at(sideU,annex.depth-1.5),direction=new THREE.Vector3(annex.out[0],0,annex.out[1]);
    assert.equal(new THREE.Raycaster(new THREE.Vector3(inside[0],1.6,inside[1]),direction,0,3).intersectObjects([meshes.room,meshes.posts,meshes.arches]).length,0,'The side connection is a real opening, with no wall or post across it');
    for(let i=0;i<route.length;i++){
      const p=i?route[i]:[route[i][0]+annex.out[0]*.1,route[i][1]+annex.out[1]*.1],down=new THREE.Vector3(0,-1,0),above=new THREE.Vector3(p[0],layout.height+1,p[1]);
      assert.ok(new THREE.Raycaster(above,down,0,2).intersectObjects([meshes.canopy,meshes.roof]).length,'The full branch is covered at the same canopy height');
      assert.ok(new THREE.Raycaster(new THREE.Vector3(p[0],1,p[1]),down,0,1).intersectObject(meshes.floor).length,'The full branch receives its walking floor');
      if(i){const direction=new THREE.Vector3(p[0]-route[i-1][0],0,p[1]-route[i-1][1]).normalize();assert.equal(new THREE.Raycaster(new THREE.Vector3(p[0],1.6,p[1]),direction,0,.35).intersectObjects([meshes.posts,meshes.arches,meshes.room]).length,0,'Spaced columns and arches leave the route passable');}
    }
  }finally{cleanup(Object.values(meshes));}
});

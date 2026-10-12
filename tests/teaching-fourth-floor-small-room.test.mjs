import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { solidCoreWindowLayout } from '../src/teaching-classrooms.ts';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const corrections=JSON.parse(fs.readFileSync(new URL('../data/campus-corrections.json',import.meta.url)));
const site=JSON.parse(fs.readFileSync(new URL('../public/data/site.json',import.meta.url)));
const building=campus.buildings.find(b=>b.id==='way/855459420');
const room=building.solidCores.find(c=>c.partId==='main'&&c.startFloor===2&&c.outer[0][0]===91.74712393299268);
const upper=building.solidCores.find(c=>c.partId===room.partId&&c.startFloor===5&&c.outer[0][0]===room.outer[0][0]);
const info=buildingLevels(building,site.buildingOverrides[building.id]),main=info.sections.find(s=>s.id==='main');
const old={...building,solidCores:building.solidCores.map(c=>c===room?{...c,endFloor:3}:c===upper?{...c,startFloor:4}:c)};
const mesh=(geometry,body=false)=>{const object=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  if(body){object.rotation.x=-Math.PI/2;object.position.y=.12}object.updateMatrixWorld();return object;};
const body=(b,cut)=>buildingGeometry(main,cut?cut*info.floorHeight:main.height,info.floorHeight,b.groundPassages,
  b.floorCorridors.filter(c=>c.partId===main.id),b.stairwells.filter(c=>c.partId===main.id),b.classroomWindows,
  b.solidCores.filter(c=>c.partId===main.id),b.cutouts.filter(c=>c.partId===main.id),!!cut);
function crossing(a,b,t,y){
  const from=new THREE.Vector3(a[0],y,a[1]),to=new THREE.Vector3(b[0],y,b[1]);
  const along=to.clone().sub(from).normalize(),normal=new THREE.Vector3(-along.z,0,along.x);
  return new THREE.Raycaster(from.lerp(to,t).addScaledVector(normal,-.5),normal,0,1);
}

test('floor four has the same complete small room and open door as floors two and three, without the old compact inner wall',()=>{
  assert.equal(room.endFloor,4);assert.equal(upper.startFloor,5);assert.deepEqual(room.doors,[{edge:5,height:2.5}]);
  assert.ok(room.classroomWindows&&upper.classroomWindows);
  const saved=corrections.buildings.find(b=>b.id===building.id);
  assert.deepEqual(saved.solidCores,building.solidCores,'A map refresh keeps the corrected non-overlapping floor intervals');
  const geometry=body(building),walls=mesh(geometry,true),glazing=teachingWindowGeometry(building,[main],info.floorHeight);
  const glass=mesh(glazing.glass),frames=mesh(glazing.frames),all=[walls,glass,frames];
  try{
    for(const floor of [2,3,4]){
      const y=.12+(floor-1)*info.floorHeight;
      for(const edge of [3,4,6,7,8])for(const rise of [.6,1.6,2.4]){
        assert.ok(crossing(room.outer[edge],room.outer[edge+1],.5,y+rise).intersectObject(walls).length,
          'The copied room keeps real opaque masonry around every non-window return');
      }
      for(const t of [.15,.5,.85]){
        for(const rise of [.6,1.6,2.4])assert.equal(crossing(room.outer[5],room.outer[6],t,y+rise).intersectObjects(all).length,0,
          'The one-metre doorway is open across its width and retains its2.5m headroom');
        assert.ok(crossing(room.outer[5],room.outer[6],t,y+2.8).intersectObject(walls).length,'A real lintel remains above the door');
      }
      for(const rise of [.6,1.6,2.8])assert.equal(crossing(upper.outer[3],upper.outer[4],.5,y+rise).intersectObjects(all).length,0,
        'No former compact-room end wall or pane divides the copied larger room');
    }
    for(const rise of [.6,1.6,2.8])assert.ok(crossing(upper.outer[3],upper.outer[4],.5,.12+4*info.floorHeight+rise).intersectObject(walls).length,
      'Floor five retains its original compact-room end wall');
  }finally{all.forEach(o=>{o.geometry.dispose();o.material.dispose()})}
});

test('copying the small room to four preserves floors one through three and five, including their glazing',()=>{
  for(const floor of [1,2,3]){
    const before=body(old,floor),after=body(building,floor);
    assert.deepEqual(after.attributes.position.array,before.attributes.position.array,'Selected unchanged floors retain identical complete wall and slab geometry');
    before.dispose();after.dispose();
  }
  const windows=b=>solidCoreWindowLayout(b.solidCores.filter(c=>c.partId===main.id),main.height,info.floorHeight);
  const beforeWindows=windows(old),afterWindows=windows(building);
  for(const floor of [1,2,3,5])assert.deepEqual(afterWindows.filter(w=>w.bottom>=(floor-1)*info.floorHeight&&w.bottom<floor*info.floorHeight),
    beforeWindows.filter(w=>w.bottom>=(floor-1)*info.floorHeight&&w.bottom<floor*info.floorHeight),'Unchanged floors keep every calibrated pane at its original position');
  const triangles=(geometry,min)=>{
    const p=geometry.attributes.position,result=[];
    for(let i=0;i<p.count;i+=3){const points=Array.from({length:3},(_,k)=>[p.getX(i+k),p.getY(i+k),p.getZ(i+k)]);
      if(points.every(p=>p[2]>=min-1e-5))result.push(JSON.stringify(points.map(p=>p.map(n=>Math.round(n*1e5)/1e5)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));
    }return result.sort();
  };
  const before=body(old),after=body(building);
  try{assert.deepEqual(triangles(after,4*info.floorHeight+.25),triangles(before,4*info.floorHeight+.25),
    'The complete fifth-floor surfaces, walls, windows and original roof remain unchanged')}
  finally{before.dispose();after.dispose()}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { classroomAt, CLASSROOM_BAYS, teachingClassroomFurniture } from '../src/teaching-classroom-furniture.ts';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const site=JSON.parse(fs.readFileSync(new URL('../public/data/site.json',import.meta.url)));
const building=campus.buildings.find(b=>b.id==='way/855459420');
const wall=building.solidCores.find(c=>c.partition);
const along=new THREE.Vector3(.9868974432552757,0,-.16134880382636804);
const point=(u,v,y)=>{const [x,z]=classroomAt(u,v);return new THREE.Vector3(x,y,z)};
const mesh=(geometry,body=false)=>{const object=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));if(body){object.rotation.x=-Math.PI/2;object.position.y=.12}object.updateMatrixWorld();return object};
function model(floorHeight,cut){
  const info=buildingLevels(building,{...site.buildingOverrides[building.id],floorHeight});
  const objects=info.sections.map(s=>mesh(buildingGeometry(s,Math.min(s.height,(cut??Infinity)*floorHeight),floorHeight,building.groundPassages,
    building.floorCorridors.filter(c=>c.partId===s.id),building.stairwells.filter(c=>c.partId===s.id),building.classroomWindows,
    building.solidCores.filter(c=>c.partId===s.id),building.cutouts.filter(c=>c.partId===s.id),!!cut),true));
  const glazing=teachingWindowGeometry(building,info.sections,floorHeight,cut&&cut*floorHeight),glass=mesh(glazing.glass),frames=mesh(glazing.frames);
  return{info,objects,glass,frames,dispose(){objects.forEach(o=>{o.geometry.dispose();o.material.dispose()});Object.values(glazing).forEach(g=>g.dispose());glass.material.dispose();frames.material.dispose()}};
}

test('the joining partition moves about5.8metres into the wing and remains one0.28metre leaf on floors2–5',()=>{
  assert.ok(wall);assert.equal(wall.startFloor,2);assert.equal(wall.endFloor,5);
  for(const floorHeight of [2.4,3.6,4.2]) for(const cut of [undefined,3,6]){
    const current=model(floorHeight,cut);
    try{
      for(let level=0;level<(cut||6);level++) for(const v of [67.3,70.55,73.7]){
        const y=.12+level*floorHeight+1.6;
        const ray=new THREE.Raycaster(point(73.5,v,y),along,0,1.5),hit=ray.intersectObjects(current.objects)[0];
        if(level>=1&&level<=4){
          assert.ok(hit&&Math.abs(hit.distance-.5)<1e-4,'The moved wall begins exactly at u74');
          const back=new THREE.Raycaster(point(75,v,y),along.clone().negate(),0,1.5).intersectObjects(current.objects)[0];
          assert.ok(back&&Math.abs(back.distance-.72)<1e-4,'The single wall ends at u74.28');
          assert.equal(ray.intersectObjects([current.glass,current.frames]).length,0,'The new partition is opaque rather than a glazing bay');
        }else assert.equal(hit,undefined,'No ghost wall appears below or above its actual floor interval');
      }
      for(let level=1;level<Math.min(cut||6,5);level++){
        const y=.12+level*floorHeight+1.6;
        assert.equal(new THREE.Raycaster(point(79,70.55,y),along,0,1.6).intersectObjects([...current.objects,current.glass,current.frames]).length,0,'Both old wall leaves and their glazing are removed');
        for(const u of [73.9,74.4,79.78,79.84]){
          const top=.12+level*floorHeight+Math.min(.25,floorHeight*.1);
          const hit=new THREE.Raycaster(point(u,70.55,top+.1),new THREE.Vector3(0,-1,0),0,.2).intersectObjects(current.objects)[0];
          assert.ok(hit&&Math.abs(hit.point.y-top)<1e-4,'Moving the partition never cuts a slit through its floor');
        }
      }
      assert.equal(current.info.sections.find(s=>s.id==='main').floors,5);assert.equal(current.info.sections.find(s=>s.id==='sixth-floor-wing').floors,6);
    }finally{current.dispose()}
  }
});

test('the left classroom teaching end follows the moved wall and all chair assemblies remain clear of it',()=>{
  const info=buildingLevels(building,site.buildingOverrides[building.id]),bay=CLASSROOM_BAYS.find(b=>b.id==='wing-east-3');
  assert.equal(bay.u,73.8);
  const geometry=teachingClassroomFurniture(building,info.sections,info.floorHeight),u=p=>.9868974432552757*p[0]-.16134880382636804*p[2];
  for(const name of ['wood','metal','boards','storage']){
    const p=geometry[name].attributes.position;
    for(let i=0;i<p.count;i++){
      const xyz=[p.getX(i),p.getY(i),p.getZ(i)],station=u(xyz),v=.16134880382636804*xyz[0]+.9868974432552757*xyz[2];
      assert.equal(station>74+1e-5&&station<74.28-1e-5&&v>66.82&&v<74.13&&xyz[1]>info.floorHeight,false,'No retained desk, chair, board or cabinet penetrates the relocated wall');
    }
  }
  Object.values(geometry).forEach(g=>g.dispose());
});

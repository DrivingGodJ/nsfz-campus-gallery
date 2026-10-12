import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry, buildingCoreFootprint, buildingSectionWindows, passageShape } from '../src/building-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { solidCoreWindowLayout } from '../src/teaching-classrooms.ts';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const corrections=JSON.parse(fs.readFileSync(new URL('../data/campus-corrections.json',import.meta.url)));
const site=JSON.parse(fs.readFileSync(new URL('../public/data/site.json',import.meta.url)));
const building=campus.buildings.find(b=>b.id==='way/855459420');
const info=buildingLevels(building,site.buildingOverrides[building.id]),main=info.sections.find(s=>s.id==='main'),wing=info.sections.find(s=>s.id==='sixth-floor-wing');
function ordinaryWindows(section,b=building){
  const solids=b.solidCores.filter(c=>c.partId===section.id),stairs=b.stairwells.filter(s=>s.partId===section.id);
  const core=buildingCoreFootprint(section,b.groundPassages,b.floorCorridors.filter(c=>c.partId===section.id),stairs,solids,b.cutouts.filter(c=>c.partId===section.id));
  const ground=b.groundPassages.map(p=>{const s=passageShape(p);return[s.outer,...s.holes]});
  const exclusions=[...solids.filter(c=>!c.partition).map(c=>[c.outer,...c.holes]),...stairs.filter(s=>s.internal).map(s=>[s.opening.outer,...s.opening.holes])];
  return {core,windows:buildingSectionWindows(section,core,b.classroomWindows,section.height,info.floorHeight,ground,exclusions,ground.filter((_,i)=>b.groundPassages[i].recessClassrooms))};
}
const mesh=(geometry,body=false)=>{const object=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  if(body){object.rotation.x=-Math.PI/2;object.position.y=.12}object.updateMatrixWorld();return object;};
function crossing(point,normal,y){return new THREE.Raycaster(new THREE.Vector3(point[0],y,point[1]).addScaledVector(normal,-.6),normal,0,1.2)}
function belongs(window,a,b,inset){
  const dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
  return [window.from,window.to].every(p=>Math.abs(Math.abs((p[0]-a[0])*dz-(p[1]-a[1])*dx)/len-inset)<1e-4&&
    ((p[0]-a[0])*dx+(p[1]-a[1])*dz)/len>=-.0001&&((p[0]-b[0])*dx+(p[1]-b[1])*dz)/len<=.0001);
}

test('actual straight classroom windows fill their measured bays with18cm joints and9cm end margins',()=>{
  assert.equal(building.classroomWindows.straightWindowGap,.18);
  const saved=corrections.buildings.find(b=>b.id===building.id);assert.deepEqual(saved.classroomWindows,building.classroomWindows);
  assert.deepEqual(saved.solidCores,building.solidCores);
  const {core,windows}=ordinaryWindows(main),[a,b]=core[0][0].slice(0,2),dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),along=new THREE.Vector3(dx/length,0,dz/length),normal=new THREE.Vector3(-along.z,0,along.x);
  const panes=windows.filter(w=>w.bottom<info.floorHeight&&belongs(w,a,b,building.classroomWindows.wallThickness/2));
  const station=p=>((p[0]-a[0])*dx+(p[1]-a[1])*dz)/length;
  panes.sort((x,y)=>station(x.from)-station(y.from));
  assert.ok(panes.length>=3,'The actual long north facade supplies multiple adjacent windows');
  assert.ok(Math.abs(station(panes[0].from)-.09)<1e-6);
  assert.ok(Math.abs(station(panes.at(-1).to)-(length-.09))<1e-6);
  const body=mesh(buildingGeometry(main,main.height,info.floorHeight,building.groundPassages,building.floorCorridors.filter(c=>c.partId===main.id),building.stairwells.filter(s=>s.partId===main.id),building.classroomWindows,building.solidCores.filter(c=>c.partId===main.id),building.cutouts.filter(c=>c.partId===main.id)),true);
  const model=teachingWindowGeometry(building,[main],info.floorHeight),glass=mesh(model.glass),frames=mesh(model.frames);
  try{
    for(const [i,pane]of panes.entries()){
      assert.ok(Math.abs(Math.hypot(pane.to[0]-pane.from[0],pane.to[1]-pane.from[1])-(length/panes.length-.18))<1e-6,'A long window fills its entire actual bay');
      assert.equal(pane.mullions.length,5);
      pane.mullions.forEach((station,i)=>assert.ok(Math.abs(station-i/4)<1e-12,'The original four frame divisions stay unchanged'));
      assert.equal(pane.bottom,.85);assert.equal(pane.top,3.1);
      const center=pane.from.map((n,j)=>(n+pane.to[j])/2),ray=crossing(center,normal,.12+1.6);
      assert.equal(ray.intersectObject(body).length,0,'Every long pane occupies a real clear masonry aperture');
      assert.ok(ray.intersectObject(glass).length,'The extended opening contains actual glazing');
      if(!i)continue;
      assert.ok(Math.abs(station(pane.from)-station(panes[i-1].to)-.18)<1e-6,'Adjacent panes retain exactly18cm of wall');
      const point=pane.from.map((n,j)=>(n+panes[i-1].to[j])/2),joint=crossing(point,normal,.12+1.6);
      assert.ok(joint.intersectObject(body).length,'The narrow joint still has real opaque masonry');
      assert.equal(joint.intersectObjects([glass,frames]).length,0,'Window frames do not cross the small wall joint');
    }
  }finally{[body,glass,frames].forEach(o=>{o.geometry.dispose();o.material.dispose()})}
});

test('rounded facade windows retain their exact original layouts while all straight teaching-room configs use the small gap',()=>{
  const before=structuredClone(building);delete before.classroomWindows.straightWindowGap;
  before.solidCores.forEach(c=>{if(c.classroomWindows)delete c.classroomWindows.straightWindowGap});
  const rounds=building.solidCores.filter(c=>c.classroomWindows?.facadeLines?.some(line=>line.length>7));
  assert.equal(rounds.length,2);
  assert.deepEqual(solidCoreWindowLayout(rounds,wing.height,info.floorHeight),
    solidCoreWindowLayout(before.solidCores.filter(c=>rounds.some(r=>JSON.stringify(r.outer)===JSON.stringify(c.outer))),wing.height,info.floorHeight),'Both dedicated semicircle windows stay exactly as photographed');
  const old=ordinaryWindows(wing,before).windows,current=ordinaryWindows(wing).windows;
  const curveEdges=[wing.outer.slice(26,31),wing.outer.slice(31,36)].flatMap(line=>line.slice(1).map((b,i)=>({a:line[i],b})));
  const onCurve=w=>curveEdges.some(({a,b})=>belongs(w,a,b,building.classroomWindows.wallThickness/2));
  const oldCurve=old.filter(onCurve);assert.ok(oldCurve.length>0,'Actual upper-front curved bays are included in the preservation check');
  assert.deepEqual(current.filter(onCurve),oldCurve,'The global straight calibration does not widen the imported rounded protrusions');
  for(const core of building.solidCores.filter(c=>c.classroomWindows&&!rounds.includes(c)))assert.equal(core.classroomWindows.straightWindowGap,.18,'Independent straight room glazing uses the same small joint');
});

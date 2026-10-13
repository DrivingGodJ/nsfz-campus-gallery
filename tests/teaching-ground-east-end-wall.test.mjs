import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { buildingCoreFootprint, buildingGeometry, buildingSectionWindows, passageShape } from '../src/building-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { solidCoreWindowLayout } from '../src/teaching-classrooms.ts';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const corrections=JSON.parse(fs.readFileSync(new URL('../data/campus-corrections.json',import.meta.url)));
const site=JSON.parse(fs.readFileSync(new URL('../public/data/site.json',import.meta.url)));
const building=campus.buildings.find(b=>b.id==='way/855459420'),info=buildingLevels(building,site.buildingOverrides[building.id]);
const wing=info.sections.find(p=>p.id==='sixth-floor-wing');
const target=[[87.49832817665866,53.13361951604306],[88.9233261779807,61.38669928542471]];
const original=[[89.47396089486412,52.82109838093125],[90.89711021655964,61.063471257803904]];
const key=value=>JSON.stringify(value);
const before={...building,classroomWindows:{...building.classroomWindows,
  groundBlindFacadeLines:building.classroomWindows.groundBlindFacadeLines.filter(line=>key(line)!==key(target))}};
function details(section,b=building){
  const solids=b.solidCores.filter(c=>c.partId===section.id),stairs=b.stairwells.filter(s=>s.partId===section.id),corridors=b.floorCorridors.filter(c=>c.partId===section.id),cuts=b.cutouts.filter(c=>c.partId===section.id);
  const core=buildingCoreFootprint(section,b.groundPassages,corridors,stairs,solids,cuts),ground=b.groundPassages.map(p=>{const s=passageShape(p);return[s.outer,...s.holes]}),recesses=ground.filter((_,i)=>b.groundPassages[i].recessClassrooms);
  return {solids,stairs,corridors,cuts,core,ground,recesses,windows:buildingSectionWindows(section,core,b.classroomWindows,section.height,info.floorHeight,ground,
    [...solids.filter(c=>!c.partition).map(c=>[c.outer,...c.holes]),...stairs.filter(s=>s.internal).map(s=>[s.opening.outer,...s.opening.holes])],recesses)};
}
const mesh=(geometry,body=false)=>{const m=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));if(body){m.rotation.x=-Math.PI/2;m.position.y=.12}m.updateMatrixWorld();return m};
const dispose=objects=>objects.forEach(m=>{m.geometry.dispose();m.material.dispose()});
function crossing(line,fraction,y){const[a,b]=line,dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),normal=new THREE.Vector3(-dz/len,0,dx/len);
  const p=new THREE.Vector3(a[0]+dx*fraction,y,a[1]+dz*fraction).addScaledVector(normal,-.6);return new THREE.Raycaster(p,normal,0,1.2)}
function body(section,b){const d=details(section,b);return mesh(buildingGeometry(section,section.height,info.floorHeight,b.groundPassages,d.corridors,d.stairs,b.classroomWindows,d.solids,d.cuts),true)}

test('the red end wall is the actual first-floor recessed classroom edge, with only its one pane removed',()=>{
  const d=details(wing),recessed=polygonClipping.difference(d.core,d.recesses[0],...d.recesses.slice(1));
  assert.ok(recessed.some(p=>p.some(r=>r.slice(1).some((to,i)=>key([r[i],to])===key(target)))),'The calibration uses the exact current wall after subtracting the ground road');
  assert.deepEqual(building.classroomWindows.groundBlindFacadeLines.at(-1),target);
  assert.deepEqual(corrections.buildings.find(b=>b.id===building.id).classroomWindows,building.classroomWindows,'The saved calibration survives a map refresh');
  for(const section of info.sections){
    const old=details(section,before).windows,current=details(section).windows;
    const removed=old.filter(p=>!current.some(q=>key(p)===key(q)));
    assert.equal(removed.length,section.id===wing.id?1:0,'Only the marked wing ground pane changes');
    assert.ok(removed.every(p=>p.bottom===.85&&p.top===3.1));
    assert.deepEqual(current,old.filter(p=>!removed.includes(p)),'Every other pane including upper floors is byte-for-byte unchanged');
  }
  assert.deepEqual(solidCoreWindowLayout(building.solidCores,info.height,info.floorHeight),solidCoreWindowLayout(before.solidCores,info.height,info.floorHeight),'Independent room windows remain unchanged');
});

test('the whole marked first-floor edge is opaque real masonry with no glass or frames, while upper windows stay open',()=>{
  const old=teachingWindowGeometry(before,info.sections,info.floorHeight),current=teachingWindowGeometry(building,info.sections,info.floorHeight);
  const oldBody=body(wing,before),newBody=body(wing,building),glass=mesh(current.glass),frames=mesh(current.frames),oldGlass=mesh(old.glass),oldFrames=mesh(old.frames);
  newBody.material.side=THREE.FrontSide;
  try{
    assert.equal(oldGlass.geometry.attributes.position.count-glass.geometry.attributes.position.count,6);
    assert.equal(oldFrames.geometry.attributes.position.count-frames.geometry.attributes.position.count,144);
    for(let fraction=.02;fraction<1;fraction+=.02)for(const rise of [.4,1,1.6,2.7,3.2]){
      const ray=crossing(target,fraction,.12+rise);
      assert.ok(ray.intersectObject(newBody).length,'Real outward-facing masonry closes the entire eight-metre end wall');
      assert.equal(ray.intersectObjects([glass,frames]).length,0,'No pane or frame remains anywhere along the marked first-floor wall');
    }
    assert.equal(crossing(target,.5,.12+1.6).intersectObject(oldBody).length,0,'The removed pane occupied an actual former aperture');
    for(let floor=2;floor<=wing.floors;floor++){
      const ray=crossing(original,.5,.12+(floor-1)*info.floorHeight+1.6);
      assert.equal(ray.intersectObject(glass).length,ray.intersectObject(oldGlass).length,'The ordinary upper end window or already open connection keeps its existing state');
      if(floor===6)assert.ok(ray.intersectObject(glass).length,'The confirmed sixth-floor end window stays visible');
    }
  }finally{dispose([oldBody,newBody,glass,frames,oldGlass,oldFrames])}
});

test('the ground road beside the new wall keeps its full clear route and the previously confirmed blind walls persist',()=>{
  const bodies=info.sections.map(s=>body(s,building));
  const p=building.groundPassages.find(p=>p.id==='ground-passage-1'),[a,b]=p.points,dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),axis=new THREE.Vector3(dx/len,0,dz/len),normal=new THREE.Vector3(-axis.z,0,axis.x);
  try{
    for(const side of [-1.5,0,1.5])for(const rise of [.6,1.6,2.6]){
      const start=new THREE.Vector3(a[0]+dx*.1,.12+rise,a[1]+dz*.1).addScaledVector(normal,side);
      assert.equal(new THREE.Raycaster(start,axis,0,len*.75).intersectObjects(bodies).length,0,'The requested wall does not seal or narrow the existing first-floor passage');
    }
    assert.deepEqual(building.classroomWindows.blindFacadeLines,[[[102.29300987733589,59.14085991112591],[100.0476098773359,45.40715991112591]],info.sections.find(s=>s.id==='main').outer.slice(18,20)],'The original west blind wall and newly enclosed east stair end remain opaque');
    assert.deepEqual(building.classroomWindows.groundBlindFacadeLines[0],[[101.39296197109496,42.147361263237464],[100.08174852515707,34.365594507997365]]);
    assert.equal(building.classroomWindows.straightWindowGap,.18);
    assert.equal(building.stairwells[2].roofAccess.height,3.6);assert.equal(building.stairwells[3].roofAccess,undefined);
  }finally{dispose(bodies)}
});

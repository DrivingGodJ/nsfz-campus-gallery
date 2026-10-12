import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry, buildingCoreFootprint, buildingSectionWindows, passageShape } from '../src/building-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const corrections=JSON.parse(fs.readFileSync(new URL('../data/campus-corrections.json',import.meta.url)));
const site=JSON.parse(fs.readFileSync(new URL('../public/data/site.json',import.meta.url)));
const building=campus.buildings.find(b=>b.id==='way/855459420');
const info=buildingLevels(building,site.buildingOverrides[building.id]);
const main=info.sections.find(s=>s.id==='main');
const room=building.solidCores.find(c=>c.partId==='main'&&c.startFloor===2&&c.outer[0][0]===89.47396089486412);
const fullWest=[[102.29300987733589,59.14085991112591],[100.0476098773359,45.40715991112591]];
const groundWest=[[101.39296197109496,42.147361263237464],[100.08174852515707,34.365594507997365]];
const mesh=(geometry,body=false)=>{
  const object=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));
  if(body){object.rotation.x=-Math.PI/2;object.position.y=.12}
  object.updateMatrixWorld();return object;
};
function crossing(from,to,fraction,y){
  const a=new THREE.Vector3(from[0],y,from[1]),b=new THREE.Vector3(to[0],y,to[1]);
  const direction=b.clone().sub(a).normalize(),normal=new THREE.Vector3(-direction.z,0,direction.x);
  return new THREE.Raycaster(a.lerp(b,fraction).addScaledVector(normal,-.45),normal,0,.9);
}

test('the entire west wall of the blue main atrium has no windows on any floor, including the first',()=>{
  const [south,north]=main.holes[0].slice(1,3),dx=north[0]-south[0],dz=north[1]-south[1],length=Math.hypot(dx,dz);
  for(let i=0;i<2;i++)for(let axis=0;axis<2;axis++){
    const p=[south,north][i],normal=[dz/length,-dx/length];
    assert.ok(Math.abs(fullWest[i][axis]-p[axis]-3*normal[axis])<1e-9,'The whole 13.916m line lies exactly three metres west of the blue atrium edge');
  }
  assert.equal(main.floors,5);
  assert.deepEqual(building.classroomWindows.blindFacadeLines,[fullWest]);
  assert.deepEqual(room.classroomWindows.blindFacadeLines,[fullWest],'Independent upper room glazing uses the same complete blind facade');
  const saved=corrections.buildings.find(b=>b.id===building.id);
  assert.deepEqual(saved.classroomWindows,building.classroomWindows,'Map refresh retains the correct west facade');
  assert.deepEqual(saved.solidCores.find(c=>c.outer[0][0]===room.outer[0][0]&&c.startFloor===2).classroomWindows,room.classroomWindows);
  const windows=teachingWindowGeometry(building,info.sections,info.floorHeight),glass=mesh(windows.glass),frames=mesh(windows.frames);
  const body=mesh(buildingGeometry(main,main.height,info.floorHeight,building.groundPassages,
    building.floorCorridors.filter(c=>c.partId===main.id),building.stairwells.filter(c=>c.partId===main.id),building.classroomWindows,
    building.solidCores.filter(c=>c.partId===main.id),building.cutouts.filter(c=>c.partId===main.id)),true);
  try{
    for(let floor=1;floor<=main.floors;floor++)for(let station=.25;station<length-.25;station+=.25)for(const rise of [1.25,1.6,2.7]){
      const ray=crossing(...fullWest,station/length,.12+(floor-1)*info.floorHeight+rise);
      assert.equal(ray.intersectObjects([glass,frames]).length,0,`Floor ${floor} west atrium boundary has no pane or frame at station ${station}`);
    }
    for(let floor=2;floor<=main.floors;floor++)for(const fraction of [.2,.5,.8])for(const rise of [.6,1.6,2.7]){
      assert.ok(crossing(room.outer[1],room.outer[2],fraction,.12+(floor-1)*info.floorHeight+rise).intersectObject(body).length,
        `Floor ${floor} retains continuous real masonry in the former west window at t=${fraction}, height ${rise}`);
    }
    for(const fraction of [.2,.5,.8])assert.equal(crossing(room.outer[1],room.outer[2],fraction,.12+1.6).intersectObjects([body,glass,frames]).length,0,
      'Removing windows does not seal the existing ground-floor road beneath the upper room');
  }finally{
    [body,glass,frames].forEach(o=>{o.geometry.dispose();o.material.dispose()});
  }
});

test('the single red-cross first-floor window becomes masonry while its four upper windows and every other bay remain',()=>{
  assert.deepEqual(building.classroomWindows.groundBlindFacadeLines,[groundWest],'Canonical data retains the one first-floor blind wall after map refresh');
  const config=building.classroomWindows;
  const patched=building;
  const baseConfig={...building.classroomWindows};delete baseConfig.groundBlindFacadeLines;
  const before={...building,classroomWindows:baseConfig};
  const solids=building.solidCores.filter(c=>c.partId==='main'),stairs=building.stairwells.filter(c=>c.partId==='main');
  const corridors=building.floorCorridors.filter(c=>c.partId==='main'),cutouts=building.cutouts.filter(c=>c.partId==='main');
  const core=buildingCoreFootprint(main,building.groundPassages,corridors,stairs,solids,cutouts);
  const openings=building.groundPassages.map(p=>{const shape=passageShape(p);return[shape.outer,...shape.holes]});
  const exclusions=[...solids.filter(c=>!c.partition).map(c=>[c.outer,...c.holes]),...stairs.filter(s=>s.internal).map(s=>[s.opening.outer,...s.opening.holes])];
  const recesses=openings.filter((_,i)=>building.groundPassages[i].recessClassrooms);
  const layout=c=>buildingSectionWindows(main,core,c,main.height,info.floorHeight,openings,exclusions,recesses);
  const oldPanes=layout(baseConfig),newPanes=layout(config),removed=oldPanes.filter(p=>!newPanes.some(n=>JSON.stringify(n)===JSON.stringify(p)));
  assert.equal(removed.length,1,'Exactly the one marked pane is removed from the shared wall/glass/frame layout');
  assert.ok(removed[0].bottom<info.floorHeight,'The removed pane belongs only to the first floor');
  const midpoint=p=>p.from.map((n,i)=>(n+p.to[i])/2);
  assert.ok(Math.hypot(...midpoint(removed[0]).map((n,i)=>n-[100.87540917627288,38.233216051570686][i]))<1e-6,'The calibration addresses the real marked ground bay, not the road beneath the upper blind wall');
  assert.deepEqual(newPanes,oldPanes.filter(p=>p!==removed[0]),'All other panes, including the four upper windows at this position, remain unchanged');
  const beforeWindows=teachingWindowGeometry(before,info.sections,info.floorHeight),afterWindows=teachingWindowGeometry(patched,info.sections,info.floorHeight);
  const beforeBody=mesh(buildingGeometry(main,main.height,info.floorHeight,building.groundPassages,corridors,stairs,baseConfig,solids,cutouts),true);
  const afterBody=mesh(buildingGeometry(main,main.height,info.floorHeight,building.groundPassages,corridors,stairs,config,solids,cutouts),true);
  afterBody.material.side=THREE.FrontSide;
  const beforeGlass=mesh(beforeWindows.glass),beforeFrames=mesh(beforeWindows.frames),afterGlass=mesh(afterWindows.glass),afterFrames=mesh(afterWindows.frames);
  try{
    assert.equal(beforeWindows.glass.getAttribute('position').count-afterWindows.glass.getAttribute('position').count,6,'Exactly one plane of glass is removed');
    assert.equal(beforeWindows.frames.getAttribute('position').count-afterWindows.frames.getAttribute('position').count,144,'Only that pane\'s three horizontal and five vertical frame members are removed');
    for(const fraction of [.1,.3,.5,.7,.9])for(const rise of [1,1.6,2.9]){
      const ray=crossing(...groundWest,fraction,.12+rise);
      assert.equal(ray.intersectObjects([afterGlass,afterFrames]).length,0,'No glass or frame survives in the marked ground wall');
      if(fraction>.2&&fraction<.8){
        assert.equal(ray.intersectObject(beforeBody).length,0,'The original target bay was a real wall opening');
        assert.ok(ray.intersectObject(afterBody).length,'Real FrontSide masonry fills the original opening');
      }
    }
    for(let floor=2;floor<=main.floors;floor++){
      const ray=crossing(...groundWest,.5,.12+(floor-1)*info.floorHeight+1.6);
      assert.ok(ray.intersectObject(afterGlass).length,'The same window on each upper floor remains visible');
      assert.equal(ray.intersectObject(afterBody).length,0,'The upper window remains a real opening');
    }
  }finally{
    [beforeBody,afterBody,beforeGlass,beforeFrames,afterGlass,afterFrames].forEach(o=>{o.geometry.dispose();o.material.dispose()});
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { theatreBodyWindows, theatreEntranceGeometry, theatrePartDoorLayouts } from '../src/theatre-exterior-geometry.ts';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const theatre=campus.buildings.find(b=>b.id==='local/theatre');
const original={...theatre,parts:theatre.parts.map(part=>{const copy={...part};delete copy.doors;return copy;})};
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const mesh=(g,body=false)=>{const m=new THREE.Mesh(g,material);if(body){m.rotation.x=-Math.PI/2;m.position.y=.12;}m.updateMatrixWorld();return m;};
function bodies(building,fh,cutoff) {
  const info=buildingLevels(building,{floorHeight:fh}),geometries=info.sections.map(part=>{
    const height=Math.min(part.height,cutoff??Infinity);
    return buildingGeometry(part,height,fh,building.groundPassages,building.floorCorridors.filter(c=>c.partId===part.id),[],part.classroomWindows??building.classroomWindows,building.solidCores.filter(c=>c.partId===part.id),[],cutoff!==undefined&&cutoff<=part.height+.001,theatreBodyWindows(building,part,height,fh));
  });
  const group=new THREE.Group();geometries.forEach(g=>group.add(mesh(g,true)));group.updateMatrixWorld();
  return {group,geometries,dispose(){geometries.forEach(g=>g.dispose());}};
}

test('the marked short-return fifth-floor doorway is a real local opening with a door, jambs and lintel',()=>{
  for(const fh of [3.6,4.2])for(const selected of [undefined,5]) {
    const [door]=theatrePartDoorLayouts(theatre,fh);assert.ok(door);assert.equal(door.floor,5);assert.equal(door.partId,'main');assert.equal(door.edge,4);
    const body=bodies(theatre,fh,selected?selected*fh:undefined),entry=theatreEntranceGeometry(theatre,fh,selected?selected*fh:undefined),glass=mesh(entry.glass),frames=mesh(entry.frames);
    const ray=(station,y)=>new THREE.Raycaster(new THREE.Vector3(door.center[0]+door.axis[0]*station-door.outward[0]*.6,y,door.center[1]+door.axis[1]*station-door.outward[1]*.6),new THREE.Vector3(door.outward[0],0,door.outward[1]),0,1.2);
    try {
      assert.equal(ray(0,.12+door.bottom+1).intersectObject(body.group).length,0,'The door is cut through the actual main wall');
      assert.ok(ray(0,.12+door.bottom+1).intersectObject(glass).length,'A single glass door leaf fills that aperture');
      for(const side of [-1,1]) {
        assert.ok(ray(side*(door.width/2+.15),.12+door.bottom+1).intersectObject(body.group).length,'Masonry remains immediately beside both jambs');
        assert.ok(ray(side*door.width/2,.12+door.bottom+1.5).intersectObject(frames).length,'The new door has both real frame uprights');
      }
      assert.ok(ray(0,.12+door.top+.15).intersectObject(body.group).length,'The wall lintel above the door remains closed');
      for(let floor=0;floor<6;floor++)if(floor!==4&&(selected===undefined||floor<selected))assert.ok(ray(0,.12+floor*fh+1).intersectObject(body.group).length,'All other storeys retain their wall at the same position');
      for(const side of [-1,1]) {
        const point=[door.center[0]+door.outward[0]*side,door.center[1]+door.outward[1]*side];
        const hit=new THREE.Raycaster(new THREE.Vector3(point[0],.12+door.bottom+.2,point[1]),new THREE.Vector3(0,-1,0),0,.4).intersectObject(body.group)[0];
        assert.ok(hit&&Math.abs(hit.point.y-(.12+door.bottom))<1e-4,'The indoor floor and the existing fifth-floor terrace meet beneath the new door');
      }
    } finally {body.dispose();Object.values(entry).forEach(g=>g.dispose());}
  }
});

test('the crossed vestibule walls disappear only on five, its floor stays continuous and the old long-wall door is closed',()=>{
  const vestibule=theatre.parts.find(p=>p.id==='theatre-entry-vestibule'),main=theatre.parts.find(p=>p.id==='main');
  assert.deepEqual(vestibule.openEdges,[0,1,2,3]);assert.equal(vestibule.openEdgesStartFloor,5);assert.equal(vestibule.openEdgesEndFloor,5);
  const previous={...theatre,parts:theatre.parts.map(part=>{if(part.id!==vestibule.id)return part;const copy={...part};delete copy.openEdges;delete copy.openEdgesStartFloor;delete copy.openEdgesEndFloor;return copy;})};
  for(const fh of [3.6,4.2]) {
    const body=bodies(theatre,fh),before=bodies(previous,fh),entry=theatreEntranceGeometry(theatre,fh),glass=mesh(entry.glass);
    try {
      for(let edge=0;edge<4;edge++) {
        const a=vestibule.outer[edge],b=vestibule.outer[edge+1],length=Math.hypot(b[0]-a[0],b[1]-a[1]),normal=[(b[1]-a[1])/length,-(b[0]-a[0])/length];
        const p=[(a[0]+b[0])/2,(a[1]+b[1])/2],start=[p[0]-normal[0]*.4,p[1]-normal[1]*.4];
        const ray=floor=>new THREE.Raycaster(new THREE.Vector3(start[0],.12+floor*fh+1.5,start[1]),new THREE.Vector3(normal[0],0,normal[1]),0,.8);
        assert.equal(ray(4).intersectObject(body.group).length,0,'All four walls of the crossed small block are absent on floor five');
        assert.ok(ray(4).intersectObject(before.group).length,'The removed walls are measured at the actual former block');
        for(const floor of [0,1,2,3,5])assert.deepEqual(ray(floor).intersectObject(body.group).map(hit=>Math.round(hit.distance*1e5)),ray(floor).intersectObject(before.group).map(hit=>Math.round(hit.distance*1e5)),'Every other floor, including the existing 2F vestibule openings, stays exact');
      }
      const center=vestibule.outer.slice(0,4).reduce((sum,p)=>[sum[0]+p[0]/4,sum[1]+p[1]/4],[0,0]);
      const floor=new THREE.Raycaster(new THREE.Vector3(center[0],.12+4*fh+.5,center[1]),new THREE.Vector3(0,-1,0),0,.5).intersectObject(body.group)[0];
      assert.ok(floor&&Math.abs(floor.point.y-(.12+4*fh+.25))<1e-4,'The roof walk retains its supporting slab beneath the removed block');
      const a=main.outer[5],b=main.outer[6],t=(-31.5-a[1])/(b[1]-a[1]),old=[a[0]+(b[0]-a[0])*t,-31.5],length=Math.hypot(b[0]-a[0],b[1]-a[1]),normal=[(b[1]-a[1])/length,-(b[0]-a[0])/length];
      const ray=new THREE.Raycaster(new THREE.Vector3(old[0]-normal[0]*.5,.12+4*fh+1.5,old[1]-normal[1]*.5),new THREE.Vector3(normal[0],0,normal[1]),0,1);
      assert.ok(ray.intersectObject(body.group).length,'The former incorrect long-wall opening is restored to solid wall');
      assert.equal(ray.intersectObject(glass).length,0,'No old door glass remains on the long side');
    } finally {body.dispose();before.dispose();Object.values(entry).forEach(g=>g.dispose());}
  }
});

test('adding the local fifth-floor door preserves the confirmed lower entrance, stairs, rails and original solid cores',()=>{
  const lower=bodies(theatre,3.6,4*3.6),before=bodies(original,3.6,4*3.6);
  const entry=theatreEntranceGeometry(theatre,3.6),prior=theatreEntranceGeometry(original,3.6);
  try {
    lower.geometries.forEach((geometry,i)=>assert.deepEqual(geometry.attributes.position.array,before.geometries[i].attributes.position.array,'Every lower-floor body vertex is unchanged'));
    for(const kind of ['concrete','rails'])assert.deepEqual(entry[kind].attributes.position.array,prior[kind].attributes.position.array,'The existing 2F stair approach and guard geometry is unchanged');
    assert.deepEqual(theatre.solidCores,original.solidCores,'The confirmed fifth-floor paintings partition is untouched');
    const cut=theatreEntranceGeometry(theatre,3.6,4*3.6),oldCut=theatreEntranceGeometry(original,3.6,4*3.6);
    try {for(const kind of ['glass','frames'])assert.deepEqual(cut[kind].attributes.position.array,oldCut[kind].attributes.position.array,'The original second-floor doors and their frames remain exact');}
    finally {Object.values(cut).forEach(g=>g.dispose());Object.values(oldCut).forEach(g=>g.dispose());}
  } finally {lower.dispose();before.dispose();Object.values(entry).forEach(g=>g.dispose());Object.values(prior).forEach(g=>g.dispose());}
});

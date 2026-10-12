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

test('the marked east-wall fifth-floor doorway is a real local opening with a door, jambs and lintel',()=>{
  for(const fh of [3.6,4.2])for(const selected of [undefined,5]) {
    const [door]=theatrePartDoorLayouts(theatre,fh);assert.ok(door);assert.equal(door.floor,5);assert.equal(door.partId,'main');assert.equal(door.edge,5);
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

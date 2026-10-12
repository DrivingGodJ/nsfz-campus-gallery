import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildingGeometry, buildingCoreFootprint, buildingSectionWindows } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { photoInteriorGeometry, photoInteriorPlacements } from '../src/photo-interior-geometry.ts';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const corrections=JSON.parse(fs.readFileSync(new URL('../data/campus-corrections.json',import.meta.url)));
const theatre=campus.buildings.find(b=>b.id==='local/theatre');
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const origin=[30.809226250687292,-45.18263028622997],along=[.9876333466290035,-.15678128914636014],across=[-along[1],along[0]];
const at=(u,v)=>[origin[0]+along[0]*u+across[0]*v,origin[1]+along[1]*u+across[1]*v];
const local=p=>[(p[0]-origin[0])*along[0]+(p[1]-origin[1])*along[1],(p[0]-origin[0])*across[0]+(p[1]-origin[1])*across[1]];
const cast=(target,p,y,d,far)=>new THREE.Raycaster(new THREE.Vector3(p[0],y,p[1]),new THREE.Vector3(d[0],0,d[1]),0,far).intersectObject(target);
const mesh=(g,extruded=false)=>{const m=new THREE.Mesh(g,material);if(extruded){m.rotation.x=-Math.PI/2;m.position.y=.12;}m.updateMatrixWorld();return m;};
function model(floorHeight=3.6,cutoff) {
  const info=buildingLevels(theatre,{floorHeight}),geometries=info.sections.map(section=>buildingGeometry(section,Math.min(section.height,cutoff??Infinity),floorHeight,
    theatre.groundPassages,theatre.floorCorridors.filter(c=>c.partId===section.id),[],section.classroomWindows??theatre.classroomWindows,[],[],cutoff!==undefined&&cutoff<=section.height+1e-6));
  const group=new THREE.Group();geometries.forEach(g=>group.add(mesh(g,true)));group.updateMatrixWorld();
  const glazing=teachingWindowGeometry(theatre,info.sections,floorHeight,cutoff);
  const furniture=photoInteriorGeometry(theatre,info.height,floorHeight,cutoff);
  return {info,group,geometries,glass:mesh(glazing.glass),frames:mesh(glazing.frames),furniture,dispose(){geometries.forEach(g=>g.dispose());Object.values(glazing).forEach(g=>g.dispose());furniture.forEach(b=>b.geometry.dispose());}};
}

test('the west-facing fifth-floor gallery has a solid art wall on the left and true glazing on the right',()=>{
  assert.deepEqual(corrections.buildings.find(b=>b.id===theatre.id),theatre,'Map refresh retains the same correction');
  const placements=photoInteriorPlacements(theatre),art=placements.filter(p=>p.kind==='exhibit');
  assert.equal(art.length,5);
  assert.ok(art.every(p=>local(p.center)[1]>-.2),'Art moves off the former right-hand wall onto the opaque left wall');
  assert.ok(art.every(p=>p.axis[0]*along[0]+p.axis[1]*along[1]<-.99),'The picture fronts face back into the gallery');
  assert.equal(placements.some(p=>p.kind==='bench'),false);
  for(const floorHeight of [2.4,3.6,4.2]) for(const selected of [undefined,5]) {
    const built=model(floorHeight,selected===undefined?undefined:selected*floorHeight),y=.12+4*floorHeight+1.5;
    try {
      for(const u of [7,10.7,14.4,18.1,21.8]) {
        const left=cast(built.group,at(u,-1),y,across,1.3)[0];
        assert.ok(left&&Math.abs(left.distance-1)<1e-4,'The actual solid wall is on picture-left');
        assert.equal(cast(built.glass,at(u,-1),y,across,1.3).length,0,'No pane is pasted over that art wall');
      }
      const main=built.info.sections.find(s=>s.id==='main'),core=buildingCoreFootprint(main,theatre.groundPassages,theatre.floorCorridors.filter(c=>c.partId==='main'),[]);
      const panes=buildingSectionWindows(main,core,main.classroomWindows,Math.min(main.height,selected===undefined?Infinity:selected*floorHeight),floorHeight);
      const right=panes.filter(p=>local([(p.from[0]+p.to[0])/2,(p.from[1]+p.to[1])/2])[0]<24);
      assert.ok(right.length>8,'Repeated actual window bays continue along the narrow corridor');
      for(const pane of right.filter((_,i)=>i%3===0)) {
        const [u]=local([(pane.from[0]+pane.to[0])/2,(pane.from[1]+pane.to[1])/2]),point=at(u,-1),direction=across.map(n=>-n);
        assert.equal(cast(built.group,point,y,direction,1.5).length,0,'Each right-hand pane penetrates the actual wall rather than covering solid mass');
        assert.ok(cast(built.glass,point,y,direction,1.5).length,'The opened right wall receives glass');
      }
      const camera=[60.88965943416322,-50.532612910984824],heading=262.9816727347636*Math.PI/180;
      assert.equal(cast(built.group,camera,y,[Math.sin(heading),-Math.cos(heading)],25).length,0,'The retained DSC07199 camera has a clear route into the west gallery without a new end wall');
      assert.ok(new THREE.Raycaster(new THREE.Vector3(camera[0],.12+4*floorHeight+.6,camera[1]),new THREE.Vector3(0,-1,0),0,.7).intersectObject(built.group).length,'The camera and corridor keep their fifth-floor slab');
      assert.equal(built.furniture.some(b=>b.kind==='orange'),false,'The orange sofa mesh is entirely absent');
    } finally { built.dispose(); }
  }
});

test('the duplicated outside band is removed and the two long inner lines retain one wall face',()=>{
  const built=model(),connector=built.info.sections.find(s=>s.id==='laboratory-connection'),main=built.info.sections.find(s=>s.id==='main');
  try {
    assert.equal(main.floors,6);assert.equal(connector.floors,4);assert.equal(built.info.sections.find(s=>s.id==='curved-terrace').floors,4);
    const removed=[...connector.outer.slice(1).map((b,i)=>[connector.outer[i],b]),[main.outer[2],main.outer[3]]];
    for(const [a,b] of removed) {
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),normal=[-dz/length,dx/length],p=[(a[0]+b[0])/2,(a[1]+b[1])/2],start=p.map((n,i)=>n-normal[i]*.55);
      for(let floor=0;floor<6;floor++) for(const rise of [.5,1.5,2.6,3.3]) {
        const y=.12+floor*3.6+rise;
        assert.equal(cast(built.group,start,y,normal,1.1).length,0,'The crossed-out outside layer is gone between slabs on every storey');
        assert.equal(cast(built.glass,start,y,normal,1.1).length,0,'No hanging glass survives on the deleted outer layer');
        assert.equal(cast(built.frames,start,y,normal,1.1).length,0,'No hanging frame survives on the deleted outer layer');
      }
    }
    for(let floor=0;floor<6;floor++) for(const [u,v] of [[12,-2],[32,-5.4]]) {
      // Above the glazing, the remaining lintel supplies an independent measure
      // of the one surviving wall leaf on each long inner line.
      const hits=cast(built.group,at(u,v+.5),.12+floor*3.6+3.3,across.map(n=>-n),15);
      assert.equal(hits.length,2,'Only the two surfaces of one inner wall leaf remain, with no farther outside wall');
      assert.ok(Math.abs(hits[1].distance-hits[0].distance-.28)<1e-4,'The remaining inner wall is one 0.28m leaf');
    }
    for(let floor=0;floor<4;floor++) {
      const p=at(32,-10),hit=new THREE.Raycaster(new THREE.Vector3(p[0],.12+floor*3.6+.6,p[1]),new THREE.Vector3(0,-1,0),0,.7).intersectObject(built.group)[0];
      assert.ok(hit,'Removing the exterior walls retains the existing connector floor slabs');
    }
  } finally {built.dispose();}
});

test('the short turn between the two long glass runs is opaque masonry, and no fire case remains',()=>{
  for(const selected of [undefined,5]) {
    const built=model(3.6,selected===undefined?undefined:selected*3.6),direction=along.map(n=>-n),y=.12+4*3.6+1.5;
    try {
      for(const v of [-2.35,-2.8,-3.25,-3.7,-4.15,-4.6,-5]) {
        const point=at(26.5,v);
        assert.ok(cast(built.group,point,y,direction,2).length,'The full short transverse return retains actual solid masonry');
        assert.equal(cast(built.glass,point,y,direction,2).length,0,'The opaque short return has no glass panel');
        assert.equal(cast(built.frames,point,y,direction,2).length,0,'The opaque short return has no window frame');
      }
      assert.equal(photoInteriorPlacements(theatre).some(p=>p.kind==='fire-case'),false,'The fire case placement is removed entirely');
      assert.equal(built.furniture.some(batch=>batch.kind==='red'),false,'No red fire-case mesh remains');
    } finally {built.dispose();}
  }
});

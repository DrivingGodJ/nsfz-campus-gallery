import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildingGeometry, buildingCoreFootprint, buildingSectionWindows } from '../src/building-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { theatreBodyWindows, theatreGlazingGeometry } from '../src/theatre-exterior-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { photoInteriorGeometry, photoInteriorPlacements } from '../src/photo-interior-geometry.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const corrections=JSON.parse(fs.readFileSync(new URL('../data/campus-corrections.json',import.meta.url)));
const theatre=campus.buildings.find(b=>b.id==='local/theatre');
// Verified original building from commit448e5e7; no Git history is required in CI.
const baseline=JSON.parse(fs.readFileSync(new URL('./fixtures/theatre-448e5e7.json',import.meta.url)));
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),frontMaterial=new THREE.MeshBasicMaterial({side:THREE.FrontSide});
const origin=[30.809226250687292,-45.18263028622997],along=[.9876333466290035,-.15678128914636014],across=[-along[1],along[0]];
const at=(u,v)=>[origin[0]+along[0]*u+across[0]*v,origin[1]+along[1]*u+across[1]*v];
const local=p=>[(p[0]-origin[0])*along[0]+(p[1]-origin[1])*along[1],(p[0]-origin[0])*across[0]+(p[1]-origin[1])*across[1]];
const cast=(target,p,y,d,far)=>new THREE.Raycaster(new THREE.Vector3(p[0],y,p[1]),new THREE.Vector3(d[0],0,d[1]),0,far).intersectObject(target);
const mesh=(g,extruded=false,side=THREE.DoubleSide)=>{const m=new THREE.Mesh(g,side===THREE.FrontSide?frontMaterial:material);if(extruded){m.rotation.x=-Math.PI/2;m.position.y=.12;}m.updateMatrixWorld();return m;};
function model(floorHeight=3.6,cutoff,source=theatre,side=THREE.DoubleSide) {
  const info=buildingLevels(source,{floorHeight}),geometries=info.sections.map(section=>buildingGeometry(section,Math.min(section.height,cutoff??Infinity),floorHeight,
    source.groundPassages,source.floorCorridors.filter(c=>c.partId===section.id),[],section.classroomWindows??source.classroomWindows,source.solidCores?.filter(c=>c.partId===section.id),source.cutouts?.filter(c=>c.partId===section.id),cutoff!==undefined&&cutoff<=section.height+1e-6,source===baseline?undefined:theatreBodyWindows(source,section,Math.min(section.height,cutoff??Infinity),floorHeight)));
  const group=new THREE.Group();geometries.forEach(g=>group.add(mesh(g,true,side)));group.updateMatrixWorld();
  const glazing=source===baseline?teachingWindowGeometry(source,info.sections,floorHeight,cutoff):theatreGlazingGeometry(source,info.sections,floorHeight,cutoff);
  const furniture=photoInteriorGeometry(source,info.height,floorHeight,cutoff);
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
      for(const east of [false,true]) {
        const run=panes.filter(p=>(local([(p.from[0]+p.to[0])/2,(p.from[1]+p.to[1])/2])[0]>26)===east);
        assert.ok(run.length>5,'Both the narrow west and long east inner glass runs remain');
        for(const pane of run.filter((_,i)=>i%3===0)) {
          const [u]=local([(pane.from[0]+pane.to[0])/2,(pane.from[1]+pane.to[1])/2]),point=at(u,east?-4.6:-1),direction=across.map(n=>-n),far=east?1.25:1.5;
          assert.equal(cast(built.group,point,y,direction,far).length,0,'Every retained inner pane occupies a real wall aperture');
          assert.ok(cast(built.glass,point,y,direction,far).length,'Both inner runs retain their actual glass');
        }
      }
      const camera=[60.88965943416322,-50.532612910984824],heading=262.9816727347636*Math.PI/180;
      assert.equal(cast(built.group,camera,y,[Math.sin(heading),-Math.cos(heading)],25).length,0,'The retained DSC07199 camera has a clear route into the west gallery without a new end wall');
      assert.ok(new THREE.Raycaster(new THREE.Vector3(camera[0],.12+4*floorHeight+.6,camera[1]),new THREE.Vector3(0,-1,0),0,.7).intersectObject(built.group).length,'The camera and corridor keep their fifth-floor slab');
      assert.equal(built.furniture.some(b=>b.kind==='orange'),false,'The orange sofa mesh is entirely absent');
    } finally { built.dispose(); }
  }
});

test('normal south facades outside the widened curved passage match the original building and the mistaken east outside wall stays absent',()=>{
  const savedMain=baseline.parts.find(p=>p.id==='main'),main=theatre.parts.find(p=>p.id==='main');
  assert.equal(main.openEdgesStartFloor,5);assert.equal(main.openEdgesEndFloor,5);
  assert.deepEqual(theatre.parts.find(p=>p.id==='laboratory-connection'),baseline.parts.find(p=>p.id==='laboratory-connection'),'The complete original four-storey connector is restored');
  assert.deepEqual(main.outer.slice(0,5),savedMain.outer.slice(0,5),'The complete original south outline remains');assert.deepEqual(main.outer.slice(-3),savedMain.outer.slice(-3),'The west join outline remains');assert.deepEqual(main.holes,savedMain.holes);assert.equal(main.floors,savedMain.floors);
  for(const floorHeight of [2.4,3.6,4.2]) {
    const lower=model(floorHeight,4*floorHeight),originalLower=model(floorHeight,4*floorHeight,baseline),built=model(floorHeight),original=model(floorHeight,undefined,baseline);
    try {
      assert.deepEqual(lower.geometries[1].attributes.position.array,originalLower.geometries[1].attributes.position.array,'Every unchanged laboratory-connector vertex matches the448e5e7 baseline');
      const lines=[...savedMain.outer.slice(1,5).map((b,i)=>[savedMain.outer[i],b]),...savedMain.outer.slice(-2).map((b,i)=>[savedMain.outer[savedMain.outer.length-3+i],b])];
      for(const [a,b] of lines.slice(0,4)) {
        const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),normal=[-dz/length,dx/length];
        for(const t of [.13,.37,.61,.83])for(let floor=0;floor<4;floor++) {
          const p=[a[0]+dx*t-normal[0]*.6,a[1]+dz*t-normal[1]*.6],y=.12+(floor+.5)*floorHeight;
          const distances=target=>[...new Set(cast(target,p,y,normal,1.2).map(hit=>Math.round(hit.distance*1e4)))];
          assert.deepEqual(distances(lower.group),distances(originalLower.group),'The unchanged south outside walls remain closed on every lower storey');
        }
      }
      for(const [a,b] of lines) {
        const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),normal=[-dz/length,dx/length];
        for(const t of [.13,.37,.61,.83])for(const rise of [.2,.45,.72,.92]) {
          const p=[a[0]+dx*t,a[1]+dz*t],start=p.map((n,i)=>n-normal[i]*.6),y=.12+(5+rise)*floorHeight;
          const distances=target=>[...new Set(cast(target,start,y,normal,1.2).map(hit=>Math.round(hit.distance*1e4)))];
          assert.deepEqual(distances(built.group),distances(original.group),'The sixth-storey normal facade matches every original boundary sample');
        }
      }
      const a=main.outer[2],b=main.outer[3],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),normal=[-dz/length,dx/length];
      for(const t of [.7,.85,.95])for(const rise of [.2,.45,.72,.92]) {
        const p=[a[0]+dx*t,a[1]+dz*t],start=p.map((n,i)=>n-normal[i]*.55),y=.12+(4+rise)*floorHeight;
        assert.equal(cast(built.group,start,y,normal,1.1).length,0,'The mistakenly identified east outside wall remains absent');
        assert.equal(cast(built.glass,start,y,normal,1.1).length,0,'No hanging glass survives on the deleted fifth-floor outside wall');
        assert.equal(cast(built.frames,start,y,normal,1.1).length,0,'No hanging frame survives on the deleted fifth-floor outside wall');
      }
      for(const [u,v] of [[32,-5.4]]) {
        const hits=cast(built.group,at(u,v+.5),.12+4*floorHeight+floorHeight*.96,across.map(n=>-n),15);
        assert.equal(hits.length,2,'The east inner glass run keeps its original wall leaf without the mistaken outer L wall');
        assert.ok(Math.abs(hits[1].distance-hits[0].distance-.28)<1e-4);
      }
    } finally {lower.dispose();originalLower.dispose();built.dispose();original.dispose();}
  }
});

test('the short turn between the two glass runs stays solid, and no fire case remains',()=>{
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


test('the canonical marked wall replaces stale L walls after map refresh',()=>{
  const saved=corrections.buildings.find(b=>b.id===theatre.id),main=theatre.parts.find(p=>p.id==='main');
  assert.equal(theatre.solidCores.length,1,'Exactly the user-marked straight wall remains');
  assert.deepEqual(saved.solidCores,theatre.solidCores,'Refresh corrections retain the exact validated wall');
  const [wall]=theatre.solidCores;
  assert.equal(wall.partId,'main');assert.equal(wall.partition,true);assert.equal(wall.startFloor,5);assert.equal(wall.endFloor,5);
  assert.equal(wall.outer.length,5);assert.deepEqual(wall.holes,[]);
  assert.deepEqual(wall.outer[0],main.outer[2],'The left end is the original left facade corner marked by the user');
  assert.deepEqual(wall.outer[1],theatre.floorCorridors.find(c=>c.partId==='main').footprint.outer[4],'The right end is the top of the short solid return');
  assert.deepEqual(wall.outer.at(-1),wall.outer[0]);
  const oldL={partId:'main',partition:true,startFloor:5,endFloor:5,outer:[[54.576096813845965,-55.305888116512506],[54.59558802124802,-55.30964138767472],[67.39423278560383,-57.77417748945069],[67.43444191661159,-57.49677627004743],[54.91460722100947,-55.08592846829334],[55.00892057060891,-54.49180776930024],[54.73238323355279,-54.44790900833926],[54.63951041112425,-55.03295520183205],[54.62904158229457,-55.03093930037771],[54.576096813845965,-55.305888116512506]],holes:[]};
  const stale={...campus,buildings:campus.buildings.map(b=>b.id===theatre.id?{...b,solidCores:[oldL]}:b)};
  const refreshed=applyCampusCorrections(stale,corrections).buildings.find(b=>b.id===theatre.id);
  assert.deepEqual(refreshed.solidCores,theatre.solidCores,'Refreshing replaces the complete obsolete L-wall array');
  assert.deepEqual(refreshed,theatre,'The refreshed theatre exactly equals the validated marked-wall model');
});

test('the entire paintings wall remains continuous and front-facing to the fifth-floor corridor',()=>{
  for(const floorHeight of [2.4,3.6,4.2])for(const selected of [undefined,5]) {
    const built=model(floorHeight,selected===undefined?undefined:selected*floorHeight,theatre,THREE.FrontSide),direction=new THREE.Vector3(across[0],0,across[1]);
    try {
      for(let u=1;u<=38;u++)for(const rise of [floorHeight*.15,floorHeight*.4,floorHeight*.8,floorHeight-.3]) {
        const hit=cast(built.group,at(u,-.5),.12+4*floorHeight+rise,across,1.05)[0];
        assert.ok(hit,'The real FrontSide body shows a solid wall across the entire paintings side, including its east long bay');
        assert.ok(Math.abs(hit.distance-.5)<1e-4,'The visible paintings wall remains on its original v0 line');
        const normal=hit.face.normal.clone().applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
        assert.ok(normal.dot(direction)<-.999,'The corridor-facing triangle normal prevents backface culling from hiding this wall');
      }
      assert.equal(cast(built.glass,at(32,-.5),.12+4*floorHeight+1.5,across,1.05).length,0,'The paintings-side east long wall gains no guessed glass');
    } finally {built.dispose();}
  }
});


test('the marked straight wall closes its actual red line on floor five and meets the existing walls at both ends',()=>{
  const [wall]=theatre.solidCores,a=wall.outer[0],b=wall.outer[1],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),normal=[-dz/length,dx/length];
  assert.ok(Math.abs(length-25.79)<.01);
  const withoutMarked={...theatre,solidCores:[]};
  for(const floorHeight of [2.4,3.6,4.2])for(const selected of [undefined,5]) {
    const cutoff=selected===undefined?undefined:selected*floorHeight,built=model(floorHeight,cutoff),original=model(floorHeight,cutoff,withoutMarked);
    try {
      for(const t of [.03,.2,.5,.8,.97])for(const rise of [.2,.5,.8]) {
        const p=[a[0]+dx*t,a[1]+dz*t],start=p.map((n,i)=>n-normal[i]*.35),y=.12+(4+rise)*floorHeight,hits=cast(built.group,start,y,normal,.8);
        assert.equal(hits.length,2,'The actual marked line is continuously closed by one straight wall leaf');
        assert.ok(Math.abs(hits[0].distance-.35)<1e-4&&Math.abs(hits[1].distance-hits[0].distance-.28)<1e-4,'The wall follows the marked line with0.28m thickness toward the gallery');
        assert.equal(cast(original.group,start,y,normal,.8).length,0,'The requested straight wall is measured at its own line, not the old outer edge');
        assert.equal(cast(built.glass,start,y,normal,.8).length,0,'The marked wall stays opaque');
      }
      const main=theatre.parts.find(p=>p.id==='main'),left=main.outer[1],leftLength=Math.hypot(left[0]-a[0],left[1]-a[1]),towardLeft=[(left[0]-a[0])/leftLength,(left[1]-a[1])/leftLength],leftNormal=[towardLeft[1],-towardLeft[0]];
      for(const offset of [.02,.08,.2]) {
        const p=[a[0]+towardLeft[0]*offset,a[1]+towardLeft[1]*offset],start=p.map((n,i)=>n-leftNormal[i]*.35),y=.12+4*floorHeight+floorHeight*.5;
        assert.ok(cast(built.group,start,y,leftNormal,.8).length,'The original left outer wall remains continuous immediately beside the new wall endpoint');
        const returnPoint=b.map((n,i)=>n+across[i]*offset+along[i]*.35);
        assert.ok(cast(built.group,returnPoint,y,along.map(n=>-n),.8).length,'The existing short return remains continuous immediately beside the new right endpoint');
      }
    } finally {built.dispose();original.dispose();}
  }
});

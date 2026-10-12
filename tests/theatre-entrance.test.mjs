import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { theatreBodyWindows, theatreEntranceGeometry, theatreEntranceLayout, theatreFacadeWindows, theatreGlazingGeometry } from '../src/theatre-exterior-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';
import { passageFootprint } from '../src/underground-geometry.ts';
import { theatreInteriorGeometry } from '../src/venue-geometry.ts';

const campus=JSON.parse(await fs.readFile(new URL('../public/data/campus.json',import.meta.url))), theatre=campus.buildings.find(b=>b.id==='local/theatre');
const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
function mesh(g,extruded=false){const m=new THREE.Mesh(g,material);if(extruded){m.rotation.x=-Math.PI/2;m.position.y=.12;}m.updateMatrixWorld();return m;}
const cast=(object,p,y,d,far)=>new THREE.Raycaster(new THREE.Vector3(p[0],y,p[1]),new THREE.Vector3(...d),0,far).intersectObject(object)[0];
function model(fh){const info=buildingLevels(theatre,{floorHeight:fh});const geometries=info.sections.map(s=>buildingGeometry(s,s.height,fh,theatre.groundPassages,theatre.floorCorridors.filter(c=>c.partId===s.id),[],s.classroomWindows??theatre.classroomWindows,theatre.solidCores?.filter(c=>c.partId===s.id),[],false,theatreBodyWindows(theatre,s,s.height,fh)));const group=new THREE.Group();geometries.forEach(g=>group.add(mesh(g,true)));group.updateMatrixWorld();return{group,dispose(){geometries.forEach(g=>g.dispose());}};}

test('the latest recessed glass door leads to a corridor before the auditorium and an outside east-side stair route',()=>{
 for(const fh of [2.4,3.6,4.2]){
  const layout=theatreEntranceLayout(theatre,fh),body=model(fh),entry=theatreEntranceGeometry(theatre,fh),stair=mesh(entry.concrete),glass=mesh(entry.glass),rails=mesh(entry.rails);
  try{
   assert.ok(Math.abs(layout.center[0]-68.46)<1e-5,'The latest glass door occupies the recessed blue return');
   const t=theatre.parts.find(p=>p.id==='curved-terrace'),inner=t.outer.slice(t.roofTerrace.railEdges[0].length+4,-1).reverse(),left=inner[0],next=inner[1],len=Math.hypot(next[0]-left[0],next[1]-left[1]);
   const buildingAxis=[(next[0]-left[0])/len,(next[1]-left[1])/len];assert.ok(Math.abs(layout.axis[0]*buildingAxis[1]-layout.axis[1]*buildingAxis[0])<1e-6,'The grand door is straight and aligned with both long walls');
   const corridor=theatre.parts.find(p=>p.id==='curved-terrace'),main=theatre.parts.find(p=>p.id==='main'),firstInside=layout.center.map((n,i)=>n-layout.outward[i]*.7);
   const insideProbe=passageFootprint([firstInside,[firstInside[0]-.01,firstInside[1]]],.1);
   assert.ok(clip.intersection([insideProbe.outer],[corridor.outer]).length,'Entering the blue door first places the visitor in the peripheral corridor');
   assert.deepEqual(clip.intersection([insideProbe.outer],[main.outer]),[],'The exterior entrance does not open straight into the seat room');
   const approach=layout.innerDoor.center.map((n,i)=>n-layout.innerDoor.inward[i]*1.2),roomPoint=layout.innerDoor.center.map((n,i)=>n+layout.innerDoor.inward[i]*.9);
   assert.ok(!cast(body.group,approach,.12+layout.floor+1,[layout.innerDoor.inward[0],0,layout.innerDoor.inward[1]],2.3),'A separate internal doorway connects the corridor to the auditorium');
   assert.ok(clip.intersection([passageFootprint([roomPoint,[roomPoint[0]-.01,roomPoint[1]]],.1).outer],[main.outer]).length,'Only after the inner doorway is the visitor inside the auditorium');
   const start=layout.center.map((n,i)=>n-layout.outward[i]*.55),direction=[layout.outward[0],0,layout.outward[1]];
   assert.ok(!cast(body.group,start,.12+layout.floor+1,direction,1.1),'Both shared solid cap leaves are opened at the door');
   assert.ok(cast(glass,start.map((n,i)=>n+layout.axis[i]*.4),.12+layout.floor+1,direction,1.1),'A framed two-leaf glass door occupies the real opening');
   for(let i=1;i<layout.route.length;i++){
    const a=layout.route[i-1],b=layout.route[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]),d=[(b[0]-a[0])/length,0,(b[1]-a[1])/length];
    assert.ok(!cast(body.group,a,.12+layout.floor+1,d,length-.01),'The complete L turn has no body wall across it');
    const railHit=cast(rails,a,.12+layout.floor+.5,d,length-.01);
    assert.ok(!railHit,`Landing railings do not seal the route: ${JSON.stringify({a,b,hit:railHit&&[railHit.point.x,railHit.point.z],distance:railHit?.distance})}`);
   }
   const flight=passageFootprint([layout.flightTop,layout.bottom],layout.width);
   assert.deepEqual(clip.intersection([flight.outer],[theatre.outer]),[],'The whole flight including its width lies outside the theatre body');
   const a=theatre.outer[10], b=theatre.outer[11], wallLength=Math.hypot(b[0]-a[0],b[1]-a[1]);
   for(const t of [0,.3,.7,1]) {
    const edge=layout.flightTop.map((n,i)=>n+layout.flightAxis[i]*8.5*t-layout.flightNormal[i]*layout.width/2);
    assert.ok(Math.abs((edge[0]-a[0])*(b[1]-a[1])-(edge[1]-a[1])*(b[0]-a[0]))/wallLength<1e-6,'The entire inner stair edge touches the existing east facade');
   }
   for(const other of campus.buildings.filter(b=>b.id!==theatre.id)) {
    assert.deepEqual(clip.intersection([flight.outer],[other.outer,...other.holes]),[],`The flight avoids ${other.name}, including the laboratory`);
    for(const landing of layout.landingFootprints)assert.deepEqual(clip.intersection([landing.outer,...landing.holes],[other.outer,...other.holes]),[],`The L landing avoids ${other.name}`);
   }
   for(const p of [layout.route[1],layout.landing,layout.flightTop.map((n,i)=>n-layout.flightAxis[i]*.05)]){
    const outside=clip.intersection([passageFootprint([p,[p[0]+.001,p[1]]],.01).outer],[theatre.outer]).length===0;
    const down=[0,-1,0],y=.12+layout.floor+.15;
    assert.ok(cast(outside?stair:body.group,p,y,down,.3),'The turn and flight start have a joined slab at theatre-door level');
   }
   assert.ok(Math.abs(layout.treads.at(-1).height-.12)<1e-6,'The final tread reaches the existing ground surface');
   assert.ok(layout.treads.every((t,i)=>Math.abs((i?layout.treads[i-1].height:.12+layout.floor)-t.height)<=.18+1e-6),'Every riser is at most18cm');
   const below=cast(body.group,start,.12+fh*.5,direction,1.1);assert.ok(below,'The new door does not remove the ground-floor cap wall');
  }finally{body.dispose();Object.values(entry).forEach(g=>g.dispose());}
 }
});

test('the widened curved passage stays outside the auditorium timber, seats and tier surfaces',()=>{
 const fh=3.6,terrace=theatre.parts.find(p=>p.id==='curved-terrace'),info=buildingLevels(theatre),inside=theatreInteriorGeometry(theatre,info.height,fh,2*fh);
 try{
  const passage=[terrace.outer,...terrace.holes];
  for(const kind of ['seats','tiers']){
   const p=inside[kind].getAttribute('position');
   for(let i=0;i<p.count;i+=3){
    const ring=Array.from({length:3},(_,n)=>[p.getX(i+n),p.getZ(i+n)]);ring.push(ring[0]);
    // Vertical seat/tier triangles have zero plan area and cannot consume path width.
    const area=Math.abs(ring.slice(1).reduce((sum,q,j)=>sum+ring[j][0]*q[1]-q[0]*ring[j][1],0));if(area<1e-5)continue;
    const overlap=clip.intersection([ring],passage);
    const overlapArea=overlap.reduce((total,polygon)=>total+polygon.reduce((sum,r,k)=>sum+(k?-1:1)*Math.abs(r.slice(1).reduce((s,q,j)=>s+r[j][0]*q[1]-q[0]*r[j][1],0))/2,0),0);
    assert.ok(overlapArea<1e-5,'No seat or tier floor consumes the new outer walkway beyond float32 rounding');
   }
  }
 }finally{Object.values(inside).forEach(g=>g.dispose());}
});


test('perimeter glazing follows the full blue curve and eastern extension only on the original lower four floors',()=>{
 const terrace=theatre.parts.find(p=>p.id==='curved-terrace'),expected=[...theatre.outer.slice(11,22).reverse(),theatre.outer[10],theatre.outer[9]];
 assert.deepEqual(theatre.classroomWindows.facadeLines,[expected],'The blue range is the entire annotated outer path with no extra cap or south gallery glazing');
 for(const fh of [2.4,3.6,4.2]){
  const info=buildingLevels(theatre,{floorHeight:fh}),section=info.sections.find(s=>s.id===terrace.id),innerDoor=theatreEntranceLayout(theatre,fh).innerDoor,windows=theatreFacadeWindows(theatre,section,section.height,fh),body=model(fh),g=theatreGlazingGeometry(theatre,info.sections,fh),glass=mesh(g.glass);
  try{
   for(let floor=0;floor<4;floor++){
    const panes=windows.filter(w=>w.bottom>=floor*fh-1e-5&&w.top<=(floor+1)*fh+1e-5);assert.ok(panes.length>35,'Each lower storey retains continuous facade bays around the full perimeter');
    for(const pane of panes){
     const a=pane.from,b=pane.to,dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz),normal=[-dz/l,dx/l],mid=[(a[0]+b[0])/2,(a[1]+b[1])/2],p=mid.map((n,i)=>n-normal[i]*.5),d=[normal[0],0,normal[1]],y=.12+pane.bottom+(pane.top-pane.bottom)*.43;
     assert.ok(!cast(body.group,p,y,d,1),`Every glass pane has a real wall aperture: ${JSON.stringify({from:a,to:b,y,fh})}`);
     assert.ok(cast(glass,p,y,d,1),'Every aperture retains its actual perimeter glass');
     assert.ok(!cast(glass,p,.12+4*fh+1.5,d,1),'No perimeter glazing is invented on the fifth-floor open roof terrace');
    }
    assert.ok(panes.some(w=>(w.from[1]+w.to[1])/2< -30&&(w.from[0]+w.to[0])/2>69),'Glazing includes the formerly blank eastern end');
   }
  }finally{body.dispose();Object.values(g).forEach(g=>g.dispose());}
 }
});


test('both long inner walls are straight, equal length and mathematically symmetric',()=>{
 const t=theatre.parts.find(p=>p.id==='curved-terrace'),u=t.outer.slice(t.roofTerrace.railEdges[0].length+4,-1).reverse(),origin=[49.5,-36];
 const a=u[0],b=u[1],l=Math.hypot(b[0]-a[0],b[1]-a[1]),across=[(b[0]-a[0])/l,(b[1]-a[1])/l],along=[across[1],-across[0]],local=p=>[(p[0]-origin[0])*along[0]+(p[1]-origin[1])*along[1],(p[0]-origin[0])*across[0]+(p[1]-origin[1])*across[1]];
 for(let i=0;i<u.length;i++){const left=local(u[i]),right=local(u[u.length-1-i]);assert.ok(Math.abs(left[0]+right[0])<1e-6&&Math.abs(left[1]-right[1])<1e-6,'The complete inner U including the straight side endpoints has matching reflected coordinates');}
 const rightA=u.at(-1),rightB=u.at(-2);assert.ok(Math.abs(Math.hypot(rightB[0]-rightA[0],rightB[1]-rightA[1])-l)<1e-6,'Both straight walls have identical length');
 assert.ok(Math.abs((rightB[0]-rightA[0])*across[1]-(rightB[1]-rightA[1])*across[0])<1e-6,'The right wall is parallel to the straight left wall, rather than vertical in world coordinates');
});


test('the internal door moves five metres back and the grand door forecourt has no extra walls, glazing or frames',()=>{
 for(const fh of [2.4,3.6,4.2]){
  const layout=theatreEntranceLayout(theatre,fh),t=theatre.parts.find(p=>p.id==='curved-terrace'),rightNorth=t.outer[t.roofTerrace.railEdges[0].length+4],rightArc=t.outer[t.roofTerrace.railEdges[0].length+5],l=Math.hypot(rightArc[0]-rightNorth[0],rightArc[1]-rightNorth[1]),axis=[(rightArc[0]-rightNorth[0])/l,(rightArc[1]-rightNorth[1])/l];
  const oldStation=(65.6-rightNorth[0])*axis[0]+(-31.5-rightNorth[1])*axis[1],newStation=(layout.innerDoor.center[0]-rightNorth[0])*axis[0]+(layout.innerDoor.center[1]-rightNorth[1])*axis[1];assert.ok(Math.abs(oldStation-newStation-5)<1e-6,'The internal doorway moves toward the north return by the annotated five metres');
  const body=model(fh),info=buildingLevels(theatre,{floorHeight:fh}),g=theatreGlazingGeometry(theatre,info.sections,fh),entry=theatreEntranceGeometry(theatre,fh),group=new THREE.Group();group.add(mesh(g.glass),mesh(g.frames),mesh(entry.frames));group.updateMatrixWorld();
  try{
   const front=layout.center.map((n,i)=>n+layout.outward[i]*.3),d=[layout.outward[0],0,layout.outward[1]],y=.12+layout.floor+1.2;
   assert.ok(!cast(body.group,front,y,d,2.1),'The main door opens onto a simple forecourt without the former extra walls');
   assert.ok(!cast(group,front,y,d,2.1),'No duplicate ordinary glass or frame assembly remains in front of the door');
   const from=layout.innerDoor.center.map((n,i)=>n-layout.innerDoor.inward[i]*1.2),dInner=[layout.innerDoor.inward[0],0,layout.innerDoor.inward[1]];
   assert.ok(!cast(body.group,from,y,dInner,2.4),'The shifted internal doorway still connects corridor and auditorium through a real aperture');
  }finally{body.dispose();Object.values(g).forEach(g=>g.dispose());Object.values(entry).forEach(g=>g.dispose());}
 }
});

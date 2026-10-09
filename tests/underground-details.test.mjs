import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { undergroundLayout, joinedPassages } from '../src/underground-geometry.ts';
import { undergroundVolume, undergroundWallPanels, undergroundCameraInside, undergroundMaterialView } from '../src/underground-mesh.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';
const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const levels = campus.features.map(feature => /tunnel|underground/.test(feature.type) ? { ...feature, height: -3.8, wallHeight: feature.type === 'undergroundRoom' || feature.type === 'undergroundTrack' ? 6.2 : feature.type === 'tunnel' ? 3.2 : 4 } : feature);
const mesh = geometry => { const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({side:THREE.DoubleSide})); object.rotation.x=-Math.PI/2; object.updateMatrixWorld(); return object; };

test('underground sports halls have open doors and a non-overlapping floor connection to the side passages', () => {
  const before=JSON.stringify(levels), layout=undergroundLayout(levels), corridor=layout.areas.get('local/underground-corridor');
  for(const id of ['local/underground-badminton','local/sheltered-runway']) {
    const hall=layout.areas.get(id);
    assert.equal(hall.openings.length,2,'Each end opens into a real connecting corridor');
    const polygon = shapes => shapes.map(shape => [shape.outer.map(p => p.map(n => Math.round(n * 1e6) / 1e6))]);
    const overlap = polygonClipping.intersection(polygon(hall.footprints),polygon(corridor.footprints));
    const area = overlap.reduce((sum,[ring])=>sum+Math.abs(ring.slice(1).reduce((s,p,i)=>s+ring[i][0]*p[1]-p[0]*ring[i][1],0)/2),0);
    assert.ok(area<1e-4,'Practice-strip floor never stacks over the circulation floor');
    for(const opening of hall.openings) {
      assert.equal(opening.height,2.7);
      const center=opening[0].map((n,i)=>(n+opening[1][i])/2);
      const normal=new THREE.Vector3(opening[1][1]-opening[0][1],0,opening[0][0]-opening[1][0]).normalize();
      const objects=[hall,corridor].flatMap(area=>area.footprints.map(shape=>mesh(undergroundVolume(shape,area.feature.wallHeight,area.openings))));
      try {
        const start=new THREE.Vector3(center[0],1.6,center[1]).addScaledVector(normal,-.1);
        assert.equal(new THREE.Raycaster(start,normal,0,.2).intersectObjects(objects).length,0,'An eye-height ray can cross the door');
        start.y=3.4;
        assert.ok(new THREE.Raycaster(start,normal,0,.2).intersectObjects(objects).length,'Wall heads remain above the opening');
      } finally {objects.forEach(o=>{o.geometry.dispose();o.material.dispose();});}
    }
  }
  assert.equal(JSON.stringify(levels),before);
});

test('different passage ceiling heights keep an open join below the shorter ceiling and a wall above it', () => {
  const incoming={id:'t',type:'tunnel',height:-3.8,wallHeight:3.2,width:4,points:[[0,-20],[0,0]]};
  const outgoing={id:'j',type:'tunnelJunction',height:-3.8,wallHeight:4,width:5,points:[[0,0],[20,0]],connectedTo:['t']};
  const {areas}=undergroundLayout([incoming,outgoing]), seam=joinedPassages(incoming,outgoing).seam;
  assert.equal(seam.height,3.2);
  const normal=new THREE.Vector3(seam[1][1]-seam[0][1],0,seam[0][0]-seam[1][0]).normalize(), p=seam[0].map((n,i)=>(n+seam[1][i])/2);
  const objects=[...areas.values()].map(area=>mesh(undergroundVolume(area.footprints[0],area.feature.wallHeight,area.openings)));
  try {
    const start=new THREE.Vector3(p[0],1.6,p[1]).addScaledVector(normal,-.1);
    assert.equal(new THREE.Raycaster(start,normal,0,.2).intersectObjects(objects).length,0);
    start.y=3.7;
    assert.ok(new THREE.Raycaster(start,normal,0,.2).intersectObjects(objects).length);
  } finally {objects.forEach(o=>{o.geometry.dispose();o.material.dispose();});}
});

test('all underground model batches stay within their floors and ceilings and add recognizable photo-backed fittings', () => {
  let triangles=0;
  for(const area of undergroundLayout(levels).areas.values()) {
    const model=undergroundDetailGeometry(area.feature,area.footprints,area.openings), floor=area.feature.height, ceiling=floor+area.feature.wallHeight;
    for(const [kind,geometry] of Object.entries(model)) {
      const vertices=geometry.attributes.position;triangles+=vertices.count/3;
      assert.equal(geometry.userData.photoOcclusionMask.length,vertices.count/3);
      assert.ok(geometry.userData.photoOcclusionMask.every(n=>n===0),'Decorative underground details never suppress photo thumbnails');
      for(let i=0;i<vertices.count;i++) {
        assert.ok(Number.isFinite(vertices.getX(i))&&Number.isFinite(vertices.getY(i))&&Number.isFinite(vertices.getZ(i)));
        assert.ok(vertices.getY(i)>=floor-.001&&vertices.getY(i)<=ceiling+.001,kind);
      }
    }
    if(area.feature.type==='undergroundRoom') for(const kind of ['paint','nets','glass','green','wood','metal','lights','pipes']) assert.ok(model[kind].attributes.position.count,kind);
    if(area.feature.type==='undergroundCorridor') for(const kind of ['glass','walls','lights','tiles','pipes']) assert.ok(model[kind].attributes.position.count,kind);
    Object.values(model).forEach(geometry=>geometry.dispose());
  }
  assert.ok(triangles<35000,'Structure and sports details remain material-batched within a fixed geometry budget');
});

test('partial doors keep their jambs, and overhead inspections remove the volume ceiling', () => {
  const shape={outer:[[0,0],[10,0],[10,5],[0,5],[0,0]],holes:[]};
  const opening=[[3,0],[7,0]];opening.height=2.7;
  const panels=undergroundWallPanels(shape,6.2,[opening]);
  assert.ok(panels.some(p=>p.from[0]===3&&p.to[0]===7&&p.bottom===2.7));
  const object=mesh(undergroundVolume(shape,6.2,[opening],true));
  try {
    const hits=new THREE.Raycaster(new THREE.Vector3(5,8,2),new THREE.Vector3(0,-1,0)).intersectObject(object);
    assert.ok(hits.length&&Math.abs(hits[0].point.y)<1e-5,'The first surface is the floor, never the removed roof');
  } finally {object.geometry.dispose();object.material.dispose();}
});

test('only cameras inside an underground footprint and below its ceiling get the solid interior view',()=>{
  const space={floor:-3.8,height:6.2,footprints:[{outer:[[0,0],[10,0],[10,8],[0,8],[0,0]],holes:[[[3,3],[5,3],[5,5],[3,5],[3,3]]]}]};
  assert.equal(undergroundCameraInside({x:1,y:-2.2,z:2},space),true);
  for(const camera of [{x:11,y:-2.2,z:2},{x:4,y:-2.2,z:4},{x:1,y:-4,z:2},{x:1,y:2.4,z:2}])assert.equal(undergroundCameraInside(camera,space),false);
  const wall=new THREE.MeshStandardMaterial({transparent:true,opacity:.1,depthTest:false,depthWrite:false});
  undergroundMaterialView(wall,'inside',.1);
  assert.equal(wall.transparent,false);assert.equal(wall.opacity,1);assert.equal(wall.depthTest,true);assert.equal(wall.depthWrite,true);assert.equal(wall.userData.inside,true);
  undergroundMaterialView(wall,'nearby',.1);
  assert.equal(wall.transparent,true);assert.equal(wall.opacity,.1);assert.equal(wall.depthTest,true);assert.equal(wall.depthWrite,false);assert.equal(wall.userData.inside,true);
  undergroundMaterialView(wall,'plan',.1);
  assert.equal(wall.depthTest,false);assert.equal(wall.depthWrite,false);assert.equal(wall.userData.inside,false);
  undergroundMaterialView(wall,'inside',.28,true);
  assert.equal(wall.transparent,true);assert.equal(wall.opacity,.28);assert.equal(wall.depthTest,true);assert.equal(wall.depthWrite,false);
  wall.dispose();
});

test('the photographed curved entrance has a real open tunnel end cap, not a stair projected through a wall',()=>{
  const area=undergroundLayout(levels).areas.get('local/underpass'),entrance=levels.find(f=>f.type==='tunnelEntrance');
  assert.equal(area.openings.length,2,'Both the stair entrance and the far corridor are open');
  const stair=entrance.curvedStair,angle=stair.startAngle+stair.sweep,center=new THREE.Vector3(stair.center[0]+Math.cos(angle)*stair.radius,1.6,stair.center[1]+Math.sin(angle)*stair.radius);
  const normal=new THREE.Vector3(Math.sin(angle),0,-Math.cos(angle)),object=mesh(undergroundVolume(area.footprints[0],area.feature.wallHeight,area.openings));
  try {assert.equal(new THREE.Raycaster(center.clone().addScaledVector(normal,-.1),normal,0,.2).intersectObject(object).length,0);}finally {object.geometry.dispose();object.material.dispose();}
});

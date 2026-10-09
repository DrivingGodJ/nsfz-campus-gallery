import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { dormitoryBodyGeometry, dormitoryObservatory, facadeGeometry } from '../src/facade-geometry.ts';
import { photoInteriorPlacements, photoInteriorGeometry, photoInteriorShapes, PHOTO_INTERIOR_IDS, PHOTO_INTERIOR_EVIDENCE } from '../src/photo-interior-geometry.ts';
import { laboratoryLayout } from '../src/laboratory-geometry.ts';
import { pointOnStairTread } from '../src/structure-geometry.ts';
import { passageShape } from '../src/building-geometry.ts';
const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const site=JSON.parse(fs.readFileSync(new URL('../public/data/site.json',import.meta.url)));
const buildings=PHOTO_INTERIOR_IDS.map(id=>campus.buildings.find(b=>b.id===id));
const polygon=s=>[s.outer.map(p=>p.map(n=>Math.round(n*1e6)/1e6)),...s.holes.map(r=>r.map(p=>p.map(n=>Math.round(n*1e6)/1e6)))];
const area=polygons=>polygons.reduce((sum,rings)=>sum+rings.reduce((s,r,i)=>s+(i?-1:1)*Math.abs(r.slice(1).reduce((a,p,k)=>a+r[k][0]*p[1]-p[0]*r[k][1],0)/2),0),0);
const dispose=batches=>batches.forEach(({geometry})=>geometry.dispose());

test('interior furniture is tied to evidence and its whole envelope fits the actual occupied floor, without altering photo poses',()=>{
  const before=JSON.stringify(site);
  for(const building of buildings) for(const placement of photoInteriorPlacements(building)) {
    const source=site.photos.find(p=>p.id===placement.source);
    assert.ok(source,placement.id);assert.equal(source.floor,placement.floor);assert.equal(source.buildingId,building.id);
    const rooms=photoInteriorShapes(building,placement.floor).map(polygon);
    assert.ok(area(polygonClipping.difference(polygon(placement.shape),...rooms))<1e-4,placement.id);
  }
  assert.equal(JSON.stringify(site),before);
  assert.equal(PHOTO_INTERIOR_EVIDENCE.length,8);
});

test('art displays leave the interior garage ramp open and the window bench leaves a usable theatre gallery',()=>{
  const lab=buildings[2],layout=laboratoryLayout(lab);
  const garage=[...(lab.groundFloorOpenings||[]),...(lab.groundPassages||[]).map(passageShape)];
  const placements=photoInteriorPlacements(lab);
  for(const placement of placements.filter(p=>p.floor===1)) {
    assert.ok(area(polygonClipping.intersection(polygon(placement.shape),...garage.map(polygon)))<1e-4,placement.id);
    assert.ok(area(polygonClipping.intersection(polygon(placement.shape),polygon(layout.stair.opening)))<1e-4,placement.id);
  }
  assert.ok(placements.find(p=>p.kind==='art-panel'));
  const theatre=photoInteriorPlacements(buildings[3]);
  const axis=[.987633438,-.156780714],a=[30.80922625,-45.18263029];
  for(const u of [2,8,14,20,26,32,37]) {
    const center=[a[0]+axis[0]*u+.156780714*(-.55),a[1]+axis[1]*u+.987633438*(-.55)];
    assert.ok(theatre.filter(p=>!['exhibit','light-track'].includes(p.kind)).every(p=>!pointOnStairTread(center,p.shape.outer)),'The inner side of the gallery remains walkable');
  }
  assert.ok(theatre.find(p=>p.kind==='window-steps'));assert.ok(theatre.find(p=>p.kind==='bench'));
});

test('floor slicing removes the selected ceiling detail and every higher-floor object, while keeping furniture and zero marker occlusion',()=>{
  let total=0;
  for(const building of buildings) {
    const full=photoInteriorGeometry(building,21.6,3.6),cut=photoInteriorGeometry(building,21.6,3.6,3.6);
    const kinds=new Set(full.map(batch=>batch.kind));
    for(const {geometry} of full) {
      const p=geometry.attributes.position;total+=p.count/3;
      assert.equal(geometry.userData.photoOcclusionMask.length,p.count/3);
      assert.ok(geometry.userData.photoOcclusionMask.every(n=>n===0));
      const ceiling=building.id===PHOTO_INTERIOR_IDS[1]?25.79:21.72;
      for(let i=0;i<p.count;i++)assert.ok(Number.isFinite(p.getX(i))&&Number.isFinite(p.getY(i))&&Number.isFinite(p.getZ(i))&&p.getY(i)>=.36&&p.getY(i)<=ceiling+.001);
    }
    for(const {geometry} of cut){const p=geometry.attributes.position;for(let i=0;i<p.count;i++)assert.ok(p.getY(i)<=3.72+.001);}
    if(building.id===PHOTO_INTERIOR_IDS[0])assert.ok(kinds.has('green')&&kinds.has('orange')&&kinds.has('wood'));
    if(building.id===PHOTO_INTERIOR_IDS[1])assert.ok(kinds.has('dark')&&kinds.has('metal')&&kinds.has('stone'));
    dispose(full);dispose(cut);
  }
  const lab=buildings[2],ceilingRemoved=photoInteriorGeometry(lab,21.6,3.6,21.6);
  assert.ok(!ceilingRemoved.some(batch=>batch.kind==='lights'),'Sixth-floor slats and light strips vanish with its ceiling');
  assert.ok(ceilingRemoved.some(batch=>batch.kind==='wood'),'Balcony floor finish remains');
  dispose(ceilingRemoved);
  assert.ok(total<26000,`Material-batched detail triangle budget: ${total}`);
});

test('telescope is an open optical truss on floor six and dining rows leave the central aisle and columns clear',()=>{
  const dorm=photoInteriorPlacements(buildings[1]);assert.deepEqual(dorm.map(p=>[p.kind,p.floor]),[['telescope',6],['side-table',6]]);
  const cafeteria=photoInteriorPlacements(buildings[0]),tables=cafeteria.filter(p=>p.kind==='dining-set'),columns=cafeteria.filter(p=>p.kind==='column');
  assert.ok(tables.length>=25,'A populated dining hall, not one token table');
  assert.equal(columns.length,4);
  for(const table of tables) {
    assert.ok(Math.abs(table.center[0]+59.5)>2);
    for(const column of columns)assert.equal(area(polygonClipping.intersection(polygon(table.shape),polygon(column.shape))),0,'Chair envelopes do not collide with round columns');
  }
  const photo=site.photos.find(p=>p.id==='719592c1-5539-42c7-b21a-7d9492d273b0'), direction=[Math.sin(photo.heading*Math.PI/180),-Math.cos(photo.heading*Math.PI/180)];
  assert.equal(tables.filter(p=>p.id.startsWith('dining-window-bay')).length,3);
  assert.ok(tables.some(p=>{const dx=p.center[0]-photo.position.x,dz=p.center[1]-photo.position.z,front=dx*direction[0]+dz*direction[1];return front>2&&front<5&&Math.abs(dx*direction[1]-dz*direction[0])<1;}),'A table lies in the photographed near window bay, not only behind the camera');
  assert.ok(tables.every(p=>!pointOnStairTread([photo.position.x,photo.position.z],p.shape.outer)),'The shooting position stays clear');
  const first=photoInteriorGeometry(buildings[1],21.6,3.6),repeat=photoInteriorGeometry(buildings[1],21.6,3.6);
  assert.ok(first.find(p=>p.kind==='dark').geometry.attributes.position.array.some((n,i)=>i%3===1&&n>22.5),'The tall reflector rises into the existing observatory dome, above the former generic lid');
  assert.deepEqual(first.map(x=>Array.from(x.geometry.attributes.position.array)),repeat.map(x=>Array.from(x.geometry.attributes.position.array)),'Model anchors are deterministic and independent of a live photo view');
  dispose(first);dispose(repeat);
});

test('the observatory opens through only its roof patch and has a hollow support, preserving the sixth floor beneath it',()=>{
  const building=buildings[1],observatory=dormitoryObservatory(building,3.6),body=dormitoryBodyGeometry(building,21.6,3.6);
  const material=new THREE.MeshBasicMaterial({side:THREE.DoubleSide}),object=new THREE.Mesh(body,material);
  object.rotation.x=-Math.PI/2;object.position.y=.12;object.updateMatrixWorld();
  const [x,z]=observatory.center,up=new THREE.Vector3(0,1,0),origin=new THREE.Vector3(x,21.2,z),facade=facadeGeometry(building,6,3.6);
  const fittings=facade.geometries.map(part=>{const mesh=new THREE.Mesh(part.geometry,material);mesh.updateMatrixWorld();return mesh;});
  try {
    assert.equal(new THREE.Raycaster(origin,up,0,.7).intersectObject(object).length,0,'The former generic roof slab no longer blocks the dome cavity');
    assert.equal(new THREE.Raycaster(new THREE.Vector3(x,21.8,z),up,0,1.3).intersectObjects(fittings).length,0,'The observatory support is a hollow drum, never a solid plinth');
    assert.ok(new THREE.Raycaster(new THREE.Vector3(x,19,z),new THREE.Vector3(0,-1,0),0,1).intersectObject(object).length,'The actual sixth-floor slab remains');
    assert.ok(new THREE.Raycaster(new THREE.Vector3(x+6,21.2,z+5),up,0,.7).intersectObject(object).length,'The roof outside the circular observatory remains closed');
  } finally {body.dispose();facade.geometries.forEach(part=>part.geometry.dispose());material.dispose();}
});

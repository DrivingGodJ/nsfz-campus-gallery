import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { buildingLevels, buildingFloorLabel } from '../src/building-model.ts';
import { dormitoryBodyGeometry, dormitoryObservatory, facadeGeometry, FACADE_BASE } from '../src/facade-geometry.ts';
import { photoInteriorPlacements, photoInteriorGeometry, PHOTO_INTERIOR_EVIDENCE } from '../src/photo-interior-geometry.ts';
import { photoMapHeight, photoCameraHeightRange } from '../src/locations.ts';
import { mapLocationTarget } from '../src/location-geometry.ts';

const campus=JSON.parse(fs.readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const site=JSON.parse(fs.readFileSync(new URL('../public/data/site.json',import.meta.url)));
const dorm=campus.buildings.find(b=>b.id==='way/1233313434');
const material=()=>new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
const dispose=model=>model.geometries.forEach(({geometry})=>geometry.dispose());

test('the observatory is a named seventh floor while the six-storey dormitory remains six storeys',()=>{
  const info=buildingLevels(dorm,site.buildingOverrides[dorm.id]);
  assert.equal(dorm.floors,6);assert.equal(info.baseFloors,6);assert.equal(info.floors,7);
  assert.ok(info.sections.every(s=>s.floors===6&&s.height===info.baseHeight));
  assert.equal(buildingFloorLabel(info,6),'6 楼');assert.equal(buildingFloorLabel(info,7),'7 楼（天文台）');
  assert.equal(dorm.classroomWindows.endFloor,6,'Ordinary window rows are not added to a seventh dormitory storey');
  for(const floorHeight of [3.6,4.2]) {
    const oldHeight=6*floorHeight,base=dormitoryBodyGeometry(dorm,oldHeight,floorHeight),higher=dormitoryBodyGeometry(dorm,7*floorHeight,floorHeight);
    try {assert.deepEqual(higher.attributes.position.array,base.attributes.position.array,'The local seventh floor never extrudes the whole dormitory upward');}
    finally {base.dispose();higher.dispose();}
  }
});

test('both original instruments move into the enlarged seventh-floor globe and remain whole in its selected view',()=>{
  const info=buildingLevels(dorm,site.buildingOverrides[dorm.id]);
  const observatory=dormitoryObservatory(dorm,info.floorHeight);
  assert.equal(observatory.radius,info.floorHeight*1.05);assert.ok(observatory.radius>info.floorHeight*.77*1.3);
  assert.deepEqual(photoInteriorPlacements(dorm).map(p=>[p.id,p.floor]),[['observatory-reflector',7],['observatory-side-table',7]]);
  const sixth=photoInteriorGeometry(dorm,info.height,info.floorHeight,6*info.floorHeight);
  assert.equal(sixth.length,0,'No telescope or table remains on the sixth floor');
  for(const cutaway of [undefined,7*info.floorHeight]) {
    const batches=photoInteriorGeometry(dorm,info.height,info.floorHeight,cutaway);
    try {
      assert.ok(batches.some(b=>b.kind==='wood'),'The original side table is present');
      assert.ok(batches.some(b=>b.kind==='dark'),'The original reflector remains');
      const shellBase=observatory.floorY+observatory.drumRise+.01;
      let high=0;
      for(const {geometry} of batches) {
        const p=geometry.attributes.position;
        for(let i=0;i<p.count;i++) {
          const radial=Math.hypot(p.getX(i)-observatory.center[0],p.getZ(i)-observatory.center[1]),y=p.getY(i);
          assert.ok(y>=observatory.floorY-1e-4,'Every instrument rests on the actual seventh-floor slab');
          if(y<=shellBase)assert.ok(radial<observatory.radius-.22,'Instrument feet and the whole table fit inside the drum walls');
          else assert.ok((radial/observatory.radius)**2+((y-shellBase)/observatory.domeRise)**2<1,'The reflector head fits under the enlarged globe, without clipping its roof');
          high=Math.max(high,y);
        }
      }
      assert.ok(high>FACADE_BASE+7*info.floorHeight+.5,'Selecting seven does not flatten the tall reflector at a generic floor cut');
    } finally {batches.forEach(b=>b.geometry.dispose());}
  }
});

test('the seventh-floor globe has a real floor and roofward doorway, and six-floor selection hides only the rooftop room',()=>{
  const info=buildingLevels(dorm,site.buildingOverrides[dorm.id]),o=dormitoryObservatory(dorm,info.floorHeight);
  const seven=facadeGeometry(dorm,info.floors,info.floorHeight,7*info.floorHeight,true),six=facadeGeometry(dorm,info.floors,info.floorHeight,6*info.floorHeight,true),m=material();
  const meshes=seven.geometries.map(({geometry})=>{const mesh=new THREE.Mesh(geometry,m);mesh.updateMatrixWorld();return mesh;});
  try {
    assert.ok(seven.dome);assert.equal(six.dome,undefined);assert.equal(six.crown,undefined);
    const [x,z]=o.center,axis=new THREE.Vector3(o.doorAxis[0],0,o.doorAxis[1]),side=new THREE.Vector3(-axis.z,0,axis.x);
    assert.ok(new THREE.Raycaster(new THREE.Vector3(x,o.floorY+.1,z),new THREE.Vector3(0,-1,0),0,.2).intersectObjects(meshes).length,'The rooftop room has a solid slab immediately beneath the instruments');
    const door=new THREE.Vector3(x,o.floorY+1,z).addScaledVector(axis,o.radius-.5);
    assert.equal(new THREE.Raycaster(door,axis,0,1).intersectObjects(meshes).length,0,'The room door is an actual open passage onto the existing roof');
    for(const offset of [-.9,.9])assert.ok(new THREE.Raycaster(door.clone().addScaledVector(side,offset),axis,0,1).intersectObjects(meshes).length,'Both door jambs remain');
    door.y=o.floorY+2.5;
    assert.ok(new THREE.Raycaster(door,axis,0,1).intersectObjects(meshes).length,'The drum lintel remains above the opening');
    const body=dormitoryBodyGeometry(dorm,info.baseHeight,info.floorHeight),mesh=new THREE.Mesh(body,m);mesh.rotation.x=-Math.PI/2;mesh.position.y=FACADE_BASE;mesh.updateMatrixWorld();
    try {assert.ok(new THREE.Raycaster(new THREE.Vector3(x,FACADE_BASE+info.baseHeight+.1,z),new THREE.Vector3(0,-1,0),0,.3).intersectObject(mesh).length,'Moving the room upstairs closes the old hole in the six-storey roof');}
    finally {body.dispose();}
  } finally {dispose(seven);dispose(six);m.dispose();}
});

test('the unique photo and focus use the seventh-floor room floor rather than the ordinary sixth-floor height',()=>{
  const source=PHOTO_INTERIOR_EVIDENCE[1],photo=site.photos.find(p=>p.id===source.photoId);
  const info=buildingLevels(dorm,site.buildingOverrides[dorm.id]),o=dormitoryObservatory(dorm,info.floorHeight);
  assert.equal(source.floor,7);assert.equal(photo.floor,7);
  const range=photoCameraHeightRange(photo,campus,site),cameraHeight=Math.min(range.max,Math.max(range.min,Number.isFinite(photo.cameraHeight)?photo.cameraHeight:1.6));
  assert.equal(photoMapHeight(photo,campus,site),info.baseElevation+o.floorY+cameraHeight,'The current user-edited camera height is measured above the seventh-floor slab');
  assert.equal(photoMapHeight({...photo,cameraHeight:1.6},campus,site),info.baseElevation+o.floorY+1.6,'An independent eye-height example uses the same actual seventh-floor slab');
  const target=mapLocationTarget(campus,site,dorm.id,7);
  assert.deepEqual([target.target[0],target.target[2]],o.center);
  assert.ok(target.bounds.max[0]-target.bounds.min[0]<8,'Selecting seven focuses the local globe instead of the whole wide dormitory');
  assert.ok(target.bounds.max[1]>=o.floorY+o.drumRise+o.domeRise,'The selected bounds retain the complete globe and telescope head');
});

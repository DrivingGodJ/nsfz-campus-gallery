import test from 'node:test';
import fs from 'node:fs';import assert from 'node:assert/strict';import * as THREE from 'three';
import {buildingLevels} from '../src/building-model.ts';import {buildingGeometry} from '../src/building-geometry.ts';import {teachingDetailGeometry} from '../src/teaching-details.ts';
test('the first-floor display is attached outside the photo-confirmed solid wall',()=>{
const campus=JSON.parse(fs.readFileSync('public/data/campus.json')),site=JSON.parse(fs.readFileSync('public/data/site.json')),b=campus.buildings.find(b=>b.id==='way/855459420'),info=buildingLevels(b,site.buildingOverrides[b.id]);
const core=b.solidCores.find(c=>c.wallDisplay),config=core.wallDisplay,a=core.outer[config.edge],z=core.outer[config.edge+1],dx=z[0]-a[0],dz=z[1]-a[1],length=Math.hypot(dx,dz),out=new THREE.Vector3(dz/length,0,-dx/length),tangent=new THREE.Vector3(dx/length,0,dz/length),mid=new THREE.Vector3((a[0]+z[0])/2,.12+config.bottom+config.height/2,(a[1]+z[1])/2);
const geometry=teachingDetailGeometry(b,info.sections,info.floorHeight),g=buildingGeometry(info.sections.find(s=>s.id===core.partId),info.sections.find(s=>s.id===core.partId).height,info.floorHeight,b.groundPassages,b.floorCorridors.filter(c=>c.partId===core.partId),b.stairwells.filter(c=>c.partId===core.partId),b.classroomWindows,b.solidCores.filter(c=>c.partId===core.partId),b.cutouts.filter(c=>c.partId===core.partId));g.rotateX(-Math.PI/2);g.translate(0,.12,0);
const mesh=g=>{const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));m.updateMatrixWorld();return m;},screen=mesh(geometry.screens),wall=mesh(g);
for(const offset of [-2,0,2]){const from=mid.clone().addScaledVector(tangent,offset).addScaledVector(out,1),ray=new THREE.Raycaster(from,out.clone().negate(),0,2);let panel=ray.intersectObject(screen),body=ray.intersectObject(wall);assert.ok(panel.length&&body.length);assert.ok(panel[0].distance<body[0].distance,'Black screen is on the outside of the existing opaque wall');assert.ok(body[0].distance-panel[0].distance<.2,'No floating screen or replacement of structural wall');}
const bound=new THREE.Box3().setFromBufferAttribute(geometry.screens.attributes.position);assert.ok(Math.abs(bound.min.y-(.12+.55))<1e-5);assert.ok(Math.abs(bound.max.y-(.12+.55+2.5))<1e-5);console.log('Black ground-floor screen 4.8 by 2.5 m is mounted outside the photo-confirmed wall; wall preserved.');

Object.values(geometry).forEach(g=>g.dispose());g.dispose();screen.material.dispose();wall.material.dispose();
});

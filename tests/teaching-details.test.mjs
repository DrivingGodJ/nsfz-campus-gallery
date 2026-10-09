import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { buildingLevels } from '../src/building-model.ts';
import { buildingSkylightGeometry } from '../src/skylight-geometry.ts';
import { teachingDetailGeometry } from '../src/teaching-details.ts';
const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420');

test('teaching details keep the atriums open, follow floor edits and leave selected ceilings absent', () => {
  const original = JSON.stringify(building);
  for (const floorHeight of [3.6, 4.2]) {
    const info = buildingLevels(building, {floors:5,floorHeight});
    for (const floor of [1,3,5,undefined]) {
      const cut = floor && floor * floorHeight, details = teachingDetailGeometry(building, info.sections, floorHeight, cut);
      const material = new THREE.MeshBasicMaterial({side:THREE.DoubleSide});
      const meshes = Object.values(details).map(geometry => { const mesh = new THREE.Mesh(geometry,material);mesh.updateMatrixWorld();return mesh; });
      let triangles = 0;
      for (const geometry of Object.values(details)) {
        geometry.computeBoundingBox();
        if(geometry.attributes.position.count) assert.ok(geometry.boundingBox.max.y <= .12 + (cut ?? info.height) + 1e-5);
        assert.ok(geometry.userData.photoOcclusionMask.every(v => v === 0));
        triangles += geometry.attributes.position.count / 3;
      }
      assert.ok(triangles < 13000, 'Batched ornament stays small enough for the existing demand renderer');
      for (const passage of building.groundPassages) for (let offset = -passage.width / 2 + .2; offset < passage.width / 2 - .1; offset += .2) {
        const a = passage.points[0], b = passage.points.at(-1), dx = b[0]-a[0], dz = b[1]-a[1], length = Math.hypot(dx,dz);
        const start = new THREE.Vector3(a[0]-dz/length*offset, .12+floorHeight*.5, a[1]+dx/length*offset);
        assert.equal(new THREE.Raycaster(start,new THREE.Vector3(dx/length,0,dz/length),0,length).intersectObjects(meshes).length,0,'Atrium columns leave the whole ground passage width clear');
      }
      for (const section of info.sections) {
        const hole = section.holes[0], center = hole.slice(0,-1).reduce((p,q)=>[p[0]+q[0]/4,p[1]+q[1]/4],[0,0]);
        const ray = new THREE.Raycaster(new THREE.Vector3(center[0],.12+floorHeight*.5,center[1]),new THREE.Vector3(0,1,0));
        assert.equal(ray.intersectObjects(meshes).length,0,'Columns and AC units never span the courtyard interior');
        const floorHit = new THREE.Raycaster(new THREE.Vector3(center[0],1,center[1]),new THREE.Vector3(0,-1,0)).intersectObjects(meshes)[0];
        assert.ok(floorHit && Math.abs(floorHit.point.y-.145)<.02,'Ground paving lies on the ground, not a floating floor');
      }
      const roofs = buildingSkylightGeometry(building,info.sections,cut);
      if (floor) assert.equal(roofs.length,0,'Selecting any main floor removes its glass AND space frame');
      else {
        const roof=roofs[0];roof.frame.computeBoundingBox();
        assert.ok(roof.frame.boundingBox.min.y < .12+info.sections[0].height-.5,'The photographed space frame has actual depth below the glass');
        assert.ok(roof.frame.boundingBox.max.y < .12+info.sections[0].height+.2,'The original roof silhouette stays intact');
      }
      roofs.forEach(r=>{r.glass.dispose();r.frame.dispose()});
      Object.values(details).forEach(g=>g.dispose());material.dispose();
    }
  }
  assert.equal(JSON.stringify(building),original,'Rendering details never rewrites approved building boundaries');
});

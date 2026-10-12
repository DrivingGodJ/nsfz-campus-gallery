import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { laboratoryBodyGeometry, laboratoryLayout, laboratoryWindows } from '../src/laboratory-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { stairwellShaft, teachingStairGeometry } from '../src/teaching-stairs.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459411');
const info = buildingLevels(building, site.buildingOverrides[building.id]);
const layout = laboratoryLayout(building), { at, stair, stairU, roomWidth } = layout;
const origin = at(0,0), along = at(1,0).map((n,i)=>n-origin[i]), inward = at(0,1).map((n,i)=>n-origin[i]);
const uv = p => [(p[0]-origin[0])*along[0]+(p[1]-origin[1])*along[1],(p[0]-origin[0])*inward[0]+(p[1]-origin[1])*inward[1]];
const rear = uv(stair.opening.outer[0])[1];
const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const body = laboratoryBodyGeometry(building, info.height, info.floorHeight), walls = new THREE.Mesh(body, material);
walls.rotation.x = -Math.PI/2; walls.position.y = .12; walls.updateMatrixWorld();
const ray = (target, from, to, y) => new THREE.Raycaster(new THREE.Vector3(from[0],y,from[1]), new THREE.Vector3(to[0]-from[0],0,to[1]-from[1]).normalize(),0,Math.hypot(to[0]-from[0],to[1]-from[1])).intersectObject(target);
const down = (target,p,y) => new THREE.Raycaster(new THREE.Vector3(p[0],y,p[1]), new THREE.Vector3(0,-1,0),0,.8).intersectObject(target);

test.after(() => { body.dispose(); material.dispose(); });

test('the marked stair moves one bay east and meets the main laboratory facade exactly', () => {
  const corner = building.outer[9], next = building.outer[8];
  assert.ok(Math.hypot(...stair.opening.outer[0].map((n,i)=>n-corner[i])) < 1e-8);
  assert.ok(Math.abs(uv(stair.opening.outer[1])[1]-uv(next)[1]) < 1e-8, 'The new rear wall lies on the same main facade line');
  assert.ok(Math.abs(stairU-18.3-4.376387213755105) < 1e-8, 'The stair moves east into the adjacent marked bay');
  assert.ok(stair.origin[0] > 86.50668177103596 && Math.abs(uv(stair.origin)[1]-10.12) < 1e-8);
  assert.deepEqual(building.classroomWindows.facadeLines, [stair.opening.outer.slice(0,2)], 'The observed window calibration follows the shared outside wall');
  assert.equal(stair.width,3.8); assert.equal(stair.run,3.2); assert.equal(stair.firstFlight,'left');
  assert.deepEqual(polygonClipping.difference([stair.opening.outer],[layout.rooms.at(-1).outer]), [], 'The whole stair enclosure is inside the main classroom outline');
});

test('one common wall encloses all six floors, with no former stair partition or duplicate wall leaf', () => {
  for(let floor=0;floor<info.floors;floor++) {
    const y=.12+floor*info.floorHeight+1.5;
    const hits=ray(walls,at(stairU-roomWidth/2+.4,rear-1),at(stairU-roomWidth/2+.4,rear+2),y);
    const distances=[...new Set(hits.map(hit=>Math.round(hit.distance*1e4)/1e4))];
    assert.equal(distances.length,2,'The outside and inside faces belong to one wall');
    assert.ok(Math.abs(distances[0]-1)<1e-4 && Math.abs(distances[1]-1.28)<1e-4,'The shared wall is only .28m thick');
    assert.equal(ray(walls,at(stairU,4.15),at(stairU,4.5),y).length,0,'The former parallel rear-wall station is now empty stair interior');
    assert.equal(ray(walls,at(15.9,8),at(20.45,8),y).length,0,'Neither former side partition remains in the old stair bay');
    for(const side of [-1,0,1]) assert.equal(ray(walls,at(stairU+side,13),at(stairU+side,10.7),y).length,0,'The stair entrance stays open across its full walking width');
    assert.ok(down(walls,at(18.3,8),.12+floor*info.floorHeight+.4).length,'The old stair shaft becomes a normal complete floor');
  }
});

test('the real sixth-floor pane cuts only the common wall, and stair shafts follow the moved flights', () => {
  const windows=laboratoryWindows(building,info.height,info.floorHeight);
  assert.equal(windows.length,1); const [window]=windows;
  assert.deepEqual(window.mullions,[0,.25,.5,.75,1]); assert.deepEqual(window.upperMullions,[0,.5,1]);
  assert.ok(Math.abs(uv(window.from)[1]-rear-.14)<1e-4,'The glass is centred inside the one shared wall');
  const paneY=.12+(window.bottom+window.top)/2;
  assert.equal(ray(walls,at(stairU,rear-.5),at(stairU,rear+.8),paneY).length,0,'The pane is a real through-opening from outside into the stair');
  assert.ok(ray(walls,at(stairU,rear-.5),at(stairU,rear+.8),paneY-info.floorHeight).length,'Unknown lower-storey windows remain unaltered masonry');
  const shaft=stairwellShaft(stair), center=shaft.outer.slice(0,4).reduce((s,p)=>[s[0]+p[0]/4,s[1]+p[1]/4],[0,0]);
  for(let floor=1;floor<info.floors;floor++) assert.equal(down(walls,center,.12+floor*info.floorHeight+.4).length,0,'The moved staircase has open shafts through every upper floor');
  const model=teachingStairGeometry({...building,stairwells:[stair]},info.sections,info.floorHeight);
  try {
    model.concrete.computeBoundingBox(); const bounds=model.concrete.boundingBox;
    assert.ok(bounds.min.x>85.6,'The old west staircase no longer contains any tread or support');
    assert.ok(model.concrete.attributes.position.count>0 && model.rails.attributes.position.count>0,'The new bay contains both actual flights and guards');
  } finally { Object.values(model).forEach(geometry=>geometry.dispose()); }
});

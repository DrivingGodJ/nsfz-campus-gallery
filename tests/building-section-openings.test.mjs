import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildingGeometry, buildingSectionWindows } from '../src/building-geometry.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';

const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const config = { wallThickness: .28, bayWidth: 2, windowWidth: 1.8, sill: .6, top: 3.2, columns: 1, transom: .4 };
const section = { id: 'main', name: 'room', floors: 6, height: 21.6, outer: [[0,0],[10,0],[10,8],[0,8],[0,0]], holes: [], openEdges: [1], openEdgesStartFloor: 2, openEdgesEndFloor: 5 };
const building = { ...section, id: 'test', center: [5,4], classroomWindows: config };
const ray = (target, y, z = 3) => new THREE.Raycaster(new THREE.Vector3(9,y,z),new THREE.Vector3(1,0,0),0,2).intersectObject(target);

// A real floor-range seam leaves its slabs intact and retains the exterior wall
// on storeys where the adjoining part is absent. Glass uses the same decision.
test('part joins remove one wall leaf and its panes only on the requested storeys', () => {
  for (const floorHeight of [2.4,3.6,4.2]) for (const cut of [undefined,5,6]) {
    const height = Math.min(6 * floorHeight, (cut ?? 6) * floorHeight);
    const geometry = buildingGeometry(section,height,floorHeight,[],[],[],config,[],[],cut!==undefined);
    const body = new THREE.Mesh(geometry,material); body.rotation.x=-Math.PI/2;body.position.y=.12;body.updateMatrixWorld();
    const panes = teachingWindowGeometry(building,[{...section,height:6*floorHeight}],floorHeight,cut===undefined?undefined:cut*floorHeight);
    const glass = new THREE.Mesh(panes.glass,material);glass.updateMatrixWorld();
    try {
      for(let floor=1;floor<=Math.min(cut??6,6);floor++) {
        const open = floor>=2&&floor<=5;
        // The lower sill is masonry on closed floors and empty at open joins.
        assert.equal(ray(body,.12+(floor-1)*floorHeight+.4).length>0,!open,'No wall remains in an open join, while first/sixth-storey exterior walls remain');
        assert.equal(ray(glass,.12+(floor-1)*floorHeight+1.2).length>0,!open,'No decorative pane seals the open join');
        const slab = new THREE.Raycaster(new THREE.Vector3(9.5,.12+(floor-1)*floorHeight+.5,3),new THREE.Vector3(0,-1,0),0,.6).intersectObject(body)[0];
        assert.ok(slab,'Opening the wall retains its ordinary floor slab');
      }
      const windows = buildingSectionWindows(section,[[section.outer]],config,height,floorHeight);
      assert.equal(windows.filter(window=>window.from[0]>9.8&&window.to[0]>9.8&&window.bottom>=floorHeight&&window.bottom<5*floorHeight).length,0);
    } finally { geometry.dispose();Object.values(panes).forEach(g=>g.dispose()); }
  }
});

test('an opaque part with an explicit join also gets a thin shell with that edge open', () => {
  const geometry = buildingGeometry({...section,openEdgesStartFloor:1,openEdgesEndFloor:6},21.6,3.6);
  const body = new THREE.Mesh(geometry,material);body.rotation.x=-Math.PI/2;body.position.y=.12;body.updateMatrixWorld();
  try {
    assert.equal(ray(body,1.6).length,0);
    assert.ok(new THREE.Raycaster(new THREE.Vector3(1,1.6,3),new THREE.Vector3(-1,0,0),0,2).intersectObject(body).length,'Other perimeter walls stay intact');
  } finally { geometry.dispose(); }
});

test('an interior partition adds only its active wall without phantom boundaries on the ground or sixth storey', () => {
  const room={...section,openEdges:[]},partition={partId:'main',partition:true,startFloor:2,endFloor:5,outer:[[5,0],[5.01,0],[5.01,8],[5,8],[5,0]],holes:[]};
  for(const cut of [undefined,5,6]) {
    const height=(cut??6)*3.6,g=buildingGeometry(room,height,3.6,[],[],[],config,[partition],[],cut!==undefined),body=new THREE.Mesh(g,material);
    body.rotation.x=-Math.PI/2;body.position.y=.12;body.updateMatrixWorld();
    const panes=teachingWindowGeometry({...building,solidCores:[partition]},[{...room,height:21.6}],3.6,cut===undefined?undefined:cut*3.6),glass=new THREE.Mesh(panes.glass,material);glass.updateMatrixWorld();
    try {
      for(let floor=1;floor<=(cut??6);floor++) {
        const y=.12+(floor-1)*3.6+1.5,hits=new THREE.Raycaster(new THREE.Vector3(4.5,y,4),new THREE.Vector3(1,0,0),0,1).intersectObject(body);
        assert.equal(hits.length>0,floor>=2&&floor<=5,'An inactive partition leaves no generic wall on either side of its footprint');
        if(hits.length)assert.ok(Math.abs(hits.at(-1).distance-hits[0].distance-.01)<1e-4,'The active partition is only its specified wall thickness');
        if(floor===1||floor===6) {
          const ray=new THREE.Raycaster(new THREE.Vector3(5,y,.6),new THREE.Vector3(0,0,-1),0,1.2);
          assert.equal(ray.intersectObject(body).length,0,'The original facade aperture is retained on inactive storeys');
          assert.ok(ray.intersectObject(glass).length,'The inactive partition does not suppress the original facade glazing');
        }
      }
    } finally {g.dispose();Object.values(panes).forEach(g=>g.dispose());}
  }
});

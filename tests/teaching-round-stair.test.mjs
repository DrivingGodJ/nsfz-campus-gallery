import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { buildingLevels } from '../src/building-model.ts';
import { buildingGeometry } from '../src/building-geometry.ts';
import { stairwellFrame, stairwellShaft, teachingStairGeometry } from '../src/teaching-stairs.ts';
import { solidCoreWindowLayout, confirmedFacade } from '../src/teaching-classrooms.ts';
import { teachingWindowGeometry } from '../src/architecture-geometry.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(fs.readFileSync(new URL('../public/data/site.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459420');
const stair = building.stairwells.find(s => s.followWalls), frame = stairwellFrame(stair);
const enclosure = building.solidCores.find(core => JSON.stringify(core.outer) === JSON.stringify(stair.opening.outer));
const info = buildingLevels(building, site.buildingOverrides[building.id]), section = info.sections.find(s => s.id === stair.partId);
const point = (u, v, y) => { const [x, z] = frame.at(u, v); return new THREE.Vector3(x, y, z); };
const mesh = (geometry, body = false) => {
  const object = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  if (body) { object.rotation.x = -Math.PI / 2; object.position.y = .12; }
  object.updateMatrixWorld(); return object;
};
const down = (model, point) => new THREE.Raycaster(point, new THREE.Vector3(0, -1, 0)).intersectObject(model)[0];
const body = (s, floor) => buildingGeometry(s, floor ? floor * info.floorHeight : s.height, info.floorHeight, building.groundPassages,
  building.floorCorridors.filter(c => c.partId === s.id), building.stairwells.filter(c => c.partId === s.id), building.classroomWindows,
  building.solidCores.filter(c => c.partId === s.id), building.cutouts.filter(c => c.partId === s.id), !!floor);

test('the rounded wing stair follows the marked left-outward and right-return ascent and ends at the sixth floor', () => {
  assert.equal(stair.firstFlight, 'left'); assert.ok(frame.along[0] < -.9);
  assert.equal(section.floors, 6); assert.equal(stair.roofAccess,undefined);
  assert.equal(clip.difference([stairwellShaft(stair).outer], [stair.opening.outer]).length, 0);
  const geometry = teachingStairGeometry({ ...building, stairwells: [stair] }, info.sections, info.floorHeight), steps = mesh(geometry.concrete);
  for (let level = 0; level < 5; level++) for (let i = 0; i < stair.stepsPerFlight; i++) {
    const t = (i + .5) / stair.stepsPerFlight, base = .12 + level * info.floorHeight + .25;
    const rise = (i + 1) * info.floorHeight / 2 / stair.stepsPerFlight;
    const left = down(steps, point(stair.landingDepth + t * stair.run, -.7, base + info.floorHeight / 2 + .1));
    const right = down(steps, point(stair.landingDepth + (1 - t) * stair.run, .7, base + info.floorHeight + .1));
    assert.ok(left && Math.abs(left.point.y - base - rise) < 1e-4);
    assert.ok(right && Math.abs(right.point.y - base - info.floorHeight / 2 - rise) < 1e-4);
  }
  const bounds = geometry.concrete.getAttribute('position');
  geometry.concrete.computeBoundingBox();geometry.rails.computeBoundingBox();
  assert.ok(geometry.concrete.boundingBox.max.y<=.12+5*info.floorHeight+.25+1e-4,'No sixth-to-roof flight remains');
  assert.ok(geometry.rails.boundingBox.max.y<=.12+5*info.floorHeight+.25+1.05,'No sixth-to-roof flight guard remains');
  for (let i = 0; i < bounds.count; i++) {
    const [x, z] = [bounds.getX(i), bounds.getZ(i)], e = 2e-5;
    assert.ok(clip.intersection([stair.opening.outer], [[[x-e,z-e],[x+e,z-e],[x+e,z+e],[x-e,z+e],[x-e,z-e]]]).length, 'No tread or landing protrudes through the rounded enclosure');
  }
  Object.values(geometry).forEach(g => g.dispose()); steps.material.dispose();
});

test('the rounded shaft keeps six-floor openings and glass beneath a normal roof without an upper stair room', () => {
  const shape = body(section), shell = mesh(shape, true), geometry = teachingStairGeometry({ ...building, stairwells: [stair] }, info.sections, info.floorHeight), steps = mesh(geometry.concrete);
  const forward = new THREE.Vector3(frame.along[0], 0, frame.along[1]);
  for (let floor = 0; floor < 6; floor++) {
    const y = .12 + floor * info.floorHeight + .25;
    for (const v of [-2.5,-1,0,1,2.5]) for (const rise of [1.3,2.65]) {
      assert.equal(new THREE.Raycaster(point(-.4,v,y+rise),forward,0,.8).intersectObject(shell).length, 0, 'The whole corridor-facing wall stays open');
      assert.ok(Math.abs(down(shell,point(.4,v,y+1)).point.y-y)<1e-4, 'The near landing joins the corridor slab');
    }
    for (const side of [-1,1]) {
      const across = new THREE.Vector3(frame.across[0]*side,0,frame.across[1]*side);
      assert.ok(new THREE.Raycaster(point(.6,0,y+1.3),across,0,5).intersectObject(shell).length,
        'A side partition remains between the staircase and adjoining classroom');
      const wall = new THREE.Raycaster(point(2.5,0,y+.03),across,0,5).intersectObject(shell)[0];
      assert.ok(wall, 'The rounded outside retains its window sill');
      const edge = wall.point.clone().addScaledVector(across,-.015);edge.y=y+info.floorHeight+.1;
      if(floor<5)assert.ok(down(steps,edge), 'Each widened flight reaches the inside of the actual side wall');
    }
  }
  const windows = solidCoreWindowLayout([enclosure],section.height,info.floorHeight);
  assert.ok(windows.length >= 6);
  for(let floor=0;floor<6;floor++) assert.ok(windows.filter(w=>w.bottom>floor*info.floorHeight&&w.bottom<(floor+1)*info.floorHeight)
    .reduce((sum,w)=>sum+(w.mullions?.length||0),0)>=6,'Every curved window run has five framed columns');
  const window = windows.find(w=>w.bottom>7 && w.bottom<8), center = new THREE.Vector3((window.from[0]+window.to[0])/2,.12+(window.bottom+window.top)/2,(window.from[1]+window.to[1])/2);
  const tangent = new THREE.Vector3(window.to[0]-window.from[0],0,window.to[1]-window.from[1]).normalize(), normal = new THREE.Vector3(-tangent.z,0,tangent.x);
  assert.equal(new THREE.Raycaster(center.addScaledVector(normal,-.8),normal,0,1.6).intersectObject(shell).length,0,'Exterior glazing cuts a real aperture into the wall');
  const roof = .12 + section.height;
  assert.ok(Math.abs(down(shell,point(.4,0,roof+4)).point.y-roof)<1e-4,'The round stair room ends at the ordinary sixth-floor roof');
  assert.ok(Math.abs(down(shell,point(2.5,0,roof+.15)).point.y-roof)<1e-4,'The sixth-floor roof closes the former roof-access shaft');
  assert.equal(new THREE.Raycaster(point(-.4,0,roof+1.3),forward,0,.8).intersectObject(shell).length,0);
  const cut = body(section,3);cut.computeBoundingBox();assert.ok(cut.boundingBox.max.z<=3*info.floorHeight+1e-4);cut.dispose();
  shape.dispose();shell.material.dispose();steps.material.dispose();Object.values(geometry).forEach(g=>g.dispose());
});

test('the moved joining wall clears its former position while the wrongly blanked sixth-floor outside window is restored', () => {
  const main=info.sections.find(s=>s.id==='main'),[a,b]=[[91.40756430915667,64.01983915509366],[89.47396089486412,52.82109838093125]];
  const along=new THREE.Vector3(b[0]-a[0],0,b[1]-a[1]).normalize(),normal=new THREE.Vector3(-along.z,0,along.x);
  const glassGeometry=teachingWindowGeometry(building,info.sections,info.floorHeight),glass=mesh(glassGeometry.glass),frames=mesh(glassGeometry.frames);
  const objects=info.sections.map(s=>mesh(body(s),true));
  for (let floor=2;floor<=main.floors;floor++) for(const t of [.4,.6,.8]) {
    const p=new THREE.Vector3(a[0]+(b[0]-a[0])*t,.12+(floor-1)*info.floorHeight+1.6,a[1]+(b[1]-a[1])*t).addScaledVector(normal,-.5);
    const ray=new THREE.Raycaster(p,normal,0,1);
    assert.equal(ray.intersectObjects(objects).length,0,'The former masonry position opens into the expanded room');
    assert.equal(ray.intersectObjects([glass,frames]).length,0,'No pane or window frame remains on the shared end facade');
  }
  const p=new THREE.Vector3((a[0]+b[0])/2,.12+5*info.floorHeight+1.6,(a[1]+b[1])/2).addScaledVector(normal,-.5);
  const ray=new THREE.Raycaster(p,normal,0,1);
  assert.equal(ray.intersectObjects(objects).length,0,'The sixth floor restores an actual ordinary window opening above the five-floor part');
  assert.ok(ray.intersectObject(glass).length,'The wrongly blanked sixth-floor end has its ordinary glass pane again');
  for(const core of building.solidCores) for(const window of solidCoreWindowLayout([core],24,info.floorHeight)) {
    const cut=window.cut[0]; assert.equal(confirmedFacade(cut[0],cut[1],[{from:a,to:b}]),false);
  }
  objects.forEach(o=>{o.geometry.dispose();o.material.dispose()});Object.values(glassGeometry).forEach(g=>g.dispose());glass.material.dispose();frames.material.dispose();
});

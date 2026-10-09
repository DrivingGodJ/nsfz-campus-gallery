import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { buildingGeometry, passageShape, snapFootprint } from '../src/building-geometry.ts';
import { laboratoryBodyGeometry, laboratoryLayout } from '../src/laboratory-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { teachingRailGeometry } from '../src/architecture-geometry.ts';
import { teachingStairGeometry, stairwellShaft } from '../src/teaching-stairs.ts';
import { buildingSkylightGeometry } from '../src/skylight-geometry.ts';
import { buildingFloorLineGeometry } from '../src/building-floor-lines.ts';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const building = campus.buildings.find(b => b.id === 'way/855459411');
const theatre = campus.buildings.find(b => b.id === 'local/theatre');
const snapshot = JSON.stringify(building);
const mesh = (geometry, extruded = false) => {
  const result = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  if (extruded) { result.rotation.x = -Math.PI / 2; result.position.y = .12; }
  result.updateMatrixWorld(); return result;
};
const cast = (target, from, to, y, limit = 100) => new THREE.Raycaster(new THREE.Vector3(from[0], y, from[1]), new THREE.Vector3(to[0] - from[0], 0, to[1] - from[1]).normalize(), 0, limit).intersectObject(target);
const down = (target, p, y) => new THREE.Raycaster(new THREE.Vector3(p[0], y, p[1]), new THREE.Vector3(0, -1, 0), 0, .8).intersectObject(target);

test('laboratory corridors connect each floor while the round enclosure and outer walls remain walls', () => {
  const { at, circleU } = laboratoryLayout(building), geometry = laboratoryBodyGeometry(building, 21.6, 3.6), target = mesh(geometry, true);
  for (let floor = 0; floor < 6; floor++) {
    const y = .12 + floor * 3.6 + 1.2;
    for (const [a, b] of [[[1, 13.1], [67, 13.1]], [[57.1, 13.1], [57.1, 55]], [[circleU, 13.1], [circleU, 29]]]) {
      const from = at(...a), to = at(...b);
      assert.equal(cast(target, from, to, y, Math.hypot(to[0] - from[0], to[1] - from[1])).length, 0, 'Blue routes and the round-room doorway are open');
    }
    assert.ok(cast(target, at(circleU, 34), at(circleU + 8, 34), y, 8).length, 'The round outline is an enclosed wall, not an open void');
    assert.ok(cast(target, at(57.1, 35), at(60, 35), y, 4).length, 'The right passage retains its outside wall');
    for (const [u, v] of [[16, 15.5], [57.1, 35], [circleU, 20]]) {
      assert.ok(down(target, at(u, v), .12 + floor * 3.6 + .4).length, 'Every blue route has a continuous floor slab');
    }
  }
  assert.ok(geometry.getAttribute('position').count / 3 < 8000);
  assert.equal(JSON.stringify(building), snapshot);
  geometry.dispose();
});

test('only floors one through four retain the white projection; upper floors have a flat wall', () => {
  for (const floorHeight of [3.6, 4.2]) {
    const { at } = laboratoryLayout(building), info = buildingLevels(theatre, { floorHeight }), geometry = laboratoryBodyGeometry(building, floorHeight * 6, floorHeight), target = new THREE.Group();
    const bodies = info.sections.map(p => buildingGeometry(p, p.height, floorHeight, theatre.groundPassages, theatre.floorCorridors.filter(c => c.partId === p.id)));
    bodies.forEach(g => target.add(mesh(g, true))); target.updateMatrixWorld();
    for (let floor = 0; floor < 6; floor++) {
      const y = .12 + floor * floorHeight + 1.5;
      assert.equal(cast(target, at(1.5, 26), at(-1.5, 26), y, 3).length > 0, floor < 4);
      if (floor >= 4) assert.ok(cast(target, at(-2, 19), at(-2, 17), y, 2).length, 'The green straight wall replaces the removed outside projection');
    }
    const cut = laboratoryBodyGeometry(building, floorHeight * 3, floorHeight, true);
    cut.computeBoundingBox(); assert.ok(Math.abs(cut.boundingBox.max.z - floorHeight * 3) < 1e-4);
    geometry.dispose(); cut.dispose(); bodies.forEach(g => g.dispose());
  }
});

test('yellow edges have guards instead of solid walls or glazing, and the green stairwell connects the floors', () => {
  const info = buildingLevels(building), layout = laboratoryLayout(building);
  const configured = { ...building, floorCorridors: layout.corridors, stairwells: [layout.stair] };
  const rails = teachingRailGeometry(configured, info.sections, info.floorHeight), body = laboratoryBodyGeometry(building, info.height, info.floorHeight);
  for (let floor = 0; floor < 6; floor++) {
    const y = .12 + floor * info.floorHeight + .25 + 1.05;
    assert.ok(cast(mesh(rails), layout.at(22, 18), layout.at(22, 15), y, 3).length, 'The open side has a guard on every floor');
    assert.equal(cast(mesh(body, true), layout.at(22, 18), layout.at(22, 15), y, 3).length, 0, 'No wall blocks the view outside');
    assert.equal(cast(mesh(body, true), layout.at(layout.stairU, 11.5), layout.at(layout.stairU, 10.1), y, 2).length, 0, 'The staircase entrance is open');
  }
  const stairs = teachingStairGeometry(configured, info.sections, info.floorHeight), shaft = stairwellShaft(layout.stair);
  assert.ok(stairs.concrete.getAttribute('position').count > 0);
  const center = shaft.outer.slice(0, 4).reduce((s, p) => [s[0] + p[0] / 4, s[1] + p[1] / 4], [0, 0]);
  for (let floor = 1; floor < 6; floor++) assert.equal(down(mesh(body, true), center, .12 + floor * info.floorHeight + .4).length, 0, 'Floor slabs never plug the staircase shaft');
  assert.ok(rails.userData.photoOcclusionMask.every(n => n === 0));
  assert.deepEqual(polygonClipping.difference([layout.stair.opening.outer], [building.outer]), [], 'The staircase is wholly inside the building, with no projecting stair tower');
  assert.ok(Math.abs(layout.corridorWest - layout.circleU - layout.circleRadius - layout.roomWidth * 2) < 1e-6, 'Two complete stairwell widths separate the round room and the right corridor');
  for (let floor = 0; floor < 6; floor++) {
    const level = .12 + floor * info.floorHeight;
    for (const side of [-1, 1]) for (const v of [26.5, 28, 31, 33.5]) {
      const u = layout.circleU + side * (layout.circleRadius - .15);
      assert.ok(down(mesh(body,true),layout.at(u,v),level+.4).length, 'The full corridor width has a continuous floor where it meets the round building');
      assert.ok(cast(mesh(rails),layout.at(u,v),layout.at(u+side,v),level+.25+1.05,1).length, 'Both guards reach the round outside wall without an exposed gap');
    }
  }
  [rails, body, ...Object.values(stairs)].forEach(g => g.dispose());
});

test('the annotated front wall, recessed left staircase and right-hand wall returns follow the corrected plan', () => {
  const layout = laboratoryLayout(building), { at } = layout;
  assert.ok(Math.abs(layout.stairU + layout.roomWidth / 2 - 20.5) < .03, 'The staircase occupies the left recess next to the theatre, instead of the corridor centre');
  const body = laboratoryBodyGeometry(building, 21.6, 3.6), target = mesh(body, true);
  for (let floor = 0; floor < 6; floor++) {
    const y = .12 + floor * 3.6 + 1.5;
    assert.ok(cast(target, at(30, 13), at(30, 10.5), y, 3).length, 'The continuous black wall follows the marked long horizontal line');
    assert.equal(cast(target, at(34.25, 16), at(34.25, 13), y, 3).length, 0, 'The previous central stairwell is removed');
    assert.ok(cast(target, at(52, 18), at(52, 22), y, 4).length, 'The inside end of the left wall band turns back at the corridor');
    assert.ok(cast(target, at(60, 15.5), at(57, 15.5), y, 3).length, 'The right wall band has the annotated end return');
  }
  body.dispose();
});

test('the white connection is part of the theatre outline, with the recess road open only on the ground floor', () => {
  const wall = building.facade.connectionWall;
  assert.deepEqual(wall.at(-1), building.outer[11]);
  const direction = (a,b) => b.map((n,i) => n-a[i]);
  const cross = (a,b) => a[0]*b[1]-a[1]*b[0];
  const roadPoints = building.groundPassages[0].points;
  assert.equal(roadPoints.length, 3, 'The road stays straight from the street to the building corner, then turns once');
  const road = direction(...roadPoints.slice(1,3));
  const aligned = direction(wall[3],wall[4]), shortReturn = direction(wall[1],wall[2]), slanted = direction(wall[2],wall[3]);
  const originalNear = [74.64652398601775,-48.17907561518171], originalFar = [81.74414090559962,0.7871054238776232];
  assert.deepEqual(roadPoints.at(-1), originalFar, 'The original long road endpoint is retained');
  assert.ok(Math.abs(cross(direction(originalFar,originalNear),road))/(Math.hypot(...road)) < 1e-8, 'The entire long road retains its original straight direction without rotation');
  assert.ok(Math.abs(cross(road,aligned))/(Math.hypot(...road)*Math.hypot(...aligned)) < 1e-8, 'The rerouted road follows the side aligned with the dotted reference');
  assert.ok(Math.abs(cross(direction(wall[3],roadPoints[1]), aligned))/(Math.hypot(...aligned)) > 5, 'The fork clears the far building corner with a full-width road gap');
  const approach = campus.features.find(f => f.id === 'local/bridge-upper-approach');
  const stairs = campus.features.find(f => f.id === 'local/footbridge').connections.find(c => c.id === 'upper-road-stairs');
  assert.deepEqual(approach.points[0], stairs.points.at(-1), 'The green ground road joins the actual bridge staircase entrance');
  assert.deepEqual(approach.points.at(-1), roadPoints[1], 'The approach and both street branches share one junction');
  const origin = building.outer[11], axis = direction(building.outer[9], building.outer[8]), axisLength = Math.hypot(...axis);
  const reach = p => ((p[0]-origin[0])*axis[1]-(p[1]-origin[1])*axis[0])/axisLength;
  assert.ok(reach(roadPoints[1])-reach(wall[3]) > 9, 'The road continues straight beyond the building corner to the lower turn marked in green');
  assert.ok(Math.abs(cross(shortReturn,slanted)) > 1, 'The outside edge retains the marked short return before the slanted edge');
  const info = buildingLevels(theatre), connection = info.sections.find(p => p.id === 'laboratory-connection');
  assert.equal(connection.floors, 4);
  const main = info.sections.find(p => p.id === 'main');
  assert.deepEqual(polygonClipping.union(...info.sections.map(part => [part.outer, ...part.holes])), polygonClipping.union([theatre.outer, ...theatre.holes]));
  assert.ok(connection.outer.some(p => p[0] === wall[3][0] && p[1] === wall[3][1]));
  const { at } = laboratoryLayout(building), body = laboratoryBodyGeometry(building, 21.6, 3.6), target = mesh(body, true);
  const markedArea = { outer: [at(-14,22), at(-12,22), at(-12,23), at(-14,23), at(-14,22)], holes: [] };
  assert.deepEqual(polygonClipping.difference([markedArea.outer], [connection.outer, ...connection.holes]), [], 'The white hatched area is filled by the lower projection');
  const roadShape = passageShape(building.groundPassages[0]);
  assert.deepEqual(polygonClipping.intersection([roadShape.outer, ...roadShape.holes], [theatre.outer, ...theatre.holes]), [], 'The full road width stays clear of the projecting theatre building');
  const approachShape = passageShape(approach);
  assert.deepEqual(polygonClipping.intersection([approachShape.outer, ...approachShape.holes], [theatre.outer, ...theatre.holes]), [], 'The angled connection to the bridge also clears the projecting building');
  assert.deepEqual(campus.features.find(f => f.id === 'way/855459414').points, building.groundPassages[0].points);
  assert.equal(building.groundPassages[0].sourcePathId, 'way/855459414');
  for (let floor = 0; floor < 6; floor++) {
    const hits = cast(target, at(5.8, 13), at(5.8, 10.5), .12 + floor * 3.6 + 2.8, 3);
    assert.equal(hits.length > 0, floor > 0, 'The existing road crosses the recess beneath the retained upper-floor wall');
  }
  const labLevels = buildingLevels(building), layout = laboratoryLayout(building);
  const rails = teachingRailGeometry({ ...building, floorCorridors: layout.corridors }, labLevels.sections, labLevels.floorHeight), guard = mesh(rails);
  for (const rise of [.5, 1.05]) for (let floor = 0; floor < 6; floor++) {
    assert.equal(cast(guard, at(6, 18), at(6, 15), .12 + floor * 3.6 + .25 + rise, 3).length > 0, floor > 0, 'Ground-floor guards leave the road open while the upper guards remain');
  }
  assert.equal(down(target, at(5.8, .4), .6).length, 0, 'No raised floor slab blocks the road at the passage');
  const theatreBodies = info.sections.map(p => buildingGeometry(p, p.height, info.floorHeight, theatre.groundPassages, theatre.floorCorridors.filter(c => c.partId === p.id)));
  const theatreGroup = new THREE.Group(); theatreBodies.forEach(g => theatreGroup.add(mesh(g, true))); theatreGroup.updateMatrixWorld();
  for (let floor = 0; floor < 6; floor++) assert.equal(cast(theatreGroup, at(1.5, 26), at(-1.5, 26), .12 + floor * info.floorHeight + 1.5, 3).length > 0, floor < 4, 'The shared projection belongs to the lower theatre floors and is absent on floors five and six');
  const combined = new THREE.Group(); combined.add(target, theatreGroup); combined.updateMatrixWorld();
  for (let floor = 1; floor < 6; floor++) assert.ok(down(combined, at(.1,16), .12 + floor * 3.6 + .4).length, 'The corridor slab connects the laboratory and theatre on every upper floor');
  theatreBodies.forEach(g => g.dispose()); body.dispose(); rails.dispose();
});

test('the black stepped inner hall is identical on all six floors and connects directly to the laboratory', () => {
  const {at} = laboratoryLayout(building), info = buildingLevels(theatre);
  const bodies = info.sections.map(p => buildingGeometry(p, p.height, info.floorHeight, theatre.groundPassages, theatre.floorCorridors.filter(c => c.partId === p.id)));
  const lab = laboratoryBodyGeometry(building, 21.6, 3.6), group = new THREE.Group();
  [...bodies, lab].forEach(g => group.add(mesh(g,true))); group.updateMatrixWorld();
  for(let floor=0;floor<6;floor++) {
    const y = .12 + floor * 3.6 + 1.5;
    for(const [a,b] of [[[16,15.5],[-11,15.5]],[[-11,15.5],[-11,13.1]],[[-11,13.1],[-35,13.1]]]) {
      const from=at(...a), to=at(...b);
      assert.equal(cast(group,from,to,y,Math.hypot(to[0]-from[0],to[1]-from[1])).length,0,'The complete hallway remains open from the lab into the stepped black frame');
    }
    for(const [a,b] of [[[-25,13.1],[-25,9]],[[-25,13.1],[-25,17]],[[-36,13.1],[-39,13.1]],[[-10,15.5],[-10,18]]]) {
      const from=at(...a),to=at(...b);
      assert.ok(cast(group,from,to,y,Math.hypot(to[0]-from[0],to[1]-from[1])).length,'The black upper, end and stepped return walls exist on all six floors');
    }
    for(const p of [[-10,15.5],[-35,13.1]]) assert.ok(down(group,at(...p),.12+floor*3.6+.4).length,'The internal hall has a floor on every storey');
    if(floor>=4) {
      const hit=cast(group,at(-5,19),at(-5,17),y,2)[0];
      assert.ok(hit && hit.distance<1.5,'The upper outside wall follows the green line beyond the inner black return');
    }
  }
  [...bodies, lab].forEach(g=>g.dispose());
});

test('the glass canopy stays above the concrete roof and ends on the straight theatre seam', () => {
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus);
  const info = buildingLevels(building);
  assert.equal(building.skylights[0].outline, 'outer');
  const roofs = buildingSkylightGeometry(building, info.sections);
  assert.equal(roofs.length, 1); assert.equal(roofs[0].opacity, .24);
  const vertices = roofs[0].glass.getAttribute('position'), { at, seam } = laboratoryLayout(building);
  const origin = seam(0), edge = seam(1).map((n,i)=>n-origin[i]), inside = at(1,0);
  const side = p => edge[0]*(p[1]-origin[1])-edge[1]*(p[0]-origin[0]);
  const sign = Math.sign(side(inside));
  let seamVertices = 0;
  for (let i=0;i<vertices.count;i++) {
    const distance = side([vertices.getX(i),vertices.getZ(i)]) * sign;
    assert.ok(distance >= -2e-5, 'The glass never projects across the lab/theatre seam');
    if (Math.abs(distance)<2e-5) seamVertices++;
  }
  assert.ok(seamVertices >= 6, 'The trimmed edge lies exactly along the shared straight seam');
  roofs[0].glass.computeBoundingBox(); const bounds = roofs[0].glass.boundingBox;
  roofs[0].frame.computeBoundingBox();
  assert.ok(bounds.min.y > info.height + .12 && roofs[0].frame.boundingBox.min.y > info.height + .12, 'Both glass and its frame are above the concrete roof');
  assert.equal(roofs[0].glass.userData.photoOcclusionMask.length, vertices.count / 3);
  assert.equal(roofs[0].frame.userData.photoOcclusionMask.length, roofs[0].frame.index.count / 3);
  assert.equal(buildingSkylightGeometry(building, info.sections, info.floorHeight * 4).length, 0);
  assert.equal(buildingSkylightGeometry(building, info.sections, info.height).length, 0, 'Top-floor selection removes the canopy too');
  const lines = buildingFloorLineGeometry(building, info.sections, info.floorHeight);
  assert.ok(lines.getAttribute('position').count > 0);
  roofs.forEach(r => { r.glass.dispose(); r.frame.dispose(); }); lines.dispose();
});

test('the laboratory roof is closed and the marked corridor end is walled on every storey', () => {
  const {at,circleU,stairU}=laboratoryLayout(building), info=buildingLevels(building);
  const geometry=laboratoryBodyGeometry(building,info.height,info.floorHeight), target=mesh(geometry,true);
  const roofPoints=[[40,5],[40,12],[57.1,35],[circleU,34],[stairU,3]];
  for (const [u,v] of roofPoints) {
    const hit=down(target,at(u,v),info.height+.5)[0];
    assert.ok(hit && Math.abs(hit.point.y-info.height-.12)<1e-4,'Concrete closes rooms, halls, round enclosure and stairwell at the top');
  }
  for(let floor=0;floor<6;floor++) {
    const y=.12+floor*info.floorHeight+1.5;
    assert.ok(cast(target,at(57.1,58),at(57.1,55),y,3).length,'The exposed end of the three-metre passage is sealed');
    assert.equal(cast(target,at(57.1,18),at(57.1,55),y,37).length,0,'The passage inside remains connected');
    const cut=laboratoryBodyGeometry(building,(floor+1)*info.floorHeight,info.floorHeight,true), cutMesh=mesh(cut,true);
    for(const [u,v] of [[40,5],[40,12],[57.1,35],[circleU,34]]) {
      assert.equal(down(cutMesh,at(u,v),(floor+1)*info.floorHeight+.5).length,0,'Selected-floor views have no ceiling slab');
      assert.ok(down(cutMesh,at(u,v),floor*info.floorHeight+.5).length,'The selected storey keeps its floor');
    }
    cut.dispose();
  }
  geometry.dispose();
});

test('the laboratory passages retain three metres, the theatre long end is two metres, and the middle stays a full open hall', () => {
  const { at } = laboratoryLayout(building), info = buildingLevels(theatre);
  const lab = laboratoryBodyGeometry(building,21.6,3.6), bodies = info.sections.map(p => buildingGeometry(p,p.height,3.6,theatre.groundPassages,theatre.floorCorridors.filter(c => c.partId === p.id)));
  const group = new THREE.Group(); [lab,...bodies].forEach(g => group.add(mesh(g,true))); group.updateMatrixWorld();
  for (let floor=0;floor<6;floor++) {
    const y=.12+floor*3.6+1.5;
    for (const [from,to] of [[[62,13.1],[62,9]],[[62,13.1],[62,17]],[[57.1,35],[53,35]],[[57.1,35],[61,35]]]) {
      const hit=cast(group,at(...from),at(...to),y,5)[0];
      assert.ok(hit && Math.abs(hit.distance-1.5)<1e-4, 'Every corridor wall is exactly 1.5m from its centreline');
    }
    for(const v of [11,16]) {
      const hit=cast(group,at(-25,13.6),at(-25,v),y,3)[0];
      assert.ok(hit && Math.abs(hit.distance-1)<1e-4,'Only the marked theatre long end narrows to two metres');
    }
    for(const [a,b] of [[[-10,12],[-10,16.8]],[[1,15],[-11,15]]]) {
      const from=at(...a),to=at(...b);
      assert.equal(cast(group,from,to,y,Math.hypot(to[0]-from[0],to[1]-from[1])).length,0,'The theatre turning area and laboratory joint keep their previous width');
    }
    assert.equal(cast(group,at(40,4),at(40,11),y,7).length,0,'The frontage up to the annotated straight line is enclosed classroom interior');
    for(const [from,to] of [[[40,4],[40,2]],[[40,11],[40,12]]]) assert.ok(cast(group,at(...from),at(...to),y,2).length,'Both faces enclose the widened classroom');
    for(const [a,b] of [[[40,12],[40,20.8]],[[1,15],[-11,15]],[[-10,12],[-10,16.8]]]) { const from=at(...a),to=at(...b); assert.equal(cast(group,from,to,y,Math.hypot(to[0]-from[0],to[1]-from[1])).length,0,'The blue hatched middle retains its full width instead of being reduced to a 3m strip'); }
    for(const v of [4,7,11]) assert.ok(down(group,at(40,v),.12+floor*3.6+.4).length,'The complete classroom depth retains its floor');
  }
  [lab,...bodies].forEach(g=>g.dispose());
});

test('laboratory and theatre slabs share one aligned seam without overlapping selection volumes', () => {
  const {at,seam,walls}=laboratoryLayout(building), origin=at(0,0), unit=at(1,0).map((n,i)=>n-origin[i]);
  assert.deepEqual(polygonClipping.intersection(snapFootprint(walls.map(s=>[s.outer,...s.holes])), snapFootprint([[theatre.outer,...theatre.holes]])), [], 'No laboratory wall extends into the theatre footprint');
  const lab=laboratoryBodyGeometry(building,21.6,3.6), labMesh=mesh(lab,true), info=buildingLevels(theatre);
  const bodies=info.sections.map(p=>buildingGeometry(p,p.height,3.6,theatre.groundPassages,theatre.floorCorridors.filter(c=>c.partId===p.id)));
  const theatreGroup=new THREE.Group(); bodies.forEach(g=>theatreGroup.add(mesh(g,true))); theatreGroup.updateMatrixWorld();
  for(let floor=1;floor<6;floor++) for(const v of [11.75,12,13.5,14.7,16.85]) for(const side of [-1,1]) {
    const point=seam(v).map((n,i)=>n+unit[i]*side*.02), y=.12+floor*3.6+.4;
    assert.equal(down(labMesh,point,y).length>0,side>0,'Only the laboratory owns the laboratory side of the joint');
    assert.equal(down(theatreGroup,point,y).length>0,side<0,'Only the theatre owns the theatre side, and neither side has a floor gap');
  }
  for(let floor=0;floor<4;floor++) assert.equal(cast(labMesh,at(1.5,26),at(-1.5,26),.12+floor*3.6+1.5,3).length,0,'The lab no longer duplicates the theatre projection walls');
  [lab,...bodies].forEach(g=>g.dispose());
});

test('the marked walls and left guards move forward together while classrooms and the asymmetric hall retain continuous floors', () => {
  const layout=laboratoryLayout(building), {at,seam,circleU,circleRadius}=layout, info=buildingLevels(building);
  assert.deepEqual(layout.corridors[0].railEdges[0], [seam(17),at(circleU-circleRadius,17),at(circleU-circleRadius,34)], 'The complete right-hand guard stays in its original position');
  const body=laboratoryBodyGeometry(building,info.height,info.floorHeight), target=mesh(body,true);
  const rails=teachingRailGeometry({...building,floorCorridors:layout.corridors},info.sections,info.floorHeight), guard=mesh(rails);
  const branchRight=circleU+circleRadius;
  for(let floor=0;floor<6;floor++) {
    const level=.12+floor*info.floorHeight, eye=level+1.5;
    assert.equal(cast(target,at(40,7),at(40,11),eye,4).length,0,'The previous classroom partition no longer cuts through the enlarged interior');
    const wall=cast(target,at(40,12.5),at(40,10.5),eye,2)[0];
    assert.ok(wall && Math.abs(wall.distance-.9)<1e-4,'The replacement inner wall stands four metres farther forward');
    for(const v of [8,10,11]) assert.ok(down(target,at(40,v),level+.4).length,'The added classroom depth keeps a solid floor');
    for(const u of [branchRight-.02,branchRight+.02]) for(const v of [17.1,19,20.9]) assert.ok(down(target,at(u,v),level+.4).length,'The shifted left side and fixed right side meet without a floor crack');
    assert.equal(cast(guard,at(45,18),at(45,16),level+.25+1.05,2).length,0,'The former left guard does not remain across the expanded hall');
    assert.ok(cast(guard,at(45,22),at(45,20),level+.25+1.05,2).length,'The left guard follows the shifted front edge');
    assert.ok(cast(guard,at(22,18),at(22,16),level+.25+1.05,2).length,'The right guard stays on the fixed front edge');
  }
  body.dispose(); rails.dispose();
});

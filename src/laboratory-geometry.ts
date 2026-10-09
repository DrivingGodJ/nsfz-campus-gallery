import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingGeometry, passageShape, snapFootprint } from './building-geometry.ts';
import { passageFootprint } from './underground-geometry.ts';
import { stairwellShaft } from './teaching-stairs.ts';
import { classroomWindowLayout } from './teaching-classrooms.ts';
import type { Building, BuildingStairwell, FloorCorridor, GroundPassage, Point, Shape } from './types';

const WALL = .28, SLAB = .25;
const polygon = (shape: Shape): polygonClipping.Polygon => [shape.outer, ...shape.holes];

// The imported outline describes the glass canopy, not a solid six-storey block.
// Keep one calibrated frame for the walls, corridor slabs, guards and stairs.
export function laboratoryLayout(building: Building) {
  const origin = building.outer[11], a = building.outer[9], b = building.outer[8];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const along: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const inward: Point = [along[1], -along[0]];
  const at = (u: number, v: number): Point => [origin[0] + along[0] * u + inward[0] * v, origin[1] + along[1] * u + inward[1] * v];
  const shape = (points: Point[]): Shape => { const outer = points.map(p => at(...p)); return { outer: [...outer, outer[0]], holes: [] }; };
  const rectangle = (u0: number, v0: number, u1: number, v1: number) => shape([[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
  const ring = (room: Shape): Shape => {
    const inside = room.outer.slice(0, -1);
    const side = Math.sign(room.outer.slice(1).reduce((sum, p, i) => sum + room.outer[i][0] * p[1] - p[0] * room.outer[i][1], 0));
    // Use the perimeter winding so wall returns also retain the correct inside.
    const edgeStrips = inside.map((from, i) => {
      const to = inside[(i + 1) % inside.length], dx = to[0] - from[0], dz = to[1] - from[1], size = Math.hypot(dx, dz);
      const offset: Point = [-dz / size * WALL * side, dx / size * WALL * side];
      return [[from, to, [to[0] + offset[0], to[1] + offset[1]], [from[0] + offset[0], from[1] + offset[1]], from]] as polygonClipping.Polygon;
    });
    const inner = polygonClipping.difference(snapFootprint([polygon(room)]), ...snapFootprint(edgeStrips));
    return { outer: room.outer, holes: inner.map(p => p[0] as Point[]) };
  };
  const stairWidth = 3.8, roomWidth = stairWidth + WALL * 2;
  const corridorWest = 49.6;
  // Three metres applies to the two narrow ends and side passage. The
  // central blue area is the full shared hall, not a uniform three-metre strip.
  // Move the marked inner walls into the hall, retaining the classroom's back
  // edge and the right-hand guards while its usable depth increases.
  const forward = 4, corridorWidth = 3, corridorFront = 7.6 + forward, endReturn = corridorFront + corridorWidth;
  const leftFront = 17 + forward;
  const sideLeft = 57.1 - corridorWidth / 2, sideRight = sideLeft + corridorWidth;
  const circleRadius = 7.2, circleU = corridorWest - roomWidth * 2 - circleRadius;
  const circle = shape(Array.from({ length: 24 }, (_, i): Point => [circleU + Math.cos(i * Math.PI / 12) * circleRadius, 34 + Math.sin(i * Math.PI / 12) * circleRadius]));
  const corner = building.facade?.connectionWall?.at(-2) || building.outer[1], reach = (corner[0] - origin[0]) * inward[0] + (corner[1] - origin[1]) * inward[1];
  const seam = (v: number): Point => origin.map((n, i) => n + (corner[i] - n) * v / reach) as Point;
  const classrooms: Shape = { outer: [origin, building.outer[10], building.outer[9], building.outer[8], at(68.85, corridorFront), seam(corridorFront), origin], holes: [] };
  const rooms = [circle, rectangle(corridorWest, leftFront, sideLeft, 56.6), shape([[sideRight,endReturn],[68.85,endReturn],[68.85,14 + forward],[65,14 + forward],[65,56.6],[sideRight,56.6]]), classrooms];
  const stairU = 20.48 - roomWidth / 2;
  const stair: BuildingStairwell = {
    partId: 'main', origin: at(stairU, 6.12 + forward), axis: [-inward[0], -inward[1]], width: stairWidth, run: 3.2, landingDepth: .8, stepsPerFlight: 11, firstFlight: 'left',
    opening: rectangle(stairU - roomWidth / 2, WALL + forward, stairU + roomWidth / 2, corridorFront),
  };
  const branchLeft = circleU - circleRadius, branchRight = circleU + circleRadius;
  const connectionEdge = seam(17);
  const walkways: Shape[] = [
    { outer: [seam(corridorFront), at(68.85,corridorFront), at(68.85,endReturn), at(sideRight,endReturn), at(sideRight,leftFront), at(branchRight,leftFront), at(branchRight,17), connectionEdge, seam(corridorFront)], holes: [] },
    rectangle(branchLeft, 17, branchRight, 34), rectangle(sideLeft, leftFront, sideRight, 56.6),
  ];
  // Keep the classroom band and full central hall on their marked sides of
  // the long straight wall. The theatre owns its outside walls and projection.
  const walls = [...rooms.slice(0, -1).map(ring), ...polygonClipping.difference(snapFootprint([polygon(classrooms)]), snapFootprint([polygon(stair.opening)]))
    .map(([outer, ...holes]) => ring({ outer: outer as Point[], holes: holes as Point[][] })), ring(stair.opening)];
  walls.push(rectangle(sideLeft, 56.6 - WALL, sideRight, 56.6));
  const doors: GroundPassage[] = [
    { id: 'lab-round-room', sourcePathId: '', points: [at(circleU, 25.8), at(circleU, 28)], width: 2.4 },
    { id: 'lab-stairwell', sourcePathId: '', points: [at(stairU, corridorFront - .3), at(stairU, corridorFront + 1)], width: 3.5 },
  ];
  const railEdges = [
    [connectionEdge, at(branchLeft, 17), at(branchLeft, 34)],
    [at(branchRight, 34), at(branchRight, leftFront), at(corridorWest, leftFront)],
  ];
  const corridors: FloorCorridor[] = [{ partId: 'main', depth: corridorWidth, startFloor: 1, points: [seam(12 + forward), at(57.1,12 + forward)], railEdges }];
  return { at, seam, rooms, walls, walkways, stair, stairU, doors, corridors, circleU, circleRadius, corridorWest, roomWidth };
}

export function laboratoryBodyGeometry(building: Building, height: number, floorHeight: number, cutaway = false) {
  const parts: THREE.BufferGeometry[] = [], masks: number[] = [];
  const layout = laboratoryLayout(building);
  const wallPolygons = snapFootprint(layout.walls.map(polygon));
  const walls = polygonClipping.union(wallPolygons[0], ...wallPolygons.slice(1));
  const platePolygons = snapFootprint([...layout.rooms, ...layout.walkways, layout.stair.opening].map(polygon));
  const floorPlate = polygonClipping.union(platePolygons[0], ...platePolygons.slice(1));
  const glazing = laboratoryWindows(building, height, floorHeight);
  const add = (shape: Shape, bottom: number, top: number, photoBlocking: boolean, doors: GroundPassage[] = []) => {
    if (top <= bottom) return;
    const geometry = buildingGeometry(shape, top - bottom, floorHeight, doors);
    geometry.translate(0, 0, bottom);
    masks.push(...Array(geometry.getAttribute('position').count / 3).fill(Number(photoBlocking)));
    geometry.deleteAttribute('uv'); parts.push(geometry);
  };
  for (let floor = 0; floor * floorHeight < height; floor++) {
    const bottom = floor * floorHeight, top = Math.min(bottom + floorHeight, height);
    const groundPassages = floor === 0 ? building.groundPassages || [] : [];
    const openings = floor === 0 ? snapFootprint((building.groundFloorOpenings || []).map(polygon)) : [];
    const levels = [...new Set([bottom + SLAB, top, Math.min(bottom + 2.65, top), ...glazing.filter(window => window.bottom >= bottom && window.bottom < top).flatMap(window => [window.bottom, window.top])])].sort((a, b) => a - b);
    for (let i = 0; i < levels.length - 1; i++) {
      const low = levels[i], high = levels[i + 1], middle = (low + high) / 2;
      let layer = openings.length && middle < bottom + 2.65 ? polygonClipping.difference(walls, openings) : walls;
      const cuts = glazing.filter(window => middle > window.bottom && middle < window.top).map(window => window.cut);
      if (cuts.length) layer = polygonClipping.difference(layer, ...snapFootprint(cuts));
      for (const [outer, ...holes] of layer) add({ outer: outer as Point[], holes: holes as Point[][] }, low, high, true, middle < bottom + 2.65 ? [...layout.doors, ...groundPassages] : groundPassages);
    }
    let plates = floorPlate;
    if (floor) plates = polygonClipping.difference(plates, snapFootprint([polygon(stairwellShaft(layout.stair))]));
    if (groundPassages.length) plates = polygonClipping.difference(plates, snapFootprint(groundPassages.map(p => polygon(passageShape(p)))));
    if (openings.length) plates = polygonClipping.difference(plates, openings);
    for (const [outer, ...holes] of plates) add({ outer: outer as Point[], holes: holes as Point[][] }, bottom, Math.min(bottom + SLAB, top), false);
  }
  // The concrete roof follows the occupied building, below the larger glass canopy.
  if (!cutaway) for (const [outer, ...holes] of floorPlate) {
    add({ outer: outer as Point[], holes: holes as Point[][] }, Math.max(0, height - SLAB), height, true);
  }
  const geometry = mergeGeometries(parts) || new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose());
  geometry.userData.photoOcclusionMask = new Uint8Array(masks);
  return geometry;
}

// The approved lab plan has real classroom strips, not the glass canopy's
// outline. Cut only those strips; keep the circular wall and theatre seam solid.
export function laboratoryWindows(building: Building, height: number, floorHeight: number) {
  if (!building.classroomWindows) return [];
  const layout = laboratoryLayout(building), classrooms = layout.rooms.at(-1)!;
  const seam = passageFootprint([classrooms.outer[0], classrooms.outer.at(-2)!], .7);
  const groundOpenings = [...(building.groundPassages || []).map(passageShape), ...(building.groundFloorOpenings || [])].map(polygon);
  const classroomsWindows = classroomWindowLayout(snapFootprint(layout.rooms.slice(1).map(polygon)), building.classroomWindows, height, floorHeight, groundOpenings, [polygon(seam), polygon(layout.stair.opening)]);
  // _DSC8919 confirms the sixth-floor stair's rear window. The explicit wall
  // allowlist, not the stair opening or an unlabelled exterior photo, controls
  // whether this separate enclosure gets glazing.
  const stairWindows = building.classroomWindows.facadeLines
    ? classroomWindowLayout(snapFootprint([polygon(layout.stair.opening)]), building.classroomWindows, height, floorHeight)
    : [];
  for (const window of stairWindows) {
    // The stair enclosure meets the surrounding classroom shell back-to-back.
    // Pierce both wall leaves without moving the observed frame or glazing.
    const ring = window.cut[0], dx = ring[3][0] - ring[0][0], dz = ring[3][1] - ring[0][1], length = Math.hypot(dx, dz);
    const out = (point: Point): Point => [point[0] - dx / length * WALL, point[1] - dz / length * WALL];
    window.cut = [[out(ring[0] as Point), out(ring[1] as Point), ring[2], ring[3], out(ring[0] as Point)]];
  }
  return [...classroomsWindows, ...stairWindows];
}

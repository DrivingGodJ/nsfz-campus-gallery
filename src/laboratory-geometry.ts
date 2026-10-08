import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingGeometry, passageShape } from './building-geometry.ts';
import { passageFootprint } from './underground-geometry.ts';
import { stairwellShaft } from './teaching-stairs.ts';
import type { Building, BuildingStairwell, FloorCorridor, GroundPassage, Point, Shape } from './types';

const WALL = .28, SLAB = .25;
const polygon = (shape: Shape): polygonClipping.Polygon => [shape.outer, ...shape.holes];

// The imported outline describes the glass canopy, not a solid six-storey block.
// Keep one calibrated frame for the walls, corridor slabs, guards and stairs.
export function laboratoryLayout(building: Building, upper = false) {
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
    const inner = polygonClipping.difference(polygon(room), ...inside.map((from, i) => {
      const to = inside[(i + 1) % inside.length], dx = to[0] - from[0], dz = to[1] - from[1], size = Math.hypot(dx, dz);
      const offset: Point = [-dz / size * WALL * side, dx / size * WALL * side];
      return [[from, to, [to[0] + offset[0], to[1] + offset[1]], [from[0] + offset[0], from[1] + offset[1]], from]] as polygonClipping.Polygon;
    }));
    return { outer: room.outer, holes: inner.map(p => p[0] as Point[]) };
  };
  const stairWidth = 3.8, roomWidth = stairWidth + WALL * 2;
  const corridorWest = 49.6;
  const circleRadius = 7.2, circleU = corridorWest - roomWidth * 2 - circleRadius;
  const circle = shape(Array.from({ length: 24 }, (_, i): Point => [circleU + Math.cos(i * Math.PI / 12) * circleRadius, 34 + Math.sin(i * Math.PI / 12) * circleRadius]));
  const rooms = [circle, rectangle(49.6, 17, 54.8, 56.6), shape([[59.4, 11.8], [68.85, 11.8], [68.85, 14], [65, 14], [65, 56.6], [59.4, 56.6]])];
  const stairU = 20.48 - roomWidth / 2;
  const stair: BuildingStairwell = {
    partId: 'main', origin: at(stairU, 6.12), axis: [-inward[0], -inward[1]], width: stairWidth, run: 3.2, landingDepth: .8, stepsPerFlight: 11,
    opening: rectangle(stairU - roomWidth / 2, WALL, stairU + roomWidth / 2, 6.4),
  };
  const branchLeft = circleU - circleRadius, branchRight = circleU + circleRadius;
  const walkways: Shape[] = [
    { outer: [at(0, 17), building.outer[11], building.outer[10], building.outer[9], building.outer[8], building.outer[7], at(65, 14), at(59.4, 17), at(0, 17)], holes: [] },
    rectangle(branchLeft, 17, branchRight, 34), rectangle(54.8, 17, 59.4, 56.6),
  ];
  const walls = [...rooms.map(ring), ring(stair.opening)];
  walls.push(passageFootprint([at(0, 6.4), at(68.85, 6.4)], WALL));
  walls.push(rectangle(68.85 - WALL, 3.2, 68.85, 11.8));
  const joint = building.facade?.connectionWall;
  if (joint?.length) walls.push(passageFootprint(upper ? [joint[0], joint.at(-1)!] : joint, WALL));
  const doors: GroundPassage[] = [
    { id: 'lab-round-room', sourcePathId: '', points: [at(circleU, 25.8), at(circleU, 28)], width: 2.4 },
    { id: 'lab-stairwell', sourcePathId: '', points: [at(stairU, 6.1), at(stairU, 7.5)], width: 3.5 },
  ];
  const railEdges = [
    [[0, 17], [branchLeft, 17], [branchLeft, 34]],
    [[branchRight, 34], [branchRight, 17], [49.6, 17]],
  ].map(edge => edge.map(p => at(...p as Point)));
  const corridors: FloorCorridor[] = [{ partId: 'main', depth: 3, startFloor: 1, points: [at(0, 10.2), at(68.85, 10.2)], railEdges }];
  return { at, rooms, walls, walkways, stair, stairU, doors, corridors, circleU, circleRadius, corridorWest, roomWidth };
}

export function laboratoryBodyGeometry(building: Building, height: number, floorHeight: number) {
  const parts: THREE.BufferGeometry[] = [], masks: number[] = [];
  const add = (shape: Shape, bottom: number, top: number, photoBlocking: boolean, doors: GroundPassage[] = []) => {
    if (top <= bottom) return;
    const geometry = buildingGeometry(shape, top - bottom, floorHeight, doors);
    geometry.translate(0, 0, bottom);
    masks.push(...Array(geometry.getAttribute('position').count / 3).fill(Number(photoBlocking)));
    geometry.deleteAttribute('uv'); parts.push(geometry);
  };
  for (let floor = 0; floor * floorHeight < height; floor++) {
    const bottom = floor * floorHeight, top = Math.min(bottom + floorHeight, height);
    const layout = laboratoryLayout(building, floor >= 4);
    const groundPassages = floor === 0 ? building.groundPassages || [] : [];
    const walls = polygonClipping.union(polygon(layout.walls[0]), ...layout.walls.slice(1).map(polygon));
    for (const [outer, ...holes] of walls) {
      const shape = { outer: outer as Point[], holes: holes as Point[][] };
      const doorTop = Math.min(bottom + 2.65, top);
      add(shape, bottom + SLAB, doorTop, true, [...layout.doors, ...groundPassages]);
      add(shape, doorTop, top, true, groundPassages);
    }
    let plates = polygonClipping.union(polygon(layout.rooms[0]), ...[...layout.rooms.slice(1), ...layout.walkways, layout.stair.opening].map(polygon));
    if (floor) plates = polygonClipping.difference(plates, polygon(stairwellShaft(layout.stair)));
    if (groundPassages.length) plates = polygonClipping.difference(plates, ...groundPassages.map(p => polygon(passageShape(p))));
    for (const [outer, ...holes] of plates) add({ outer: outer as Point[], holes: holes as Point[][] }, bottom, Math.min(bottom + SLAB, top), false);
  }
  const geometry = mergeGeometries(parts) || new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose());
  geometry.userData.photoOcclusionMask = new Uint8Array(masks);
  return geometry;
}

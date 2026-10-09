import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { architectureBatch as batch } from './architecture-geometry.ts';
import { buildingCoreFootprint, passageShape } from './building-geometry.ts';
import { classroomWallFootprint } from './teaching-classrooms.ts';
import type { Building, BuildingPart, Point } from './types';

type Section = BuildingPart & { height: number; floors: number };
const BASE = .12;
// The four furnished bays are photo-confirmed. Row counts and room orientation
// are estimates; no partitions, corridor or saved photograph positions change.
export const CLASSROOM_BAYS = [
  { id: 'main-west-3', partId: 'main', floor: 3, photoIds: ['5e41f64f-b5b3-4a25-8a29-4f13090d3d87'], u: 85.7, front: 67.05, columns: 5, rows: 5, board: true },
  { id: 'wing-east-3', partId: 'sixth-floor-wing', floor: 3, photoIds: ['770e2faf-3af0-4a3a-97e3-bafd7ea4b394'], u: 75.1, front: 67.05, columns: 4, rows: 5, board: true },
  { id: 'main-north-5', partId: 'main', floor: 5, photoIds: ['abc45dda-6054-4aa4-8e19-9f3508dde2fa'], u: 106.1, front: 50.55, columns: 4, rows: 5, board: false },
  { id: 'main-east-1', partId: 'main', floor: 1, photoIds: ['95bda1d8-b158-4526-b225-c9ff0b651ce4'], u: 134.8, front: 67.6, columns: 5, rows: 5, board: false },
];
// Reuse the long teaching-wing axis. The +v axis points behind the desks and
// produces an orthogonal, outward-facing basis (no reflected triangle winding).
const along: Point = [.9868974432552757, -.16134880382636804];
const across: Point = [-along[1], along[0]];
export const classroomAt = (u: number, v: number): Point => [along[0] * u + across[0] * v, along[1] * u + across[1] * v];

export function teachingClassroomInterior(building: Building, section: Section, floor: number) {
  const core = buildingCoreFootprint(section, building.groundPassages || [],
    (building.floorCorridors || []).filter(item => item.partId === section.id),
    (building.stairwells || []).filter(item => item.partId === section.id),
    (building.solidCores || []).filter(item => item.partId === section.id),
    (building.cutouts || []).filter(item => item.partId === section.id));
  const walls = classroomWallFootprint(core, (building.classroomWindows?.wallThickness ?? .28) + .12);
  let inside = walls.length ? polygonClipping.difference(core, walls) : core;
  if (floor === 1) for (const passage of building.groundPassages || []) {
    const opening = passageShape(passage); inside = polygonClipping.difference(inside, [opening.outer, ...opening.holes]);
  }
  return inside;
}

function footprint(u: number, v: number, width: number, depth: number) {
  const ring = [classroomAt(u - width / 2, v - depth / 2), classroomAt(u + width / 2, v - depth / 2), classroomAt(u + width / 2, v + depth / 2), classroomAt(u - width / 2, v + depth / 2)];
  return [[...ring, ring[0]]];
}
function contained(inside: polygonClipping.MultiPolygon, u: number, v: number, width: number, depth: number) {
  return !polygonClipping.difference(footprint(u, v, width, depth), inside).length;
}

// DSC08919/08920/DSC8213 show light timber tops, chair backs and slim dark
// tubular supports. DSC8621 confirms a wall cabinet; its precise bay is estimated.
export function teachingClassroomFurniture(building: Building, sections: Section[], floorHeight: number, cutawayHeight?: number) {
  const wood: THREE.BufferGeometry[] = [], metal: THREE.BufferGeometry[] = [], boards: THREE.BufferGeometry[] = [], storage: THREE.BufferGeometry[] = [];
  for (const bay of CLASSROOM_BAYS) {
    const section = sections.find(item => item.id === bay.partId);
    if (!section || bay.floor > section.floors) continue;
    const floor = (bay.floor - 1) * floorHeight + Math.min(.25, floorHeight * .1), shown = Math.min(section.height, cutawayHeight ?? Infinity);
    if (shown <= floor) continue;
    const inside = teachingClassroomInterior(building, section, bay.floor);
    const box = (parts: THREE.BufferGeometry[], u: number, v: number, bottom: number, top: number, width: number, depth: number, footprintVerified = false) => {
      top = Math.min(top, shown - floor);
      if (top <= bottom || !footprintVerified && !contained(inside, u, v, width, depth)) return;
      const p = classroomAt(u, v), geometry = new THREE.BoxGeometry(width, top - bottom, depth);
      geometry.rotateY(-Math.atan2(along[1], along[0])); geometry.translate(p[0], BASE + floor + (bottom + top) / 2, p[1]); parts.push(geometry);
    };
    for (let row = 0; row < bay.rows; row++) for (let column = 0; column < bay.columns; column++) {
      const u = bay.u + (column - (bay.columns - 1) / 2) * 1.45, v = bay.front + 1.55 + row * 1.12;
      if (!contained(inside, u, v + .23, .82, 1.25)) continue;
      // All desk/chair parts fit this verified assembly rectangle. Avoid a
      // polygon boolean for every tiny leg when changing a floor cutaway.
      const item = (parts: THREE.BufferGeometry[], x: number, z: number, bottom: number, top: number, width: number, depth: number) => box(parts, x, z, bottom, top, width, depth, true);
      item(wood, u, v, .74, .80, .72, .50);
      item(wood, u, v, .56, .59, .62, .40);
      for (const side of [-1, 1]) {
        item(metal, u + side * .29, v, .045, .74, .035, .035);
        item(metal, u + side * .29, v, 0, .06, .04, .48);
      }
      const chair = v + .56;
      item(wood, u, chair, .43, .49, .45, .42);
      item(wood, u, chair + .17, .53, .88, .45, .055);
      for (const side of [-1, 1]) {
        item(metal, u + side * .19, chair + .12, .045, .86, .026, .026);
        item(metal, u + side * .19, chair, 0, .05, .028, .39);
      }
    }
    if (bay.board) {
      box(boards, bay.u, bay.front, .9, 2.35, 4.1, .055);
      box(wood, bay.u, bay.front, .86, .90, 4.25, .11);
      // Movable support is estimated: the current model does not subdivide each
      // room, so a wall-mounted board here would float or cover a real window.
      for (const side of [-1, 1]) {
        box(metal, bay.u + side * 2.08, bay.front, 0, 2.39, .035, .08);
        box(metal, bay.u + side * 2.08, bay.front + .2, 0, .06, .11, .44);
      }
      // A modest teacher's table leaves a generous front aisle before row one.
      box(wood, bay.u, bay.front + .65, .74, .82, 1.4, .58);
      box(wood, bay.u, bay.front + .65, 0, .74, 1.28, .49);
    } else if (bay.floor === 5) {
      box(storage, bay.u - 3.45, bay.front + .9, 0, 1.65, .75, .38);
      for (const side of [-1, 1]) box(metal, bay.u - 3.45 + side * .18, bay.front + .705, .3, 1.4, .02, .02);
    }
  }
  return { wood: batch(wood, false), metal: batch(metal, false), boards: batch(boards, false), storage: batch(storage, false) };
}

import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import { passageShape, snapFootprint } from './building-geometry.ts';
import type { Building, Point } from './types';

export const LAB_REAR_COLORS = { stone: '#747c72', brick: '#ac6245', metal: '#28312d', glass: '#253b3b', frames: '#303835', joints: '#60665b' };
type Kind = keyof typeof LAB_REAR_COLORS;
const BASE = .12, WALL = .28, ARCH_STEPS = 24;
export type LaboratoryRearOpening = { face: number; center: number; width: number; bottom: number; top: number; spring?: number; cut: polygonClipping.Polygon };

// The reference photographs show the stepped north elevation facing the office,
// not the canopy, circular enclosure, classroom front, or the stair's shared bay.
export function laboratoryRearLayout(building: Building) {
  return [[11, 10], [9, 8]].map(([a, b], face) => {
    const from = building.outer[a], to = building.outer[b], length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const axis: Point = [(to[0] - from[0]) / length, (to[1] - from[1]) / length], outside: Point = [-axis[1], axis[0]];
    const at = (station: number, depth = 0): Point => [from[0] + axis[0] * station + outside[0] * depth, from[1] + axis[1] * station + outside[1] * depth];
    // Keep the separately calibrated six-floor stair enclosure and its confirmed
    // sixth-floor window exactly as they were before the new rear photo.
    const start = face === 1 ? 3.8 + WALL * 2 : 0;
    const count = Math.max(1, Math.round((length - start) / 4.9)), bay = (length - start) / count;
    return { from, to, axis, outside, length, start, count, bay, at };
  });
}

export function laboratoryRearOpenings(building: Building, height: number, floorHeight: number): LaboratoryRearOpening[] {
  const openings: LaboratoryRearOpening[] = [], faces = laboratoryRearLayout(building);
  const ground = snapFootprint([...(building.groundPassages || []).map(passageShape), ...(building.groundFloorOpenings || [])].map(shape => [shape.outer, ...shape.holes]));
  for (const [face, layout] of faces.entries()) for (let bay = 0; bay < layout.count; bay++) for (let floor = 0; floor < 6 && floor * floorHeight < height; floor++) {
    const center = layout.start + (bay + .5) * layout.bay, width = Math.min(floor ? 2.7 : 2.2, layout.bay - 1.2);
    const bottom = floor * floorHeight + .85, spring = Math.min(2.1, floorHeight - width / 2 - .4);
    const top = Math.min(floor * floorHeight + (floor ? floorHeight - .65 : spring + width / 2), height - .25);
    if (top <= bottom) continue;
    const a = layout.at(center - width / 2, .04), b = layout.at(center + width / 2, .04);
    const c = layout.at(center + width / 2, -WALL - .04), d = layout.at(center - width / 2, -WALL - .04);
    const cut = [[a, b, c, d, a]];
    if (!floor && ground.length && polygonClipping.intersection([cut], ground).length) continue;
    openings.push({ face, center, width, bottom, top, ...(!floor ? { spring } : {}), cut });
  }
  return openings;
}

// Each arch shares one explicit profile with the glazing and brick surround.
// Narrow horizontal wall slices retain real openings in the existing batched
// shell; the continuous outside arch masks their sub-15 cm approximation.
export function laboratoryRearOpeningLevels(openings: LaboratoryRearOpening[]) {
  return openings.flatMap(opening => [opening.bottom, opening.top, ...(opening.spring === undefined ? [] : Array.from({ length: ARCH_STEPS + 1 }, (_, i) => opening.spring! + opening.width / 2 * Math.sin(i * Math.PI / (2 * ARCH_STEPS))).filter(y => y > opening.bottom && y < opening.top))]);
}

export function laboratoryRearCutsAt(building: Building, openings: LaboratoryRearOpening[], height: number): polygonClipping.Polygon[] {
  const faces = laboratoryRearLayout(building);
  return openings.filter(opening => height > opening.bottom && height < opening.top).map(opening => {
    if (opening.spring === undefined || height <= opening.spring) return opening.cut;
    const half = Math.sqrt(Math.max(0, (opening.width / 2) ** 2 - (height - opening.spring) ** 2));
    const face = faces[opening.face], a = face.at(opening.center - half, .04), b = face.at(opening.center + half, .04);
    const c = face.at(opening.center + half, -WALL - .04), d = face.at(opening.center - half, -WALL - .04);
    return [[a, b, c, d, a]];
  });
}

function openingProfile(opening: LaboratoryRearOpening, margin = 0) {
  const half = opening.width / 2 + margin, bottom = opening.bottom - margin;
  if (opening.spring === undefined) return [new THREE.Vector2(opening.center - half, bottom), new THREE.Vector2(opening.center + half, bottom), new THREE.Vector2(opening.center + half, opening.top + margin), new THREE.Vector2(opening.center - half, opening.top + margin)];
  return [new THREE.Vector2(opening.center - half, bottom), new THREE.Vector2(opening.center + half, bottom), ...Array.from({ length: ARCH_STEPS * 2 + 1 }, (_, i) => {
    const angle = i * Math.PI / (ARCH_STEPS * 2);
    return new THREE.Vector2(opening.center + half * Math.cos(angle), Math.min(opening.top + margin, opening.spring! + half * Math.sin(angle)));
  })];
}

function rearGroundCuts(building: Building, face: ReturnType<typeof laboratoryRearLayout>[number]) {
  const a = face.at(0, .04), b = face.at(face.length, .04), c = face.at(face.length, -WALL - .04), d = face.at(0, -WALL - .04);
  return [...(building.groundPassages || []).map(passageShape), ...(building.groundFloorOpenings || [])].flatMap(shape => {
    const intersect = polygonClipping.intersection([[a, b, c, d, a]], [shape.outer, ...shape.holes]);
    if (!intersect.length) return [];
    const stations = intersect.flat(2).map(point => (point[0] - face.from[0]) * face.axis[0] + (point[1] - face.from[1]) * face.axis[1]);
    const first = Math.min(...stations), last = Math.max(...stations);
    return [[[[first, 0], [last, 0], [last, 2.65], [first, 2.65], [first, 0]]]] as polygonClipping.MultiPolygon;
  });
}

export function laboratoryRearFacadeGeometry(building: Building, height: number, floorHeight: number, cutawayHeight?: number) {
  const shown = Math.min(height, cutawayHeight ?? Infinity), faces = laboratoryRearLayout(building), openings = laboratoryRearOpenings(building, shown, floorHeight);
  const parts: Record<Kind, THREE.BufferGeometry[]> = { stone: [], brick: [], metal: [], glass: [], frames: [], joints: [] };
  for (const [faceIndex, face] of faces.entries()) {
    const groundCuts = rearGroundCuts(building, face);
    const transform = (depth: number) => new THREE.Matrix4().set(face.axis[0], 0, face.outside[0], face.from[0] + face.outside[0] * depth, 0, 1, 0, BASE, face.axis[1], 0, face.outside[1], face.from[1] + face.outside[1] * depth, 0, 0, 0, 1);
    const surface = (outer: polygonClipping.Ring, holes: polygonClipping.Ring[] = []) => {
      const shape = new THREE.Shape(outer.map(p => new THREE.Vector2(...p)));
      shape.holes.push(...holes.map(ring => new THREE.Path(ring.map(p => new THREE.Vector2(...p))))); return shape;
    };
    const rect = (kind: Kind, a: number, b: number, low: number, high: number, depth = .055, offset = .06) => {
      high = Math.min(high, shown); low = Math.max(low, 0);
      if (high <= low || b <= a) return;
      if (low < 2.65 && groundCuts.length) {
        const polygon = [[[a, low], [b, low], [b, high], [a, high], [a, low]]] as polygonClipping.Polygon;
        for (const [outer, ...holes] of polygonClipping.difference(polygon, ...groundCuts)) parts[kind].push(new THREE.ExtrudeGeometry(surface(outer, holes), { depth, bevelEnabled: false }).translate(0, 0, -depth / 2).applyMatrix4(transform(offset)));
        return;
      }
      if (kind === 'joints') {
        parts[kind].push(new THREE.PlaneGeometry(b - a, high - low).translate((a + b) / 2, (low + high) / 2, 0).applyMatrix4(transform(offset))); return;
      }
      const geometry = new THREE.BoxGeometry(b - a, high - low, depth).translate((a + b) / 2, (low + high) / 2, 0).applyMatrix4(transform(offset));
      parts[kind].push(geometry);
    };
    const faceOpenings = openings.filter(opening => opening.face === faceIndex);
    const cladding = [[[face.start, 0], [face.length, 0], [face.length, shown], [face.start, shown], [face.start, 0]]] as polygonClipping.Polygon;
    const paneCuts = faceOpenings.map(opening => { const ring = openingProfile(opening).map(p => p.toArray()); return [[...ring, ring[0]]] as polygonClipping.Polygon; });
    for (const [outer, ...holes] of polygonClipping.difference(cladding, ...paneCuts, ...groundCuts)) parts.stone.push(new THREE.ShapeGeometry(surface(outer, holes)).applyMatrix4(transform(.012)));
    for (let bay = 0; bay <= face.count; bay++) {
      const station = face.start + bay * face.bay;
      rect('stone', Math.max(face.start, station - .21), Math.min(face.length, station + .21), .72, floorHeight - .35, .16, .1);
      rect('stone', Math.max(face.start, station - .31), Math.min(face.length, station + .31), floorHeight - .56, floorHeight - .32, .22, .14);
    }
    rect('stone', face.start, face.length, .04, .16, .12, .07);
    rect('stone', face.start, face.length, .6, .76, .14, .09);
    rect('metal', face.start, face.length, .17, .58, .035, .034);
    for (let y = .19; y < .57; y += .075) rect('metal', face.start, face.length, y, y + .022, .095, .081);
    for (let x = face.start + .16; x < face.length; x += .32) rect('metal', x, x + .026, .17, .58, .065, .098);
    // A small exposed drainpipe appears at the photographed elevation's end.
    rect('metal', face.length - .13, face.length - .045, .04, .95, .085, .16);
    // Grey brick courses are shallow joints, rather than another extruded wall.
    for (let floor = 1; floor * floorHeight < shown; floor++) for (let bay = 0; bay <= face.count; bay++) {
      const station = face.start + bay * face.bay, half = bay === 0 || bay === face.count ? .24 : .45;
      for (let y = floor * floorHeight + .12; y < Math.min((floor + 1) * floorHeight, shown); y += .18) rect('joints', Math.max(face.start, station - half), Math.min(face.length, station + half), y, y + .012, .012, .025);
    }
    for (const opening of faceOpenings) {
      const left = opening.center - opening.width / 2, right = opening.center + opening.width / 2;
      parts.glass.push(new THREE.ShapeGeometry(new THREE.Shape(openingProfile(opening))).applyMatrix4(transform(-WALL / 2)));
      const surround = new THREE.Shape(openingProfile(opening, opening.spring === undefined ? .065 : .22));
      surround.holes.push(new THREE.Path(openingProfile(opening)));
      parts[opening.spring === undefined ? 'frames' : 'brick'].push(new THREE.ExtrudeGeometry(surround, { depth: opening.spring === undefined ? .055 : .065, bevelEnabled: false }).applyMatrix4(transform(opening.spring === undefined ? -.16 : .022)));
      const segment = (x0: number, y0: number, x1: number, y1: number) => {
        const a = face.at(x0, -.11), b = face.at(x1, -.11);
        parts.frames.push(architectureBar([a[0], BASE + y0, a[1]], [b[0], BASE + y1, b[1]], .045));
      };
      for (let column = 0; column <= 4; column++) {
        const x = left + opening.width * column / 4;
        const top = opening.spring === undefined ? opening.top : Math.min(opening.top, opening.spring + Math.sqrt(Math.max(0, (opening.width / 2) ** 2 - (x - opening.center) ** 2)));
        segment(x, opening.bottom, x, top);
      }
      for (const y of [opening.bottom, opening.bottom + (opening.top - opening.bottom) * .33, opening.spring ?? opening.top - .5]) segment(left, y, right, y);
      if (opening.spring === undefined) {
        segment(left, opening.top, right, opening.top);
        rect('brick', left - .08, right + .08, opening.bottom - .72, opening.bottom - .15, .04, .044);
        for (let y = opening.bottom - .6; y < opening.bottom - .16; y += .14) rect('joints', left - .08, right + .08, y, y + .013, .012, .071);
        rect('stone', left - .12, right + .12, opening.bottom - .12, opening.bottom, .15, .08);
      } else {
        const half = opening.width / 2;
        for (let i = 0; i < ARCH_STEPS * 2; i++) {
          const a = i * Math.PI / (ARCH_STEPS * 2), b = (i + 1) * Math.PI / (ARCH_STEPS * 2);
          segment(opening.center + half * Math.cos(a), opening.spring + half * Math.sin(a), opening.center + half * Math.cos(b), opening.spring + half * Math.sin(b));
        }
      }
    }
    rect('stone', face.start, face.length, floorHeight - .32, floorHeight - .16, .22, .12);
    if (cutawayHeight === undefined) rect('stone', face.start, face.length, shown - .23, shown, .18, .08);
  }
  return Object.fromEntries(Object.entries(parts).map(([kind, geometries]) => [kind, architectureBatch(geometries, kind !== 'glass' && kind !== 'frames' && kind !== 'joints' && kind !== 'metal')])) as Record<Kind, THREE.BufferGeometry>;
}

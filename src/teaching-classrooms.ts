import polygonClipping from 'polygon-clipping';
import type { ClassroomWindows, Point } from './types';

type MultiPolygon = polygonClipping.MultiPolygon;
export type ClassroomWindow = { from: Point; to: Point; cut: polygonClipping.Polygon; bottom: number; top: number };
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function wallEdges(core: MultiPolygon) {
  return core.flatMap(polygon => polygon.flatMap((ring, index) => {
    const area = ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0);
    const sign = (area >= 0 ? 1 : -1) * (index ? -1 : 1);
    return ring.slice(0, -1).map((from, i) => {
      const to = ring[i + 1], dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
      return { from, to, length, normal: [-dz / length * sign, dx / length * sign] as Point };
    }).filter(edge => edge.length > 1e-5);
  }));
}

function strip(from: Point, to: Point, normal: Point, start: number, end: number): polygonClipping.Polygon {
  const at = (p: Point, depth: number): Point => [p[0] + normal[0] * depth, p[1] + normal[1] * depth];
  const ring = [at(from, start), at(to, start), at(to, end), at(from, end)];
  return [[...ring, ring[0]]];
}

// Hollow only the classroom cores. Corridor and stair openings have already
// been removed; complete concrete slabs keep classrooms closed above and below.
export function classroomWallFootprint(core: MultiPolygon, thickness: number): MultiPolygon {
  const walls = wallEdges(core).map(({ from, to, normal }) => strip(from, to, normal, -.001, thickness));
  if (!walls.length) return [];
  return polygonClipping.intersection(core, polygonClipping.union(walls[0], ...walls.slice(1)));
}

export function classroomWindowLayout(core: MultiPolygon, config: ClassroomWindows, height: number, floorHeight: number, groundOpenings: polygonClipping.Polygon[] = [], solidCores: polygonClipping.Polygon[] = []): ClassroomWindow[] {
  const result: ClassroomWindow[] = [];
  for (const { from, to, length, normal } of wallEdges(core)) {
    if (length < 3.2) continue;
    const count = Math.max(1, Math.floor(length / config.bayWidth));
    const bay = length / count, width = Math.min(config.windowWidth, bay - .9);
    for (let i = 0; i < count; i++) {
      const center = bay * (i + .5), a = lerp(from, to, (center - width / 2) / length), b = lerp(from, to, (center + width / 2) / length);
      const inset = (p: Point): Point => [p[0] + normal[0] * config.wallThickness / 2, p[1] + normal[1] * config.wallThickness / 2];
      for (let floor = 0; floor * floorHeight < height; floor++) {
        const bottom = floor * floorHeight + Math.min(config.sill, floorHeight * .3);
        const top = Math.min(floor * floorHeight + Math.min(config.top, floorHeight - .35), height - .25);
        if (top <= bottom) continue;
        const cut = strip(a, b, normal, -.04, config.wallThickness + .04);
        // Elevator shafts remain concrete, including the boundary shared with
        // a classroom. Never put a pane or an opening into that solid volume.
        if (solidCores.some(solid => polygonClipping.intersection(cut, solid).length)) continue;
        if (!floor && groundOpenings.some(opening => polygonClipping.intersection(cut, opening).length)) continue;
        result.push({ from: inset(a), to: inset(b), cut, bottom, top });
      }
    }
  }
  return result;
}

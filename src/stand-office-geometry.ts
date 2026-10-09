import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import { classroomWindowLayout, type ClassroomWindow } from './teaching-classrooms.ts';
import { stairwellFrame, teachingStairGeometry } from './teaching-stairs.ts';
import type { Building, BuildingStairwell, Point } from './types';

export const STAND_OFFICE_ID = 'local/stand-office';
const BASE = .12, SLAB = .25;
type Vector = [number, number, number];

// The latest red outline places the white switchback on the long front facade,
// beside the stands. Stairs and doors share this anchor instead of a side wall.
export function standOfficeStairLayout(building: Building) {
  const [front, next, , rear] = building.outer;
  const longLength = Math.hypot(next[0] - front[0], next[1] - front[1]);
  const depth = Math.hypot(rear[0] - front[0], rear[1] - front[1]);
  const along: Point = [(next[0] - front[0]) / longLength, (next[1] - front[1]) / longLength];
  const inward: Point = [-along[1], along[0]];
  const width = 3.1, landingDepth = 1.45, run = Math.min(3.3, longLength - 2 * landingDepth - .9), offset = .7;
  const origin: Point = [front[0] + along[0] * offset - inward[0] * (width / 2 - .04), front[1] + along[1] * offset - inward[1] * (width / 2 - .04)];
  const stair: BuildingStairwell = { partId: 'external', origin, axis: along, width, run, landingDepth, stepsPerFlight: 10, firstFlight: 'right', internal: true, opening: { outer: [], holes: [] } };
  return { stair, ...stairwellFrame(stair), along, inward, front, offset, depth };
}

export function standOfficeWindows(building: Building, height: number, floorHeight: number): ClassroomWindow[] {
  const config = building.classroomWindows;
  if (!config) return [];
  const windows = classroomWindowLayout([[building.outer, ...building.holes]], config, height, floorHeight);
  const layout = standOfficeStairLayout(building), doorFrom = layout.offset + .18, doorTo = layout.offset + layout.stair.landingDepth - .12;
  const station = (p: Point) => (p[0] - layout.front[0]) * layout.along[0] + (p[1] - layout.front[1]) * layout.along[1];
  return windows.flatMap(window => {
    const from = station(window.from), to = station(window.to), span = to - from;
    const first = (doorFrom - from) / span, last = (doorTo - from) / span;
    const start = Math.max(0, Math.min(first, last)), end = Math.min(1, Math.max(first, last));
    if (start >= end) return [window];
    const lerp = (t: number): Point => [window.from[0] + (window.to[0] - window.from[0]) * t, window.from[1] + (window.to[1] - window.from[1]) * t];
    const sliced = (a: number, b: number): ClassroomWindow[] => {
      if (b - a < 1e-5) return [];
      const from = lerp(a), to = lerp(b), half = config.wallThickness / 2 + .04;
      const inset = (p: Point, distance: number): Point => [p[0] + layout.inward[0] * distance, p[1] + layout.inward[1] * distance];
      const ring = [inset(from, -half), inset(to, -half), inset(to, half), inset(from, half)];
      const mullions = (fractions?: number[]) => [...new Set([0, ...(fractions ?? []).filter(t => t > a && t < b).map(t => (t - a) / (b - a)), 1])];
      return [{ ...window, from, to, cut: [[...ring, ring[0]]], mullions: mullions(window.mullions), ...(window.upperMullions ? { upperMullions: mullions(window.upperMullions) } : {}) }];
    };
    return [...sliced(0, start), ...sliced(end, 1)];
  });
}

// Door apertures use the same wall-cut machinery as the confirmed windows but
// are kept out of the glazing renderer: an entry is not a new glass facade.
export function standOfficeOpenings(building: Building, height: number, floorHeight: number): ClassroomWindow[] {
  const config = building.classroomWindows;
  if (!config) return [];
  const windows = standOfficeWindows(building, height, floorHeight);
  const layout = standOfficeStairLayout(building), wall = config.wallThickness;
  const point = (u: number, inset: number): Point => [layout.front[0] + layout.stair.axis[0] * (layout.offset + u) + layout.inward[0] * inset, layout.front[1] + layout.stair.axis[1] * (layout.offset + u) + layout.inward[1] * inset];
  for (let level = 0; level * floorHeight + SLAB < height; level++) {
    const bottom = level * floorHeight + SLAB, top = Math.min(bottom + 2.2, height - SLAB);
    if (top <= bottom) continue;
    const u0 = .18, u1 = layout.stair.landingDepth - .12;
    const ring = [point(u0, -.02), point(u1, -.02), point(u1, wall + .02), point(u0, wall + .02)];
    windows.push({ from: point(u0, wall / 2), to: point(u1, wall / 2), bottom, top, cut: [[...ring, ring[0]]] });
  }
  return windows;
}

export function standOfficeGeometry(building: Building, height: number, floorHeight: number, cutawayHeight?: number) {
  const concrete: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], trim: THREE.BufferGeometry[] = [];
  const layout = standOfficeStairLayout(building), { stair, at } = layout;
  const shown = cutawayHeight ?? height + 1.2;
  const point = (u: number, v: number, y: number): Vector => { const [x, z] = at(u, v); return [x, BASE + y, z]; };
  const box = (u0: number, u1: number, v0: number, v1: number, bottom: number, top: number) => {
    top = Math.min(top, shown); if (top <= bottom) return;
    concrete.push(new THREE.BoxGeometry(v1 - v0, top - bottom, u1 - u0).rotateY(Math.atan2(stair.axis[0], stair.axis[1]))
      .translate(...point((u0 + u1) / 2, (v0 + v1) / 2, (bottom + top) / 2)));
  };
  const bar = (from: Vector, to: Vector) => {
    const limit = BASE + shown - .01;
    if (from[1] >= limit && to[1] >= limit) return;
    if (from[1] > limit) { const t = (limit - to[1]) / (from[1] - to[1]); from = from.map((v, i) => to[i] + (v - to[i]) * t) as Vector; }
    if (to[1] > limit) { const t = (limit - from[1]) / (to[1] - from[1]); to = to.map((v, i) => from[i] + (v - from[i]) * t) as Vector; }
    if (Math.hypot(...from.map((v, i) => v - to[i])) > .001) rails.push(architectureBar(from, to, .055));
  };
  const guard = (u0: number, v0: number, u1: number, v1: number, y: number) => {
    for (const rise of [.48, 1.02]) bar(point(u0, v0, y + rise), point(u1, v1, y + rise));
    const count = Math.max(1, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / .65));
    for (let i = 0; i <= count; i++) {
      const t = i / count, u = u0 + (u1 - u0) * t, v = v0 + (v1 - v0) * t;
      bar(point(u, v, y), point(u, v, y + 1.02));
    }
  };
  const floors = Math.round(height / floorHeight), half = stair.width / 2;
  for (let level = 0; level < floors; level++) {
    const bottom = level * floorHeight + SLAB, top = level === floors - 1 ? height : (level + 1) * floorHeight + SLAB;
    if (bottom >= shown) break;
    // Reuse the teaching building's two-flight profile and intermediate landing.
    // The final run meets the retained roof exactly rather than overshooting it.
    const rise = top - bottom;
    const model = teachingStairGeometry({ ...building, stairwells: [stair] }, [{ id: 'external', name: '', outer: [], holes: [], floors: 2, height: rise + 1.5 }], rise, shown - bottom + SLAB);
    for (const [kind, geometry] of Object.entries(model)) {
      geometry.translate(0, bottom - SLAB, 0);
      (kind === 'concrete' ? concrete : rails).push(geometry);
    }
    box(0, stair.landingDepth, -half, half, bottom - .22, bottom);
    guard(.04, -half + .06, .04, half - .06, bottom);
    guard(.04, -half + .06, stair.landingDepth, -half + .06, bottom);
  }
  if (cutawayHeight === undefined || cutawayHeight > height + 1.02) {
    box(0, stair.landingDepth, -half, half, height - .22, height);
    guard(.04, -half + .06, .04, half - .06, height);
    guard(.04, -half + .06, stair.landingDepth, -half + .06, height);
  }
  for (const u of [.16, stair.landingDepth * 2 + stair.run - .16]) box(u - .12, u + .12, -half - .06, -half + .18, 0, Math.min(height, shown));
  // The pictured long face has pale horizontal floor bands around two window
  // rows. No guessed glass or repeated detailing is added to the other faces.
  const [from, to] = building.outer, dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
  for (let floor = 1; floor <= floors; floor++) {
    const top = Math.min(floor * floorHeight, shown), bottom = floor * floorHeight - .17;
    if (top <= bottom) continue;
    trim.push(new THREE.BoxGeometry(length, top - bottom, .12).rotateY(-Math.atan2(dz, dx))
      .translate((from[0] + to[0]) / 2 + dz / length * .06, BASE + (top + bottom) / 2, (from[1] + to[1]) / 2 - dx / length * .06));
  }
  return { concrete: architectureBatch(concrete, false), rails: architectureBatch(rails, false), trim: architectureBatch(trim, false) };
}

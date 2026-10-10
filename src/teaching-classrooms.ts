import polygonClipping from 'polygon-clipping';
import type { BuildingSolidCore, ClassroomWindows, Point } from './types';

type MultiPolygon = polygonClipping.MultiPolygon;
export type ClassroomWindow = { from: Point; to: Point; cut: polygonClipping.Polygon; bottom: number; top: number; mullions?: number[]; upperMullions?: number[] };
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// Match the actual wall boundary, before the glazing's half-wall inset. Only
// tiny coordinate-rounding differences are allowed; a nearby parallel wall is
// not evidence. Joined/reversed survey segments may cover one complete pane.
export function confirmedFacade(from: Point, to: Point, edges: { from: Point; to: Point }[]) {
  const epsilon = 1e-4, length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const dx = (to[0] - from[0]) / length, dz = (to[1] - from[1]) / length;
  const station = (p: Point) => (p[0] - from[0]) * dx + (p[1] - from[1]) * dz;
  const distance = (p: Point) => Math.abs((p[0] - from[0]) * dz - (p[1] - from[1]) * dx);
  const intervals = edges.flatMap(edge => {
    const edgeLength = Math.hypot(edge.to[0] - edge.from[0], edge.to[1] - edge.from[1]);
    if (edgeLength < epsilon || distance(edge.from) > epsilon || distance(edge.to) > epsilon ||
      Math.abs((edge.to[0] - edge.from[0]) * dz - (edge.to[1] - edge.from[1]) * dx) / edgeLength > epsilon) return [];
    const a = station(edge.from), b = station(edge.to);
    const start = Math.max(0, Math.min(a, b)), end = Math.min(length, Math.max(a, b));
    return end > start ? [[start, end]] : [];
  }).sort((a, b) => a[0] - b[0]);
  let covered = 0;
  for (const [start, end] of intervals) {
    if (start > covered + epsilon) return false;
    covered = Math.max(covered, end);
    if (covered >= length - epsilon) return true;
  }
  return false;
}

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

// Short chords describe the rounded bays, not separate blank wall ends. Keep
// their actual curved boundary and distribute a window across the smooth run.
// Sharp corners and short square returns still separate independent faces.
function windowRuns(core: MultiPolygon) {
  const edges = wallEdges(core), runs: (typeof edges)[] = [];
  const joins = (a: typeof edges[number], b: typeof edges[number]) =>
    a.length < 4.5 && b.length < 4.5 && Math.hypot(a.to[0] - b.from[0], a.to[1] - b.from[1]) < 1e-6 &&
    a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] > .5;
  for (const edge of edges) {
    const previous = runs.at(-1);
    if (previous && joins(previous.at(-1)!, edge)) previous.push(edge);
    else runs.push([edge]);
  }
  // A wholly curved ring may start in the middle of a window run.
  if (runs.length > 1 && joins(runs.at(-1)!.at(-1)!, runs[0][0])) {
    runs[0] = [...runs.pop()!, ...runs[0]];
  }
  return runs;
}

// Hollow only the classroom cores. Corridor and stair openings have already
// been removed; complete concrete slabs keep classrooms closed above and below.
// Dense curved outlines can supply the same coordinate snapping used by their
// slab layers, so near-coincident strip edges remain stable through both booleans.
export function classroomWallFootprint(core: MultiPolygon, thickness: number, stabilize: (polygons: MultiPolygon) => MultiPolygon = polygons => polygons): MultiPolygon {
  core = stabilize(core);
  const walls = stabilize(wallEdges(core).map(({ from, to, normal }) => strip(from, to, normal, -.001, thickness)));
  if (!walls.length) return [];
  return polygonClipping.intersection(core, stabilize(polygonClipping.union(walls[0], ...walls.slice(1))));
}

export function classroomWindowLayout(core: MultiPolygon, config: ClassroomWindows, height: number, floorHeight: number, groundOpenings: polygonClipping.Polygon[] = [], solidCores: polygonClipping.Polygon[] = []): ClassroomWindow[] {
  const result: ClassroomWindow[] = [];
  const facadeEdges = config.facadeLines?.flatMap(points => points.slice(1).map((to, i) => ({ from: points[i], to })));
  if (facadeEdges && !facadeEdges.length) return result;
  for (const run of windowRuns(core)) {
    const length = run.reduce((sum, edge) => sum + edge.length, 0);
    // A photographed short end bay may be narrower than an ordinary classroom.
    // Keep the conservative minimum for facades without explicit evidence.
    if (length < (facadeEdges ? .8 : 3.2)) continue;
    const count = Math.max(1, Math.floor(length / config.bayWidth));
    const bay = length / count, width = Math.min(config.windowWidth, bay - (config.pierWidth ?? .9));
    if (width <= 1e-6) continue;
    for (let i = 0; i < count; i++) {
      const center = bay * (i + .5), start = center - width / 2, end = center + width / 2;
      let station = 0, confirmed = true;
      const segments = run.flatMap(edge => {
        const first = Math.max(start, station), last = Math.min(end, station + edge.length), origin = station;
        station += edge.length;
        if (last - first < 1e-6) return [];
        const a = lerp(edge.from, edge.to, (first - origin) / edge.length), b = lerp(edge.from, edge.to, (last - origin) / edge.length);
        if (facadeEdges && !confirmedFacade(a, b, facadeEdges)) confirmed = false;
        const inset = (p: Point): Point => [p[0] + edge.normal[0] * config.wallThickness / 2, p[1] + edge.normal[1] * config.wallThickness / 2];
        const divisions = (columns: number) => Array.from({ length: columns + 1 }, (_, column) => start + width * column / columns)
          .filter(at => at >= first - 1e-6 && at <= last + 1e-6).map(at => Math.max(0, Math.min(1, (at - first) / (last - first))));
        return [{ from: inset(a), to: inset(b), cut: strip(a, b, edge.normal, -.04, config.wallThickness + .04), mullions: divisions(config.columns),
          ...(config.upperColumns ? { upperMullions: divisions(config.upperColumns) } : {}) }];
      });
      // A curved bay must be confirmed in full; do not leave a partial pane
      // wrapping into an unknown adjoining facade or inner wall.
      if (!confirmed) continue;
      for (let floor = 0; floor * floorHeight < height; floor++) {
        if (floor + 1 < (config.startFloor ?? 1) || floor + 1 > (config.endFloor ?? Infinity)) continue;
        const bottom = floor * floorHeight + Math.min(config.sill, floorHeight * .3);
        const top = Math.min(floor * floorHeight + Math.min(config.top, floorHeight - .35), height - .25);
        if (top <= bottom) continue;
        // Core enclosures have their own appearance (including glass elevators).
        // Never replace them with generic classroom windows or openings.
        if (solidCores.some(solid => segments.some(segment => polygonClipping.intersection(segment.cut, solid).length))) continue;
        if (!floor && groundOpenings.some(opening => segments.some(segment => polygonClipping.intersection(segment.cut, opening).length))) continue;
        result.push(...segments.map(segment => ({ ...segment, bottom, top })));
      }
    }
  }
  return result;
}

// Some dedicated upper-floor rooms are glazing bays, rather than solid blocks.
// Use an explicit saved window calibration; elevator and opaque cores keep
// their separate appearance and do not inherit ordinary classroom windows.
export function solidCoreWindowLayout(cores: BuildingSolidCore[], height: number, floorHeight: number): ClassroomWindow[] {
  return cores.flatMap(core => !core.elevator && core.classroomWindows
    ? classroomWindowLayout([[core.outer, ...core.holes]], core.classroomWindows, height, floorHeight)
      .filter(window => window.bottom >= ((core.startFloor ?? 1) - 1) * floorHeight)
    : []);
}

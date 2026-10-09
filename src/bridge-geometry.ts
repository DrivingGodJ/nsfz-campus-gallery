import polygonClipping from 'polygon-clipping';
import type { Feature, Point, Shape } from './types';
import { passageFootprint } from './underground-geometry.ts';
import { bridgeSurfaceHeight } from './structure-geometry.ts';

export type RailPoint = [number, number, number];
export const BRIDGE_DECK_THICKNESS = .28;

export function bridgeSupports(feature: Feature, height: number): { position: RailPoint; size: RailPoint }[] {
  const underside = height - BRIDGE_DECK_THICKNESS;
  if (feature.archRise || underside <= .12) return [];
  // Embed the column head inside the slab so its cap cannot overlap the walking surface.
  const top = underside + .015;
  return (feature.points || []).slice(0, -1).map(([x, z]) => ({ position: [x, top / 2, z], size: [.65, top, .65] }));
}
const near = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
const merge = (shapes: Shape[]): Shape[] => polygonClipping.union([shapes[0].outer], ...shapes.slice(1).map(shape => [shape.outer]))
  .map(([outer, ...holes]) => ({ outer, holes }));

export function bridgeLayout(feature: Feature, height: number) {
  const points = feature.points!, width = feature.width || 3.5;
  const stairs = (feature.connections || []).filter(connection => connection.type === 'stairs').map(connection => {
    const node = connection.points[0], to = connection.points.at(-1)!;
    const length = Math.hypot(to[0] - node[0], to[1] - node[1]);
    const previous = near(node, points[0]) ? points[1] : points.at(-2)!;
    const incomingLength = Math.hypot(node[0] - previous[0], node[1] - previous[1]);
    const cosine = Math.max(-1, Math.min(1, ((node[0] - previous[0]) * (to[0] - node[0]) + (node[1] - previous[1]) * (to[1] - node[1])) / (incomingLength * length)));
    const cornerSetback = width / 2 * Math.sqrt((1 - cosine) / Math.max(1e-8, 1 + cosine));
    const landing = Math.min(Math.max(width / 2, cornerSetback) + .25, length / 3);
    const from: Point = node.map((n, i) => n + (to[i] - n) * landing / length) as Point;
    const bottom = connection.groundHeight ?? .12;
    let flights = [{ from, to, top: height, bottom }];
    const landings: { from: Point; to: Point; height: number }[] = [];
    if ((connection.midLanding ?? 0) > 0 && height > bottom) {
      // The photographed field stairs descend in two short flights. Keep the
      // existing axis and terminal, then meet it with a level ground approach.
      const span = length - landing, midLength = Math.min(connection.midLanding!, span / 3);
      const run = Math.min(Math.ceil((height - bottom) / .36 - 1e-7) * .3, (span - midLength) / 2);
      const at = (distance: number): Point => from.map((n, i) => n + (to[i] - from[i]) * distance / span) as Point;
      const firstEnd = at(run), secondStart = at(run + midLength), secondEnd = at(2 * run + midLength);
      const middle = (height + bottom) / 2;
      flights = [{ from, to: firstEnd, top: height, bottom: middle },
        { from: secondStart, to: secondEnd, top: middle, bottom }];
      landings.push({ from: firstEnd, to: secondStart, height: middle });
      if (2 * run + midLength < span - 1e-6) landings.push({ from: secondEnd, to, height: bottom });
    }
    return { id: connection.id, from, to, top: height, bottom, flights, landings };
  });
  const fullRoutes = [points], deckRoutes = [points];
  for (const connection of feature.connections || []) {
    // Walk toward the shared junction, then turn into its branch as one route.
    const main = near(connection.points[0], points[0]) ? [...points].reverse() : points;
    fullRoutes.push([...main, ...connection.points.slice(1)]);
    const stair = stairs.find(item => item.id === connection.id);
    deckRoutes.push([...main, ...(stair ? [stair.from] : connection.points.slice(1))]);
  }
  const footprint = merge(fullRoutes.map(route => passageFootprint(route, width)));
  const deck = merge(deckRoutes.map(route => passageFootprint(route, width)));
  // A standalone bridge joins the road at both ends; only its sides need rails.
  const openingRoutes = feature.connections?.length ? feature.connections.map(connection => connection.points)
    : [[points[1], points[0]], [points.at(-2)!, points.at(-1)!]];
  const openings = openingRoutes.map(route => {
    const end = route.at(-1)!, previous = route.at(-2)!;
    const length = Math.hypot(end[0] - previous[0], end[1] - previous[1]);
    return { end, direction: end.map((n, i) => (n - previous[i]) / length) as Point };
  });
  const onOpening = (from: Point, to: Point) => openings.some(({ end, direction }) => {
    // Both vertices must belong to the same opening, rather than opposite ends.
    return [from, to].every(point => {
      const dx = point[0] - end[0], dz = point[1] - end[1];
      return Math.abs(dx * direction[0] + dz * direction[1]) < 1e-6
        && Math.abs(dx * direction[1] - dz * direction[0]) <= width / 2 + 1e-6;
    });
  });
  const floorAt = (point: Point) => {
    for (const stair of stairs) {
      const segments = [...stair.flights, ...stair.landings.map(landing => ({ ...landing, top: landing.height, bottom: landing.height }))];
      for (const segment of segments) {
        const dx = segment.to[0] - segment.from[0], dz = segment.to[1] - segment.from[1], length = Math.hypot(dx, dz);
        const t = ((point[0] - segment.from[0]) * dx + (point[1] - segment.from[1]) * dz) / (length * length);
        const across = Math.abs((point[0] - segment.from[0]) * dz - (point[1] - segment.from[1]) * dx) / length;
        if (t >= -1e-6 && t <= 1 + 1e-6 && across <= width / 2 + 1e-6) return segment.top + (segment.bottom - segment.top) * Math.max(0, Math.min(1, t));
      }
    }
    return bridgeSurfaceHeight(feature, height, point);
  };
  const groundApproaches = stairs.flatMap(stair => stair.landings.filter(landing => near(landing.to, stair.to) && Math.abs(landing.height - stair.bottom) < 1e-6));
  const onGroundApproach = (from: Point, to: Point) => groundApproaches.some(landing => {
    const dx = landing.to[0] - landing.from[0], dz = landing.to[1] - landing.from[1], length = Math.hypot(dx, dz);
    return [from, to].every(point => {
      const x = point[0] - landing.from[0], z = point[1] - landing.from[1];
      const along = (x * dx + z * dz) / length;
      return along >= -1e-6 && along <= length + 1e-6 && Math.abs(x * dz - z * dx) / length <= width / 2 + 1e-6;
    });
  });
  const railChains: RailPoint[][] = [];
  for (const shape of footprint) for (const ring of [shape.outer, ...shape.holes]) {
    const chains: Point[][] = []; let chain: Point[] = [];
    for (let i = 1; i < ring.length; i++) {
      const from = ring[i - 1], to = ring[i];
      if (onOpening(from, to)) { if (chain.length) chains.push(chain); chain = []; continue; }
      // Cut rails at every flight/platform joint so the middle and ground
      // landings stay level instead of becoming another long sloping rail.
      const cuts = [0, 1];
      if (feature.archRise) for (let n = 1; n < 32; n++) cuts.push(n / 32);
      for (const stair of stairs) {
        const dx = stair.to[0] - stair.from[0], dz = stair.to[1] - stair.from[1];
        const joints = [stair.from, ...stair.flights.map(flight => flight.to), ...stair.landings.map(landing => landing.to)];
        for (const joint of joints) {
          const a = (from[0] - joint[0]) * dx + (from[1] - joint[1]) * dz;
          const b = (to[0] - joint[0]) * dx + (to[1] - joint[1]) * dz;
          const t = -a / (b - a);
          if (Number.isFinite(t) && t > 1e-7 && t < 1 - 1e-7) cuts.push(t);
        }
      }
      const ordered = [...new Set(cuts)].sort((a, b) => a - b);
      for (let n = 1; n < ordered.length; n++) {
        const a = from.map((value, j) => value + (to[j] - value) * ordered[n - 1]) as Point;
        const b = from.map((value, j) => value + (to[j] - value) * ordered[n]) as Point;
        // The field-level continuation is an open path. Stop both guards at
        // the last stair tread; their shared chains also bound the wire mesh.
        if (onGroundApproach(a, b)) { if (chain.length) chains.push(chain); chain = []; continue; }
        if (!chain.length) chain.push(a);
        chain.push(b);
      }
    }
    if (chain.length) chains.push(chain);
    if (chains.length > 1 && near(chains.at(-1)!.at(-1)!, chains[0][0])) {
      chains[0] = [...chains.pop()!, ...chains[0].slice(1)];
    }
    railChains.push(...chains.map(points => points.map(point => [point[0], floorAt(point), point[1]] as RailPoint)));
  }
  return { deck, footprint, stairs, railChains };
}

export function bridgeRailPosts(chains: RailPoint[][], spacing = 3, smooth = false): RailPoint[] {
  if (smooth) return chains.flatMap(chain => {
    const posts: RailPoint[] = [chain[0]]; let walked = 0, next = spacing;
    for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1], to = chain[i], length = Math.hypot(...to.map((n, j) => n - from[j]));
      while (next < walked + length) {
        const t = (next - walked) / length;
        posts.push(from.map((n, j) => n + (to[j] - n) * t) as RailPoint); next += spacing;
      }
      walked += length;
    }
    if (Math.hypot(...chain.at(-1)!.map((n, j) => n - posts.at(-1)![j])) < .3) posts.pop();
    posts.push(chain.at(-1)!); return posts;
  });
  const posts = new Map<string, RailPoint>();
  for (const chain of chains) for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1], to = chain[i], count = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[2] - from[2]) / spacing));
    for (let n = 0; n <= count; n++) {
      const point = from.map((value, j) => value + (to[j] - value) * n / count) as RailPoint;
      posts.set(point.map(value => value.toFixed(6)).join(','), point);
    }
  }
  const spaced: RailPoint[] = [];
  for (const point of posts.values()) if (!spaced.some(existing => Math.hypot(...point.map((n, i) => n - existing[i])) < .3)) spaced.push(point);
  return spaced;
}

import polygonClipping from 'polygon-clipping';
import type { Feature, Point, Shape } from './types';

// Offset both sides of a route so adjacent segments share one mitered corner.
export function passageFootprint(points: Point[], width: number): Shape {
  const route: Point[] = [];
  for (const point of points) {
    const previous = route.at(-1);
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 1e-8) continue;
    while (route.length >= 2) {
      const from = route.at(-2)!, middle = route.at(-1)!;
      const dx = middle[0] - from[0], dz = middle[1] - from[1], nx = point[0] - middle[0], nz = point[1] - middle[1];
      if (Math.abs(dx * nz - dz * nx) > 1e-8 * Math.hypot(dx, dz) * Math.hypot(nx, nz) || dx * nx + dz * nz <= 0) break;
      route.pop();
    }
    route.push(point);
  }
  if (route.length < 2 || width <= 0) throw new Error('A passage needs a route and positive width');
  const normals = route.slice(1).map((to, i): Point => {
    const dx = to[0] - route[i][0], dz = to[1] - route[i][1], length = Math.hypot(dx, dz);
    return [dz / length, -dx / length];
  });
  const side = (offset: number) => route.map((point, i): Point => {
    const before = normals[Math.max(0, i - 1)], after = normals[Math.min(i, normals.length - 1)];
    const sum: Point = [before[0] + after[0], before[1] + after[1]];
    const denominator = sum[0] * after[0] + sum[1] * after[1];
    if (denominator < 1e-8) throw new Error('A passage cannot reverse at a corner');
    return [point[0] + offset * sum[0] / denominator, point[1] + offset * sum[1] / denominator];
  });
  const outer = [...side(width / 2), ...side(-width / 2).reverse()];
  outer.push(outer[0]);
  return { outer, holes: [] };
}

export function undergroundFootprints(feature: Feature, connections: Feature[] = [], aligned: ReadonlyMap<string, Shape> = new Map()): Shape[] {
  const footprints = [feature, ...connections].flatMap(item => aligned.has(item.id) ? [aligned.get(item.id)!] : item.outer
    ? [{ outer: item.outer, holes: item.holes || [] }]
    : [item.points!, ...(item.branches || [])].map(points => passageFootprint(points, item.width || 4)));
  const [first, ...rest] = footprints.map(shape => [shape.outer, ...shape.holes]);
  return polygonClipping.union(first, ...rest).map(([outer, ...holes]) => ({ outer, holes }));
}

export function undergroundConnections(features: Feature[], area: Feature) {
  return features.filter(feature => feature.type === 'tunnelJunction' && feature.connectedTo?.includes(area.id)
    && (feature.height ?? -3) === (area.height ?? -3));
}

export type PassageOpening = [Point, Point];
export type UndergroundAreaLayout = { feature: Feature; connections: Feature[]; footprints: Shape[]; openings: PassageOpening[] };

// Both colored routes share the intersections of their offset edges, rather
// than closing two perpendicular rectangles at the same centerline point.
export function joinedPassages(incoming: Feature, outgoing: Feature) {
  const before = incoming.points!, after = outgoing.points!, joint = before.at(-1)!;
  if (Math.hypot(joint[0] - after[0][0], joint[1] - after[0][1]) > 1e-7) return null;
  const unit = (from: Point, to: Point): Point => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  };
  const from = unit(before.at(-2)!, joint), to = unit(after[0], after[1]);
  const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
  const denominator = cross(from, to);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-7) return null;
  const normalFrom: Point = [from[1], -from[0]], normalTo: Point = [to[1], -to[0]];
  const seam = [-1, 1].map(sign => {
    const a: Point = [joint[0] + normalFrom[0] * (incoming.width || 4) / 2 * sign, joint[1] + normalFrom[1] * (incoming.width || 4) / 2 * sign];
    const b: Point = [joint[0] + normalTo[0] * (outgoing.width || 4) / 2 * sign, joint[1] + normalTo[1] * (outgoing.width || 4) / 2 * sign];
    const t = cross([b[0] - a[0], b[1] - a[1]], to) / denominator;
    return [a[0] + from[0] * t, a[1] + from[1] * t] as Point;
  }) as PassageOpening;
  const incomingShape = passageFootprint(before, incoming.width || 4), outgoingShape = passageFootprint(after, outgoing.width || 4);
  const middle = (incomingShape.outer.length - 1) / 2;
  incomingShape.outer[middle - 1] = seam[1]; incomingShape.outer[middle] = seam[0];
  outgoingShape.outer[0] = seam[1]; outgoingShape.outer[outgoingShape.outer.length - 2] = seam[0];
  outgoingShape.outer[outgoingShape.outer.length - 1] = seam[1];
  return { incoming: incomingShape, outgoing: outgoingShape, seam };
}

export function undergroundLayout(features: Feature[]) {
  const aligned = new Map<string, Shape>(), openings = new Map<string, PassageOpening[]>();
  for (const exit of features.filter(f => f.type === 'tunnelJunction' && f.points && f.points.length >= 2)) {
    const tunnel = features.find(f => f.type === 'tunnel' && f.points && f.points.length >= 2 && exit.connectedTo?.includes(f.id)
      && (f.height ?? -3) === (exit.height ?? -3) && (f.wallHeight || 2.4) === (exit.wallHeight || 2.4));
    if (!tunnel) continue;
    const join = joinedPassages(tunnel, exit);
    if (!join) continue;
    aligned.set(tunnel.id, join.incoming); aligned.set(exit.id, join.outgoing);
    openings.set(tunnel.id, [join.seam]); openings.set(exit.id, [join.seam]);
  }
  const underground = features.filter(f => ['tunnel', 'tunnelJunction', 'undergroundCorridor', 'undergroundRoom'].includes(f.type)
    && (f.outer || f.points && f.points.length >= 2));
  const connections = new Map(underground.filter(f => f.type === 'undergroundCorridor' && f.outer)
    .map(area => [area.id, undergroundConnections(features, area)]));
  const merged = new Set([...connections.values()].flatMap(items => items.map(item => item.id)));
  const areas = new Map<string, UndergroundAreaLayout>(), locations = new Map<string, Shape[]>();
  for (const feature of underground) {
    locations.set(feature.id, undergroundFootprints(feature, [], aligned));
    if (merged.has(feature.id)) continue;
    const joined = connections.get(feature.id) || [];
    areas.set(feature.id, { feature, connections: joined, footprints: undergroundFootprints(feature, joined, aligned),
      openings: [feature, ...joined].flatMap(item => openings.get(item.id) || []) });
  }
  return { areas, locations };
}

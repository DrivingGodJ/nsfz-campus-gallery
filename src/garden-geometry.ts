import * as THREE from 'three';
import clip from 'polygon-clipping';
import type { Feature, LakePavilion, Point, Shape } from './types';
import { passageFootprint } from './underground-geometry.ts';
import { bridgeLayout, bridgeRailPosts, type RailPoint } from './bridge-geometry.ts';

const polygon = (shape: Shape) => [shape.outer, ...shape.holes];
const shapes = (polygons: ReturnType<typeof clip.union>): Shape[] => polygons.map(([outer, ...holes]) => ({ outer, holes }));
export const circleRing = (center: Point, radius: number, count = 48): Point[] => Array.from({ length: count + 1 }, (_, i) =>
  [center[0] + Math.cos(i * Math.PI * 2 / count) * radius, center[1] + Math.sin(i * Math.PI * 2 / count) * radius]);
export function pavilionPoint(model: LakePavilion, x: number, z: number): Point {
  return [model.center[0] + model.axis[0] * x - model.axis[1] * z, model.center[1] + model.axis[1] * x + model.axis[0] * z];
}
export function pavilionFootprint(model: LakePavilion): Shape {
  const r = model.span / 2;
  return { outer: [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]].map(([x, z]) => pavilionPoint(model, x, z)), holes: [] };
}
export function pergolaFootprint(feature: Feature): Shape[] {
  const route = passageFootprint(feature.points!, feature.width || 2.4);
  const hub = { outer: circleRing(feature.pergola!.hub, feature.pergola!.hubRadius), holes: [] };
  return shapes(clip.union(polygon(route), polygon(hub)));
}
export function gardenFootprints(feature: Feature, features: Feature[]): Shape[] {
  if (feature.type === 'lakePavilion' && feature.pavilion) return [pavilionFootprint(feature.pavilion)];
  if (feature.type === 'pergola' && feature.pergola) return pergolaFootprint(feature);
  if (feature.type !== 'boardwalk') return [];
  const deck = bridgeLayout(feature, feature.height ?? .26).deck;
  const pads = features.filter(f => f.type === 'lakePavilion' && f.pavilion && feature.connectedTo?.includes(f.id)).map(f => pavilionFootprint(f.pavilion!));
  // The pavilion owns its floor. Join at the same edge instead of drawing two
  // deck faces on top of each other where the boardwalk crosses its platform.
  return pads.length ? shapes(clip.difference(deck.map(polygon), ...pads.map(polygon))) : deck;
}
function inside(point: Point, ring: Point[]) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
// Trim rails at pavilion entrances, including segments that cross a corner.
export function trimRailChains(chains: RailPoint[][], pads: Shape[]): RailPoint[][] {
  const result: RailPoint[][] = [];
  for (const chain of chains) {
    let current: RailPoint[] = [];
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1], b = chain[i], dx = b[0] - a[0], dz = b[2] - a[2], cuts = [0, 1];
      for (const pad of pads) for (let j = 1; j < pad.outer.length; j++) {
        const c = pad.outer[j - 1], d = pad.outer[j], ex = d[0] - c[0], ez = d[1] - c[1];
        const cross = dx * ez - dz * ex;
        if (Math.abs(cross) < 1e-9) continue;
        const t = ((c[0] - a[0]) * ez - (c[1] - a[2]) * ex) / cross;
        const u = ((c[0] - a[0]) * dz - (c[1] - a[2]) * dx) / cross;
        if (t > 1e-8 && t < 1 - 1e-8 && u >= 0 && u <= 1) cuts.push(t);
      }
      const sorted = [...new Set(cuts)].sort((a, b) => a - b);
      const at = (t: number): RailPoint => a.map((n, j) => n + (b[j] - n) * t) as RailPoint;
      for (let j = 1; j < sorted.length; j++) {
        const from = at(sorted[j - 1]), to = at(sorted[j]), middle = at((sorted[j - 1] + sorted[j]) / 2);
        if (pads.some(pad => inside([middle[0], middle[2]], pad.outer))) {
          if (current.length > 1) result.push(current); current = [];
        } else {
          if (!current.length) current.push(from);
          current.push(to);
        }
      }
    }
    if (current.length > 1) result.push(current);
  }
  return result;
}
export function boardwalkLayout(feature: Feature, features: Feature[]) {
  const height = feature.height ?? .26;
  const pads = features.filter(f => f.type === 'lakePavilion' && f.pavilion && feature.connectedTo?.includes(f.id)).map(f => pavilionFootprint(f.pavilion!));
  const railChains = trimRailChains(bridgeLayout(feature, height).railChains, pads);
  return { deck: gardenFootprints(feature, features), railChains, posts: bridgeRailPosts(railChains, 2.6), height };
}
export function boardwalkPlanks(feature: Feature, features: Feature[]) {
  const points = feature.points!, width = feature.width || 1.9, y = (feature.height ?? .26) + .008;
  const pads = features.filter(f => f.type === 'lakePavilion' && f.pavilion && feature.connectedTo?.includes(f.id)).map(f => pavilionFootprint(f.pavilion!));
  const lines: RailPoint[][] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    for (let d = .5; d < length - .4; d += .65) {
      const t = d / length, x = a[0] + dx * t, z = a[1] + dz * t;
      lines.push([-1, 1].map(sign => [x - dz / length * width * .46 * sign, y, z + dx / length * width * .46 * sign] as RailPoint));
    }
  }
  const geometry = new THREE.BufferGeometry();
  const segments = trimRailChains(lines, pads).flatMap(chain => chain.slice(1).flatMap((to, i) => [chain[i], to]));
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(segments.flat(), 3));
  return geometry;
}
export function pavilionRoofGeometry(model: LakePavilion, base: number) {
  const half = model.roofSpan / 2, peak = base + model.postHeight + model.roofRise;
  const positions: number[] = [], indices: number[] = [];
  // Four gently concave hips with raised corners, rather than a solid cone.
  const at = (face: number, t: number, u: number): RailPoint => {
    const angle = face * Math.PI / 2, edge = (u * 2 - 1) * half;
    const x = t * (half * Math.cos(angle) - edge * Math.sin(angle));
    const z = t * (half * Math.sin(angle) + edge * Math.cos(angle));
    const [wx, wz] = pavilionPoint(model, x, z);
    const y = peak - model.roofRise * (1 - (1 - t) ** 2) + .28 * t ** 4 * Math.abs(u * 2 - 1) ** 3;
    return [wx, y, wz];
  };
  const triangle = (a: RailPoint, b: RailPoint, c: RailPoint) => {
    const n = positions.length / 3; positions.push(...a, ...b, ...c); indices.push(n, n + 1, n + 2);
  };
  for (let face = 0; face < 4; face++) for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const a = at(face, i / 8, j / 8), b = at(face, (i + 1) / 8, j / 8);
    const c = at(face, (i + 1) / 8, (j + 1) / 8), d = at(face, i / 8, (j + 1) / 8);
    triangle(a, c, b); if (i) triangle(a, d, c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return { geometry, eaves: Array.from({ length: 4 }, (_, face) => Array.from({ length: 17 }, (_, i) => at(face, 1, i / 16))),
    ribs: Array.from({ length: 4 }, (_, face) => Array.from({ length: 17 }, (_, i) => at(face, i / 16, 0))), peak };
}
export function pergolaLayout(feature: Feature) {
  const model = feature.pergola!, base = feature.height ?? .12;
  return { footprint: pergolaFootprint(feature), base, height: base + model.floors * model.floorHeight };
}

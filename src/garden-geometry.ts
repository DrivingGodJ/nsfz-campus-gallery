import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
  return { deck: gardenFootprints(feature, features), railChains, posts: bridgeRailPosts(railChains, 1.6), height };
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
  const hub: Shape = { outer: circleRing(model.hub, model.hubRadius), holes: [] };
  const footprint = pergolaFootprint(feature);
  return { footprint, hub, corridor: shapes(clip.difference(footprint.map(polygon), polygon(hub))), base, height: base + model.floors * model.floorHeight };
}


function detailMesh(parts: THREE.BufferGeometry[]) {
  const plain = parts.map(part => {
    const geometry = part.index ? part.toNonIndexed() : part.clone();
    geometry.deleteAttribute('uv'); return geometry;
  });
  const result = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
  // Open timber work and shoreline stones should not hide photographs.
  result.userData.photoOcclusionMask = new Uint8Array(result.getAttribute('position').count / 3);
  return result;
}
function detailBar(from: RailPoint, to: RailPoint, width: number, depth = width) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a), length = direction.length();
  const geometry = new THREE.BoxGeometry(width, length, depth);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.divideScalar(length)));
  return geometry.translate(...a.add(b).multiplyScalar(.5).toArray());
}

export function boardwalkDetails(feature: Feature, features: Feature[]) {
  const { railChains, posts, height } = boardwalkLayout(feature, features);
  const timber: THREE.BufferGeometry[] = [], caps: THREE.BufferGeometry[] = [], supports: THREE.BufferGeometry[] = [];
  // DSC2479 and IMG9847 show a low single rail with capped square timber posts.
  for (const chain of railChains) for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1], b = chain[i];
    timber.push(detailBar([a[0], height + .52, a[2]], [b[0], height + .52, b[2]], .095, .11));
  }
  for (const [x, , z] of posts) {
    timber.push(new THREE.BoxGeometry(.18, .65, .18).translate(x, height + .325, z));
    caps.push(new THREE.BoxGeometry(.25, .055, .25).translate(x, height + .67, z));
  }
  const pads = features.filter(f => f.type === 'lakePavilion' && f.pavilion && feature.connectedTo?.includes(f.id)).map(f => pavilionFootprint(f.pavilion!));
  for (const chain of trimRailChains([feature.points!.map(([x, z]) => [x, height, z])], pads)) for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1], b = chain[i], dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz), count = Math.max(1, Math.ceil(length / 3.6));
    for (let j = 0; j <= count; j++) {
      const x = a[0] + dx * j / count, z = a[2] + dz * j / count;
      for (const side of [-1, 1]) supports.push(new THREE.BoxGeometry(.2, .55, .2).translate(x - dz / length * .62 * side, height - .35, z + dx / length * .62 * side));
    }
  }
  return { timber: detailMesh(timber), caps: detailMesh(caps), supports: detailMesh(supports) };
}

export function pavilionDetails(model: LakePavilion, base: number) {
  const timber: THREE.BufferGeometry[] = [], stone: THREE.BufferGeometry[] = [], rocks: THREE.BufferGeometry[] = [], roofLines: number[] = [];
  const r = model.span / 2 - .4, top = base + model.postHeight;
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, target = timber) => target.push(new THREE.BoxGeometry(w, h, d).translate(x, base + y, z));
  const corners: Point[] = [[-r, -r], [r, -r], [r, r], [-r, r]];
  for (const [x, z] of corners) {
    timber.push(new THREE.BoxGeometry(.24, .6, .24).translate(x, base - .3, z));
    timber.push(new THREE.CylinderGeometry(.14, .14, model.postHeight - .16, 8).translate(x, base + (model.postHeight + .16) / 2, z));
    stone.push(new THREE.CylinderGeometry(.19, .21, .16, 8).translate(x, base + .08, z));
  }
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4];
    timber.push(detailBar([a[0], top - .1, a[1]], [b[0], top - .1, b[1]], .18));
  }
  // The two non-entrance faces have benches. The front and left-bank exit stay open.
  for (const turn of [0, -Math.PI / 2]) {
    const bench: THREE.BufferGeometry[] = [];
    bench.push(new THREE.BoxGeometry(r * 1.72, .1, .43).translate(0, base + .46, r - .12));
    bench.push(new THREE.BoxGeometry(r * 1.72, .09, .085).translate(0, base + .94, r));
    for (const x of [-r * .66, r * .66]) bench.push(new THREE.BoxGeometry(.09, .42, .28).translate(x, base + .21, r - .12));
    for (let x = -r * .8; x < r * .81; x += .25) bench.push(detailBar([x, base + .5, r - .18], [x, base + .94, r], .035));
    timber.push(...bench.map(part => part.rotateY(turn)));
  }
  // Photo-confirmed circular timber openings; 2.5 m diameter clears the 1.9 m walk.
  for (const turn of [0, -Math.PI / 2]) {
    const lattice: THREE.BufferGeometry[] = [], radius = Math.min(1.25, r - .22);
    const at = (angle: number): RailPoint => [Math.cos(angle) * radius, base + radius + Math.sin(angle) * radius, -r];
    for (let i = 0; i < 40; i++) lattice.push(detailBar(at(i / 40 * Math.PI * 2), at((i + 1) / 40 * Math.PI * 2), .035));
    for (const side of [-1, 1]) {
      lattice.push(detailBar([side * r, base + .18, -r], [side * radius, base + radius, -r], .035));
      lattice.push(detailBar([side * r, top - .25, -r], [side * radius * .7, base + radius * 1.7, -r], .035));
      lattice.push(detailBar([side * r, base + radius * 1.4, -r], [side * radius * .9, top - .25, -r], .035));
    }
    timber.push(...lattice.map(part => part.rotateY(turn)));
  }
  // A few bank boulders are visible in aerial DJI0008 and ground DSC1080.
  // Their exact outlines and placement are estimates; leave both deck approaches clear.
  for (const [x, z, w, h, d] of [[-2.8, 2.1, .85, .48, .65], [3.6, 1.3, .65, .38, .52], [1.8, 3, .85, .36, .55], [-2.6, -2.8, .55, .3, .45]]) {
    rocks.push(new THREE.IcosahedronGeometry(1, 0).scale(w, h, d).translate(x, .08, z));
  }
  const half = model.roofSpan / 2, peak = base + model.postHeight + model.roofRise;
  for (let face = 0; face < 4; face++) for (let stripe = 1; stripe < 16; stripe++) {
    const u = stripe / 16, edge = (u * 2 - 1) * half, angle = face * Math.PI / 2;
    const at = (t: number): RailPoint => [t * (half * Math.cos(angle) - edge * Math.sin(angle)), peak - model.roofRise * (1 - (1 - t) ** 2) + .28 * t ** 4 * Math.abs(u * 2 - 1) ** 3 + .012, t * (half * Math.sin(angle) + edge * Math.cos(angle))];
    for (let j = 1; j < 8; j++) roofLines.push(...at(j / 8), ...at((j + 1) / 8));
  }
  const rotation = -Math.atan2(model.axis[1], model.axis[0]);
  const place = (geometry: THREE.BufferGeometry) => geometry.rotateY(rotation).translate(model.center[0], 0, model.center[1]);
  const tiles = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(roofLines, 3));
  return { timber: place(detailMesh(timber)), stone: place(detailMesh(stone)), rocks: place(detailMesh(rocks)), tiles: place(tiles) };
}

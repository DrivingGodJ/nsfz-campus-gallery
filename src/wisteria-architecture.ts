import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import clip from 'polygon-clipping';
import type { Feature, Point, Shape } from './types';
import { circleRing, pergolaLayout } from './garden-geometry.ts';
import { passageFootprint } from './underground-geometry.ts';

type Vector = [number, number, number];
const polygon = (shape: Shape) => [shape.outer, ...shape.holes];
function merged(parts: THREE.BufferGeometry[], photoBlocking = false) {
  const plain = parts.map(part => {
    const geometry = part.index ? part.toNonIndexed() : part.clone();
    geometry.deleteAttribute('uv'); return geometry;
  });
  const geometry = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
  if (!photoBlocking) geometry.userData.photoOcclusionMask = new Uint8Array(geometry.getAttribute('position').count / 3);
  return geometry;
}
function slab(shape: Shape, bottom: number, top: number) {
  const outline = new THREE.Shape(shape.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  outline.holes = shape.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
  const geometry = new THREE.ExtrudeGeometry(outline, { depth: top - bottom, bevelEnabled: false });
  geometry.rotateX(-Math.PI / 2); return geometry.translate(0, bottom, 0);
}
function beam(a: Vector, b: Vector, width: number, depth = width) {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from);
  const geometry = new THREE.BoxGeometry(width, delta.length(), depth);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()));
  return geometry.translate(...from.add(to).multiplyScalar(.5).toArray());
}

// The one-storey annex follows the marked library side wall. Its straight
// front end, rather than the curved walkway tangent, determines the door face.
export function libraryAnnexLayout(library: Shape) {
  const wall = library.outer.slice(11, 14).reverse(), origin = wall[0], back = wall.at(-1)!;
  const length = Math.hypot(back[0] - origin[0], back[1] - origin[1]);
  const along: Point = [(back[0] - origin[0]) / length, (back[1] - origin[1]) / length], out: Point = [along[1], -along[0]];
  const at = (u: number, v: number): Point => [origin[0] + along[0] * u + out[0] * v, origin[1] + along[1] * u + out[1] * v];
  const u0 = 0, u1 = length, depth = 4.6;
  const rectangle = (a: number, b: number, c: number, d: number): Shape => ({ outer: [[a, c], [b, c], [b, d], [a, d], [a, c]].map(([u, v]) => at(u, v)), holes: [] });
  const footprint: Shape = { outer: [...wall, at(u1, depth), at(u0, depth), origin], holes: [] };
  const roof: Shape = { outer: [...wall, at(u1 + .12, depth + .12), at(u0 - .12, depth + .12), at(u0 - .12, 0), origin], holes: [] };
  return { at, rectangle, footprint, roof, u0, u1, depth, along, out, doorStart: 1.2, doorEnd: 3.4 };
}

export function wisteriaArchitecture(feature: Feature, library: Shape) {
  const layout = pergolaLayout(feature), { base, height, hub, corridor } = layout;
  const route = feature.points!, width = feature.width || 2.4;
  const structure: THREE.BufferGeometry[] = [], posts: THREE.BufferGeometry[] = [], details: THREE.BufferGeometry[] = [];
  const arches: THREE.BufferGeometry[] = [], canopy: THREE.BufferGeometry[] = [];
  const floor = merged(layout.footprint.map(shape => slab(shape, base, base + .08)));
  const cumulative = [0];
  for (let i = 1; i < route.length; i++) cumulative.push(cumulative.at(-1)! + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
  const at = (distance: number, side = 0): Point => {
    const i = Math.min(route.length - 1, Math.max(1, cumulative.findIndex(d => d >= distance)));
    const a = route[i - 1], b = route[i], length = cumulative[i] - cumulative[i - 1], t = Math.max(0, Math.min(1, (distance - cumulative[i - 1]) / length));
    return [a[0] + (b[0] - a[0]) * t - (b[1] - a[1]) / length * side,
      a[1] + (b[1] - a[1]) * t + (b[0] - a[0]) / length * side];
  };
  // DJI_0008 shows a white curved roof; DSC08047 / DSC2503 show arches below it.
  // A thin fascia above each arch keeps the full walkway open at eye height.
  const arch = (point: (t: number, side: number) => Point, count = 8) => {
    const positions: number[] = [], quad = (a: Vector, b: Vector, c: Vector, d: Vector) => positions.push(...a, ...c, ...b, ...a, ...d, ...c);
    const section = (t: number) => {
      const [a, b] = [-.12, .12].map(side => point(t, side)), bottom = base + 2 + .65 * Math.sin(t * Math.PI);
      return [[a[0], bottom, a[1]], [a[0], height - .18, a[1]], [b[0], height - .18, b[1]], [b[0], bottom, b[1]]] as Vector[];
    };
    for (let i = 0; i < count; i++) {
      const a = section(i / count), b = section((i + 1) / count);
      quad(a[0], b[0], b[1], a[1]); quad(a[3], a[2], b[2], b[3]); quad(a[0], a[3], b[3], b[0]);
    }
    const a = section(0), b = section(1); quad(a[0], a[1], a[2], a[3]); quad(b[3], b[2], b[1], b[0]);
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals(); return geometry;
  };
  const hubCenter = feature.pergola!.hub, radius = feature.pergola!.hubRadius;
  const hubDistance = Math.hypot(route.at(-2)![0] - hubCenter[0], route.at(-2)![1] - hubCenter[1]);
  const hubAxis: Point = [(hubCenter[0] - route.at(-2)![0]) / hubDistance, (hubCenter[1] - route.at(-2)![1]) / hubDistance];
  const slot = passageFootprint([-1, 1].map(sign => [hubCenter[0] + hubAxis[0] * radius * 1.2 * sign, hubCenter[1] + hubAxis[1] * radius * 1.2 * sign]), width * .5);
  canopy.push(...corridor.map(shape => slab(shape, height - .18, height)), ...clip.difference(polygon(hub), polygon(slot)).map(([outer, ...holes]) => slab({ outer, holes }, height - .18, height)));
  const endParts: THREE.BufferGeometry[] = [];
  const endAngle = Math.atan2(hubAxis[1], hubAxis[0]);
  const circleAt = (angle: number, side = 0): Point => [hubCenter[0] + Math.cos(angle) * (radius - .14 + side), hubCenter[1] + Math.sin(angle) * (radius - .14 + side)];
  for (let i = 0; i < 4; i++) {
    const angle = endAngle + Math.PI / 4 + i * Math.PI / 2, next = angle + Math.PI / 2;
    endParts.push(arch((t, side) => circleAt(angle + .06 + (next - angle - .12) * t, side), 10));
    const p = circleAt(angle); posts.push(beam([p[0], base + .08, p[1]], [p[0], height - .18, p[1]], .34));
  }
  const end = merged(endParts, true);
  let length = cumulative.at(-1)!;
  while (length > 0 && Math.hypot(at(length)[0] - hubCenter[0], at(length)[1] - hubCenter[1]) < radius + .14) length -= .05;
  const bays = Math.max(1, Math.round(length / 4.2));
  for (let i = 0; i < bays; i++) for (const side of [-1, 1]) {
    const from = i / bays * length, to = (i + 1) / bays * length;
    arches.push(arch((t, thickness) => at(from + .17 + (to - from - .34) * t, side * (width / 2 - .16) + thickness)));
  }
  for (let i = 0; i <= bays; i++) for (const side of [-1, 1]) {
    const p = at(i / bays * length, side * (width / 2 - .16));
    posts.push(beam([p[0], base + .08, p[1]], [p[0], height - .18, p[1]], .32));
    structure.push(beam([p[0], height, p[1]], [p[0], height + .65, p[1]], .06));
  }
  // The metal frame stands above the opaque roof, with an open central band at the round end.
  for (let i = 1; i < route.length; i++) {
    const distance = Math.min(length, cumulative[i]), previous = cumulative[i - 1];
    if (previous >= length) break;
    for (const side of [-1, 1]) for (const y of [height + .12, height + .65]) {
      const a = at(previous, side * (width / 2 - .16)), b = at(distance, side * (width / 2 - .16));
      structure.push(beam([a[0], y, a[1]], [b[0], y, b[1]], .055));
    }
  }
  const ring = circleRing(hubCenter, radius - .14, 32);
  for (let i = 1; i < ring.length; i++) structure.push(beam([ring[i - 1][0], height + .65, ring[i - 1][1]], [ring[i][0], height + .65, ring[i][1]], .055));
  for (const side of [-1, 1]) {
    const a: Point = [hubCenter[0] - hubAxis[0] * radius - hubAxis[1] * width * .25 * side, hubCenter[1] - hubAxis[1] * radius + hubAxis[0] * width * .25 * side];
    const b: Point = [hubCenter[0] + hubAxis[0] * radius - hubAxis[1] * width * .25 * side, hubCenter[1] + hubAxis[1] * radius + hubAxis[0] * width * .25 * side];
    structure.push(beam([a[0], height + .12, a[1]], [b[0], height + .12, b[1]], .07));
  }
  const annex = libraryAnnexLayout(library), roomFloor = base + .24;
  const room = merged([slab(annex.footprint, roomFloor, height - .24)], true);
  const roof = merged([slab(annex.roof, height - .24, height)]);
  const steps: THREE.BufferGeometry[] = [];
  for (let step = 0; step < 3; step++) {
    steps.push(slab(annex.rectangle(annex.u0 - .3 * (3 - step), annex.u0 - .3 * (2 - step), annex.doorStart - .15, annex.doorEnd + .15), base, base + .08 * (step + 1)));
  }
  steps.push(slab(annex.footprint, base, roomFloor));
  const [a, b] = [annex.at(annex.u0 - .015, annex.doorStart), annex.at(annex.u0 - .015, annex.doorEnd)], bottom = roomFloor, top = height - .62;
  const door = new THREE.BoxGeometry(Math.hypot(b[0] - a[0], b[1] - a[1]), top - bottom, .03);
  door.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]));
  door.translate((a[0] + b[0]) / 2, (bottom + top) / 2, (a[1] + b[1]) / 2);
  for (const p of [a, b]) details.push(beam([p[0], bottom, p[1]], [p[0], top + .05, p[1]], .09));
  details.push(beam([a[0], top, a[1]], [b[0], top, b[1]], .09));
  for (let y = bottom + .12; y < top - .05; y += .18) {
    const from = annex.at(annex.u0 - .035, annex.doorStart + .06), to = annex.at(annex.u0 - .035, annex.doorEnd - .06);
    details.push(beam([from[0], y, from[1]], [to[0], y, to[1]], .035));
  }
  return { floor, end, canopy: merged(canopy, true), arches: merged(arches, true), beams: merged(structure), posts: merged(posts), room, roof, steps: merged(steps), door: merged([door]), details: merged(details) };
}

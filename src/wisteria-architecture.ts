import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import clip from 'polygon-clipping';
import type { Feature, Point, Shape } from './types';
import { pergolaLayout } from './garden-geometry.ts';
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
  const floor = merged(corridor.map(shape => slab(shape, base, base + .08)));
  const end = merged([slab(hub, base, height)], true);
  const inner = passageFootprint(route, width - .5);
  // Two curved edge beams and spaced crossbars leave the overhead trellis open.
  const edges = clip.difference(layout.footprint.map(polygon), polygon(inner), polygon(hub));
  for (const [outer, ...holes] of edges) structure.push(slab({ outer, holes }, height - .24, height));
  let distance = 0, nextCrossbar = 0, nextPost = .6;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1], b = route[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const at = (d: number, side: number): Point => [a[0] + dx * d / length - dz / length * side, a[1] + dz * d / length + dx / length * side];
    for (; nextCrossbar <= distance + length; nextCrossbar += 1.1) {
      const p = at(nextCrossbar - distance, 0);
      if (Math.hypot(p[0] - feature.pergola!.hub[0], p[1] - feature.pergola!.hub[1]) < feature.pergola!.hubRadius + .15) continue;
      const left = at(nextCrossbar - distance, -width / 2 + .1), right = at(nextCrossbar - distance, width / 2 - .1);
      structure.push(beam([left[0], height - .13, left[1]], [right[0], height - .13, right[1]], .16));
    }
    for (; nextPost <= distance + length; nextPost += 3.3) {
      const center = at(nextPost - distance, 0);
      if (Math.hypot(center[0] - feature.pergola!.hub[0], center[1] - feature.pergola!.hub[1]) < feature.pergola!.hubRadius + .15) continue;
      for (const side of [-1, 1]) {
        const p = at(nextPost - distance, side * (width / 2 - .18));
        posts.push(beam([p[0], base + .08, p[1]], [p[0], height - .24, p[1]], .24));
      }
    }
    distance += length;
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
  return { floor, end, beams: merged(structure), posts: merged(posts), room, roof, steps: merged(steps), door: merged([door]), details: merged(details) };
}

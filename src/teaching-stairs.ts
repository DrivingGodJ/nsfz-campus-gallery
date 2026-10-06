import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Building, BuildingPart, BuildingStairwell, Point, Shape } from './types';

type Section = BuildingPart & { height: number; floors: number };
type Vector = [number, number, number];
const BASE = .12, SLAB = .25, RAIL_HEIGHT = 1.02;

// u follows the flights; v crosses the two parallel flights. The same frame
// drives the floor openings and the stairs so changing floor height stays safe.
export function stairwellFrame(stair: BuildingStairwell) {
  const length = Math.hypot(...stair.axis), along = stair.axis.map(v => v / length) as Point;
  const across: Point = [-along[1], along[0]];
  const at = (u: number, v: number): Point => [stair.origin[0] + along[0] * u + across[0] * v, stair.origin[1] + along[1] * u + across[1] * v];
  return { along, across, at };
}

export function stairwellShaft(stair: BuildingStairwell): Shape {
  const { at } = stairwellFrame(stair), half = stair.width / 2;
  const outer = [at(stair.landingDepth, -half), at(stair.landingDepth, half), at(stair.landingDepth * 2 + stair.run, half), at(stair.landingDepth * 2 + stair.run, -half)];
  return { outer: [...outer, outer[0]], holes: [] };
}

function combine(parts: THREE.BufferGeometry[]) {
  const plain = parts.map(part => {
    const geometry = part.index ? part.toNonIndexed() : part.clone();
    geometry.deleteAttribute('uv'); return geometry;
  });
  const result = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
  // Keep the archive's open-corridor photo visibility through slim structure.
  result.userData.photoOcclusionMask = new Uint8Array(result.getAttribute('position').count / 3);
  return result;
}

function clippedProfile(points: Point[], limit: number) {
  return points.flatMap((p, i) => {
    const q = points[(i + 1) % points.length], inside = p[1] <= limit, nextInside = q[1] <= limit;
    const edge: Point[] = inside ? [p] : [];
    if (inside !== nextInside) edge.push([p[0] + (q[0] - p[0]) * (limit - p[1]) / (q[1] - p[1]), limit]);
    return edge;
  });
}

export function teachingStairGeometry(building: Building, sections: Section[], floorHeight: number, cutawayHeight?: number) {
  const concrete: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
  for (const stair of building.stairwells || []) {
    const section = sections.find(section => section.id === stair.partId);
    if (!section) continue;
    const shown = Math.min(section.height, cutawayHeight ?? section.height);
    const { at, along } = stairwellFrame(stair);
    const point = (u: number, v: number, y: number): Vector => { const [x, z] = at(u, v); return [x, BASE + y, z]; };
    const box = (u0: number, u1: number, v0: number, v1: number, bottom: number, top: number) => {
      top = Math.min(top, shown); if (top <= bottom) return;
      const geometry = new THREE.BoxGeometry(v1 - v0, top - bottom, u1 - u0);
      geometry.rotateY(Math.atan2(along[0], along[1]));
      concrete.push(geometry.translate(...point((u0 + u1) / 2, (v0 + v1) / 2, (bottom + top) / 2)));
    };
    const bar = (from: Vector, to: Vector) => {
      const limit = BASE + shown - .05;
      if (from[1] > limit && to[1] > limit) return;
      if (from[1] > limit) { const t = (limit - to[1]) / (from[1] - to[1]); from = from.map((v, i) => to[i] + (v - to[i]) * t) as Vector; }
      if (to[1] > limit) { const t = (limit - from[1]) / (to[1] - from[1]); to = to.map((v, i) => from[i] + (v - from[i]) * t) as Vector; }
      const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
      if (direction.length() < .001) return;
      const geometry = new THREE.BoxGeometry(.055, direction.length(), .055);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
      rails.push(geometry.translate(...a.add(b).multiplyScalar(.5).toArray()));
    };
    const guard = (u0: number, u1: number, v: number, y0: number, y1: number) => {
      for (const rise of [.48, RAIL_HEIGHT]) bar(point(u0, v, y0 + rise), point(u1, v, y1 + rise));
      const count = Math.max(1, Math.ceil(Math.abs(u1 - u0) / 1.25));
      for (let i = 0; i <= count; i++) {
        const t = i / count, u = u0 + (u1 - u0) * t, y = y0 + (y1 - y0) * t;
        bar(point(u, v, y), point(u, v, y + RAIL_HEIGHT));
      }
    };
    const flight = (u0: number, u1: number, v0: number, v1: number, bottom: number) => {
      const rise = floorHeight / 2, steps = stair.stepsPerFlight, tread = (u1 - u0) / steps;
      if (bottom >= shown) return;
      const profile: Point[] = [[u0, bottom - .22]];
      for (let i = 0; i < steps; i++) profile.push([u0 + i * tread, bottom + (i + 1) * rise / steps], [u0 + (i + 1) * tread, bottom + (i + 1) * rise / steps]);
      profile.push([u1, bottom + rise - .22]);
      const shape = new THREE.Shape(clippedProfile(profile, shown).map(p => new THREE.Vector2(...p)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: v1 - v0, bevelEnabled: false });
      // The extrusion's handedness matches u/y/v, so front faces stay outward.
      const vertices = geometry.getAttribute('position');
      for (let i = 0; i < vertices.count; i++) vertices.setXYZ(i, ...point(vertices.getX(i), v0 + vertices.getZ(i), vertices.getY(i)));
      geometry.computeVertexNormals(); concrete.push(geometry);
      for (const v of [v0 + .06, v1 - .06]) guard(u0, u1, v, bottom, bottom + rise);
    };
    const half = stair.width / 2, gap = .24, near = stair.landingDepth, far = near + stair.run;
    // Each storey uses the same two flights with a shared half-height landing.
    // There is no extra flight from the top floor through the retained roof.
    for (let level = 0; level < section.floors - 1 && level * floorHeight + SLAB < shown; level++) {
      const bottom = level * floorHeight + SLAB, middle = bottom + floorHeight / 2;
      // Start on the right-hand flight, then turn back onto the left-hand flight.
      flight(near, far, gap / 2, half, bottom);
      box(far, far + stair.landingDepth, -half, half, middle - .22, middle);
      flight(far, near, -half, -gap / 2, middle);
      for (const v of [-half + .06, half - .06]) guard(far, far + stair.landingDepth - .06, v, middle, middle);
      for (const rise of [.48, RAIL_HEIGHT]) bar(point(far + stair.landingDepth - .06, -half + .06, middle + rise), point(far + stair.landingDepth - .06, half - .06, middle + rise));
    }
    // Thin front supports, kept off the two flights, hold the rounded floor edge.
    for (const u of [.35, stair.landingDepth * 2 + stair.run - .35]) box(u - .15, u + .15, -half - .65, -half - .35, SLAB, shown);
    if (stair.entry) {
      const { edge, depth, steps } = stair.entry, a = section.outer[edge], b = section.outer[edge + 1];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]), direction: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      const area = section.outer.slice(1).reduce((sum, p, i) => sum + section.outer[i][0] * p[1] - p[0] * section.outer[i][1], 0);
      const inward: Point = [-direction[1] * Math.sign(area), direction[0] * Math.sign(area)];
      // The photographed entrance has three broad, low steps from the path.
      for (let i = 0; i < steps; i++) {
        const top = .095 + (BASE + SLAB - .095) * (i + 1) / steps;
        const distance = -depth * (1 - (i + .5) / steps);
        const geometry = new THREE.BoxGeometry(length, top - .095, depth / steps);
        geometry.rotateY(-Math.atan2(direction[1], direction[0]));
        concrete.push(geometry.translate((a[0] + b[0]) / 2 + inward[0] * distance, (.095 + top) / 2, (a[1] + b[1]) / 2 + inward[1] * distance));
      }
    }
  }
  return { concrete: combine(concrete), rails: combine(rails) };
}

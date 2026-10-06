import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingGeometry } from './building-geometry.ts';
import type { Building, BuildingPart, Feature, GroundPassage, Point, Shape } from './types';

type Section = BuildingPart & { height: number; floors: number };
type Vector = [number, number, number];
export const ARCHITECTURE_COLORS = { rail: '#7d9eaa', roof: '#929f9c', glass: '#87a6ad', frame: '#bac3bd' };
export const GYM_ID = 'local/gymnasium';
const BASE = .12;
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function combined(parts: THREE.BufferGeometry[], photoBlocking = true) {
  const plain = parts.map(part => {
    const geometry = part.index ? part.toNonIndexed() : part.clone();
    geometry.deleteAttribute('uv');
    return geometry;
  });
  const result = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
  if (!photoBlocking) result.userData.photoOcclusionMask = new Uint8Array(result.getAttribute('position').count / 3);
  return result;
}

function bar(from: Vector, to: Vector, width: number, depth = width) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a);
  const geometry = new THREE.BoxGeometry(width, direction.length(), depth);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  return geometry.translate(...a.add(b).multiplyScalar(.5).toArray());
}

function windowPanel(from: Point, to: Point, bottom: number, top: number) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const geometry = new THREE.BoxGeometry(Math.hypot(dx, dz), top - bottom, .045);
  geometry.rotateY(-Math.atan2(dz, dx));
  return geometry.translate((from[0] + to[0]) / 2, BASE + (bottom + top) / 2, (from[1] + to[1]) / 2);
}

// Adapt the archive's guard rails to the existing recessed corridors. Two thin
// rails and widely spaced posts keep the campus overview light and inexpensive.
export function teachingRailGeometry(building: Building, sections: Section[], floorHeight: number, cutawayHeight?: number) {
  const parts: THREE.BufferGeometry[] = [];
  for (const corridor of building.floorCorridors || []) {
    const section = sections.find(section => section.id === corridor.partId);
    if (!section || 'passageIndex' in corridor) continue;
    const ring = 'holeIndex' in corridor ? section.holes[corridor.holeIndex] : section.outer;
    const edges = 'holeIndex' in corridor ? Array.from({ length: ring.length - 1 }, (_, i) => i) : 'edge' in corridor ? [corridor.edge] : corridor.edges;
    const area = ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0);
    const inset = .09 * (area >= 0 ? 1 : -1) * ('holeIndex' in corridor ? 1 : -1);
    const height = Math.min(section.height, cutawayHeight ?? section.height);
    for (let floor = 1; floor * floorHeight + 1.3 < height; floor++) {
      const y = BASE + floor * floorHeight + .25;
      const posts = new Map<string, Point>();
      for (const edge of edges) {
        const a = ring[edge], b = ring[edge + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < .05) continue;
        const offset: Point = [(b[1] - a[1]) / length * inset, -(b[0] - a[0]) / length * inset];
        const from = a.map((v, i) => v + offset[i]) as Point, to = b.map((v, i) => v + offset[i]) as Point;
        for (const rise of [.5, 1.05]) parts.push(bar([from[0], y + rise, from[1]], [to[0], y + rise, to[1]], .055));
        const count = Math.max(1, Math.ceil(length / 2.7));
        for (let i = 0; i <= count; i++) {
          const point = lerp(from, to, i / count);
          posts.set(point.map(v => v.toFixed(2)).join(','), point);
        }
      }
      for (const [x, z] of posts.values()) parts.push(bar([x, y, z], [x, y + 1.075, z], .055));
    }
  }
  // Like the corridor slabs, these slim rails must not hide corridor photos.
  return combined(parts, false);
}

function gymAxes(building: Shape) {
  const [p0, p1, p2, p3] = building.outer;
  const length = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const width = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const along: Point = [(p2[0] - p1[0]) / length, (p2[1] - p1[1]) / length];
  const across: Point = [(p1[0] - p0[0]) / width, (p1[1] - p0[1]) / width];
  const at = (u: number, v: number): Point => [p0[0] + along[0] * u + across[0] * v, p0[1] + along[1] * u + across[1] * v];
  return { length, width, along, across, at, p0, p1, p2, p3 };
}

export function gymRoofHeight(height: number, progress: number) {
  const rise = Math.min(1.45, height * .1);
  return height - rise + rise * Math.sin(Math.PI * THREE.MathUtils.clamp(progress, 0, 1));
}

function extrudedWorld(shape: Shape, bottom: number, top: number, floorHeight: number, passages: GroundPassage[] = [], omitTop = false) {
  let geometry = buildingGeometry(shape, top - bottom, floorHeight, passages);
  if (omitTop) {
    const positions: number[] = [], vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i += 3) {
      if ([0, 1, 2].every(j => Math.abs(vertices.getZ(i + j) - (top - bottom)) < 1e-5)) continue;
      for (let j = 0; j < 3; j++) positions.push(vertices.getX(i + j), vertices.getY(i + j), vertices.getZ(i + j));
    }
    geometry.dispose(); geometry = surface(positions);
  }
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, BASE + bottom, 0);
  return geometry;
}

function face(positions: number[], a: Vector, b: Vector, c: Vector, d?: Vector) {
  positions.push(...a, ...b, ...c);
  if (d) positions.push(...a, ...c, ...d);
}
function surface(positions: number[]) {
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); return geometry;
}

export function gymArchitecture(building: Building, height: number, floorHeight: number, bridge?: Feature, cutawayHeight?: number) {
  const { length, width, along, across, at } = gymAxes(building);
  const wall = .38, roofThickness = .22;
  const inner = [at(wall, wall), at(wall, width - wall), at(length - wall, width - wall), at(length - wall, wall)];
  const shell: Shape = { outer: building.outer, holes: [[...inner, inner[0]]] };
  const roofBottom = gymRoofHeight(height, 0) - roofThickness;
  const shown = Math.min(height, cutawayHeight ?? height), parts: THREE.BufferGeometry[] = [];
  const connection = bridge?.connections?.find(c => c.type === 'deck' && c.buildingId === building.id);
  const entryHeight = ((connection?.floor ?? 2) - 1) * floorHeight;
  const entry = connection ? { id: connection.id, sourcePathId: '', width: 3.2, points: [connection.points[0], lerp(connection.points[0], connection.points[1], 2.6)] } : undefined;
  const front = at(length / 2, 0);
  const groundDoor: GroundPassage = { id: 'gym-door', sourcePathId: '', width: 2.8,
    points: [front.map((v, i) => v - across[i] * 2) as Point, front.map((v, i) => v + across[i] * 2) as Point] };
  const wallTop = Math.min(roofBottom, shown);
  // Split at both ends of the doorway, including a bridge entering at a half floor.
  const boundaries = [0, wallTop, entryHeight, entryHeight + floorHeight];
  for (let level = floorHeight; level < wallTop; level += floorHeight) boundaries.push(level);
  const levels = [...new Set(boundaries.filter(y => y >= 0 && y <= wallTop))].sort((a, b) => a - b);
  for (let i = 0; i < levels.length - 1; i++) {
    const bottom = levels[i], top = levels[i + 1];
    const cuts = [...(bottom < floorHeight ? [groundDoor] : []), ...(bottom >= entryHeight && top <= entryHeight + floorHeight && entry ? [entry] : [])];
    parts.push(extrudedWorld(shell, bottom, top, floorHeight, cuts, top < wallTop - 1e-6));
  }
  parts.push(extrudedWorld({ outer: building.outer, holes: [] }, 0, Math.min(.16, shown), floorHeight));
  // Keep the internal landing level with the bridge, including half-floor entries.
  if (entry && entryHeight > .05 && shown > entryHeight + .05) {
    const landing = connection!.points.at(-1)!, corners = [-1, 1].flatMap(side => [
      landing.map((v, i) => v + along[i] * side * 1.6) as Point,
      landing.map((v, i) => v + along[i] * side * 1.6 + across[i] * 2.5) as Point,
    ]);
    parts.push(extrudedWorld({ outer: [corners[0], corners[2], corners[3], corners[1], corners[0]], holes: [] }, entryHeight - .22, entryHeight, floorHeight));
  }
  const body = combined(parts), roofPositions: number[] = [], crownPositions: number[] = [];
  const roofVisible = shown >= height - 1e-6;
  if (roofVisible) {
    for (let i = 0; i < 24; i++) {
      const u0 = length * i / 24, u1 = length * (i + 1) / 24;
      const h0 = BASE + gymRoofHeight(height, i / 24), h1 = BASE + gymRoofHeight(height, (i + 1) / 24);
      const point = (u: number, v: number, y: number): Vector => { const p = at(u, v); return [p[0], y, p[1]]; };
      const a = point(u0, -.65, h0), b = point(u1, -.65, h1), c = point(u1, width + .65, h1), d = point(u0, width + .65, h0);
      const below = (p: Vector): Vector => [p[0], p[1] - roofThickness, p[2]];
      face(roofPositions, a, b, c, d); face(roofPositions, below(a), below(d), below(c), below(b));
      face(roofPositions, a, below(a), below(b), b); face(roofPositions, d, c, below(c), below(d));
      if (i === 0) face(roofPositions, a, d, below(d), below(a));
      if (i === 23) face(roofPositions, b, below(b), below(c), c);
      for (const v of [0, width]) {
        const q0 = point(u0, v, BASE + roofBottom), q1 = point(u1, v, BASE + roofBottom);
        const t0 = point(u0, v, h0 - roofThickness), t1 = point(u1, v, h1 - roofThickness);
        if (v === 0) face(crownPositions, q0, q1, t1, t0); else face(crownPositions, q1, q0, t0, t1);
        const inset = v === 0 ? wall : -wall;
        const inner0 = point(u0, v + inset, h0 - roofThickness), inner1 = point(u1, v + inset, h1 - roofThickness);
        if (v === 0) face(crownPositions, point(u1, v + inset, BASE + roofBottom), point(u0, v + inset, BASE + roofBottom), inner0, inner1);
        else face(crownPositions, point(u0, v + inset, BASE + roofBottom), point(u1, v + inset, BASE + roofBottom), inner1, inner0);
      }
    }
  }
  const walls = crownPositions.length ? combined([body, surface(crownPositions)]) : body;
  const glassParts: THREE.BufferGeometry[] = [], frameParts: THREE.BufferGeometry[] = [];
  const windowBottom = height * .69, windowTop = height * .82;
  if (shown >= windowTop) {
    for (const v of [-.035, width + .035]) {
      const from = at(.7, v), to = at(length - .7, v);
      glassParts.push(windowPanel(from, to, windowBottom, windowTop));
      for (const y of [windowBottom, windowTop]) frameParts.push(bar([from[0], BASE + y, from[1]], [to[0], BASE + y, to[1]], .08));
      const count = Math.ceil(length / 5);
      for (let i = 0; i <= count; i++) {
        const p = lerp(from, to, i / count);
        frameParts.push(bar([p[0], BASE + windowBottom, p[1]], [p[0], BASE + windowTop, p[1]], .065));
      }
    }
  }
  // Body uses the same extrusion axes as BuildingMesh; decoration stays in world axes.
  walls.translate(0, -BASE, 0); walls.rotateX(Math.PI / 2);
  return { body: walls, roof: surface(roofPositions), glass: combined(glassParts), frame: combined(frameParts) };
}

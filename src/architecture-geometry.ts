import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingCoreFootprint, buildingGeometry, passageShape } from './building-geometry.ts';
import { classroomWindowLayout } from './teaching-classrooms.ts';
import { GYM_WALL, gymFrame, gymStairGeometry, gymWindowOpenings } from './gym-interior.ts';
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
    const edges = 'holeIndex' in corridor ? Array.from({ length: ring.length - 1 }, (_, i) => i) : 'edge' in corridor ? [corridor.edge] : 'edges' in corridor ? corridor.edges : [];
    const segments = 'points' in corridor ? (corridor.railEdges || []).flatMap(points => points.slice(1).map((to, i) => [points[i], to])) : edges.map(edge => [ring[edge], ring[edge + 1]]);
    const area = ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0);
    const inset = 'points' in corridor ? -.09 : .09 * (area >= 0 ? 1 : -1) * ('holeIndex' in corridor ? 1 : -1);
    const height = Math.min(section.height, cutawayHeight ?? section.height);
    for (let floor = 1; floor * floorHeight + 1.3 < height; floor++) {
      const y = BASE + floor * floorHeight + .25;
      const posts = new Map<string, Point>();
      for (const [a, b] of segments) {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
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

export function teachingWindowGeometry(building: Building, sections: Section[], floorHeight: number, cutawayHeight?: number) {
  const glass: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [], config = building.classroomWindows;
  if (config) for (const section of sections) {
    const height = Math.min(section.height, cutawayHeight ?? section.height);
    const solids = (building.solidCores || []).filter(core => core.partId === section.id);
    const core = buildingCoreFootprint(section, building.groundPassages || [], (building.floorCorridors || []).filter(corridor => corridor.partId === section.id), (building.stairwells || []).filter(stair => stair.partId === section.id), solids, (building.cutouts || []).filter(cut => cut.partId === section.id));
    const groundOpenings = (building.groundPassages || []).map(passage => { const shape = passageShape(passage); return [shape.outer, ...shape.holes]; });
    for (const { from, to, bottom, top } of classroomWindowLayout(core, config, height, floorHeight, groundOpenings, solids.map(core => [core.outer, ...core.holes]))) {
      glass.push(windowPanel(from, to, bottom, top));
      const y0 = BASE + bottom, y1 = BASE + top;
      for (const y of [y0, y1 - Math.min(config.transom, (top - bottom) / 3), y1]) frames.push(bar([from[0], y, from[1]], [to[0], y, to[1]], .055));
      for (let column = 0; column <= config.columns; column++) {
        const point = lerp(from, to, column / config.columns);
        frames.push(bar([point[0], y0, point[1]], [point[0], y1, point[1]], .055));
      }
    }
  }
  return { glass: combined(glass, false), frames: combined(frames, false) };
}

export function teachingElevatorGeometry(building: Building, sections: Section[], floorHeight: number, cutawayHeight?: number) {
  const glass: THREE.BufferGeometry[] = [], doors: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [];
  for (const core of building.solidCores || []) {
    if (!core.elevator) continue;
    const section = sections.find(section => section.id === core.partId);
    if (!section) continue;
    const height = Math.min(section.height, cutawayHeight ?? section.height), bottom = ((core.startFloor ?? 1) - 1) * floorHeight + .25, top = height - .25;
    if (top <= bottom) continue;
    for (let edge = 0; edge < core.outer.length - 1; edge++) {
      const from = core.outer[edge], to = core.outer[edge + 1];
      frames.push(bar([from[0], BASE + bottom, from[1]], [from[0], BASE + top, from[1]], .07));
      frames.push(bar([from[0], BASE + top, from[1]], [to[0], BASE + top, to[1]], .06));
      for (let floor = core.startFloor ?? 1; (floor - 1) * floorHeight + .25 < top; floor++) {
        const y0 = (floor - 1) * floorHeight + .25, y1 = Math.min(floor * floorHeight + .25, top);
        frames.push(bar([from[0], BASE + y0, from[1]], [to[0], BASE + y0, to[1]], .06));
        if (edge !== core.elevator.doorEdge) { glass.push(windowPanel(from, to, y0, y1)); continue; }
        const length = Math.hypot(to[0] - from[0], to[1] - from[1]), width = Math.min(1.4, length * .7);
        const a = lerp(from, to, .5 - width / length / 2), b = lerp(from, to, .5 + width / length / 2), middle = lerp(a, b, .5);
        const doorTop = Math.min(y0 + 2.2, y1);
        glass.push(windowPanel(from, a, y0, y1), windowPanel(b, to, y0, y1));
        if (doorTop < y1) glass.push(windowPanel(a, b, doorTop, y1));
        doors.push(windowPanel(a, middle, y0, doorTop), windowPanel(middle, b, y0, doorTop));
        frames.push(bar([a[0], BASE + doorTop, a[1]], [b[0], BASE + doorTop, b[1]], .09));
        for (const p of [a, b]) frames.push(bar([p[0], BASE + y0, p[1]], [p[0], BASE + doorTop, p[1]], .08));
        frames.push(bar([middle[0], BASE + y0, middle[1]], [middle[0], BASE + doorTop, middle[1]], .035));
      }
    }
  }
  return { glass: combined(glass, false), doors: combined(doors, false), frames: combined(frames, false) };
}

export function gymRoofHeight(height: number, progress: number) {
  const rise = Math.min(1.45, height * .1);
  return height - rise + (rise + 1.2) * Math.sin(Math.PI * THREE.MathUtils.clamp(progress, 0, 1));
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
  const frame = gymFrame(building), { length, width, across, at } = frame;
  const wall = GYM_WALL, roofThickness = .22;
  const inner = [at(wall, wall), at(wall, width - wall), at(length - wall, width - wall), at(length - wall, wall)];
  const shell: Shape = { outer: building.outer, holes: [[...inner, inner[0]]] };
  const roofBottom = gymRoofHeight(height, 0) - roofThickness;
  const shown = Math.min(height, cutawayHeight ?? height), parts: THREE.BufferGeometry[] = [];
  const connection = bridge?.connections?.find(c => c.type === 'deck' && c.buildingId === building.id);
  const entryHeight = ((connection?.floor ?? 2) - 1) * floorHeight;
  const entry = connection ? { id: connection.id, sourcePathId: '', width: 3.2, points: [connection.points[0], lerp(connection.points[0], connection.points[1], 2.6)] } : undefined;
  const doorTop = Math.min(2.85, floorHeight - .35);
  const groundDoors = [-2.1, 0, 2.1].map(offset => {
    const front = at(length / 2 + offset, 0);
    return { id: `gym-door-${offset}`, sourcePathId: '', width: 1.65,
      points: [front.map((v, i) => v - across[i] * 2) as Point, front.map((v, i) => v + across[i] * 2) as Point] };
  });
  const wallTop = Math.min(roofBottom, shown);
  const windows = gymWindowOpenings(frame, height, floorHeight, roofBottom, connection && {
    u: frame.local(connection.points[0])[0], width: 3.32, bottom: entryHeight, top: entryHeight + floorHeight
  });
  // Split at both ends of the doorway, including a bridge entering at a half floor.
  const boundaries = [0, wallTop, doorTop, entryHeight, entryHeight + floorHeight];
  for (const window of windows) boundaries.push(window.bottom, window.top);
  for (let level = floorHeight; level < wallTop; level += floorHeight) boundaries.push(level);
  const levels = [...new Set(boundaries.filter(y => y >= 0 && y <= wallTop))].sort((a, b) => a - b);
  for (let i = 0; i < levels.length - 1; i++) {
    const bottom = levels[i], top = levels[i + 1];
    const cuts = [...(top <= doorTop ? groundDoors : []), ...(bottom >= entryHeight && top <= entryHeight + floorHeight && entry ? [entry] : []),
      ...windows.filter(window => bottom >= window.bottom - 1e-6 && top <= window.top + 1e-6).map(window => window.cut)];
    parts.push(extrudedWorld(shell, bottom, top, floorHeight, cuts, top < wallTop - 1e-6));
  }
  parts.push(extrudedWorld({ outer: building.outer, holes: [] }, 0, Math.min(.16, shown), floorHeight));
  const body = combined(parts), roofPositions: number[] = [];
  const glassParts: THREE.BufferGeometry[] = [], frameParts: THREE.BufferGeometry[] = [];
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
        const pane: number[] = [];
        if (v === 0) face(pane, q0, q1, t1, t0); else face(pane, q1, q0, t0, t1);
        glassParts.push(surface(pane));
        frameParts.push(bar(t0, t1, .07));
        if (i > 0) frameParts.push(bar(point(u0, v, BASE + height - 2.8), t0, .08));
      }
    }
  }
  for (const window of windows) {
    const { from, to, bottom } = window, top = Math.min(window.top, shown);
    if (top <= bottom) continue;
    glassParts.push(windowPanel(from, to, bottom, top));
    const tall = window.cut.id.startsWith('gym-tower-');
    const crossbars = tall ? [bottom, top, ...Array.from({ length: Math.ceil(height / floorHeight) }, (_, i) => i * floorHeight).filter(y => y > bottom && y < top)] : [bottom, top, bottom + (top - bottom) * .3];
    for (const y of crossbars) frameParts.push(bar([from[0], BASE + y, from[1]], [to[0], BASE + y, to[1]], .07));
    const count = Math.max(2, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 3.5));
    for (let i = 0; i <= count; i++) {
      const p = lerp(from, to, i / count);
      frameParts.push(bar([p[0], BASE + bottom, p[1]], [p[0], BASE + top, p[1]], .06));
    }
  }
  // Three recessed ground-floor entrances sit between the low front windows.
  for (const offset of [-2.1, 0, 2.1]) {
    const u = length / 2 + offset, top = Math.min(doorTop, shown);
    if (top <= .16) continue;
    const a = at(u - .825, .22), b = at(u + .825, .22);
    glassParts.push(windowPanel(a, b, .16, top));
    frameParts.push(bar([a[0], BASE + top, a[1]], [b[0], BASE + top, b[1]], .09));
    for (const p of [a, lerp(a, b, .5), b]) frameParts.push(bar([p[0], BASE + .16, p[1]], [p[0], BASE + top, p[1]], .07));
  }
  if (!roofVisible) for (const geometry of frameParts) {
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) vertices.setY(i, Math.min(vertices.getY(i), BASE + shown));
  }
  // Body uses the same extrusion axes as BuildingMesh; decoration stays in world axes.
  body.translate(0, -BASE, 0); body.rotateX(Math.PI / 2);
  return { body, roof: surface(roofPositions), glass: combined(glassParts, false), frame: combined(frameParts, false), ...gymStairGeometry(frame, height, floorHeight, cutawayHeight) };
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingCoreFootprint, buildingGeometry, passageShape } from './building-geometry.ts';
import { classroomWindowLayout, solidCoreWindowLayout, type ClassroomWindow } from './teaching-classrooms.ts';
import { GYM_WALL, gymFrame, gymStairGeometry, gymWindowOpenings } from './gym-interior.ts';
import { bridgeHeight } from './structure-geometry.ts';
import type { Building, BuildingPart, ClassroomWindows, Feature, GroundPassage, Point, Shape } from './types';

type Section = BuildingPart & { height: number; floors: number };
type Vector = [number, number, number];
export const ARCHITECTURE_COLORS = { rail: '#7d9eaa', roof: '#929f9c', glass: '#87a6ad', frame: '#bac3bd' };
export const GYM_ID = 'local/gymnasium';
const BASE = .12;
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function combined(parts: THREE.BufferGeometry[], photoBlocking = true) {
  const plain = parts.filter(part => part.getAttribute('position')?.count).map(part => {
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

export { combined as architectureBatch, bar as architectureBar };

function windowPanel(from: Point, to: Point, bottom: number, top: number) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const geometry = new THREE.BoxGeometry(Math.hypot(dx, dz), top - bottom, .045);
  geometry.rotateY(-Math.atan2(dz, dx));
  return geometry.translate((from[0] + to[0]) / 2, BASE + (bottom + top) / 2, (from[1] + to[1]) / 2);
}

// Ground-floor guards must leave the same openings as the road and walls.
function outsideOpenings(from: Point, to: Point, openings: Shape[]): [Point, Point][] {
  const dx = to[0] - from[0], dz = to[1] - from[1], cuts = [0, 1];
  const inside = (p: Point, ring: Point[]) => {
    let result = false;
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result;
    }
    return result;
  };
  for (const shape of openings) for (const ring of [shape.outer, ...shape.holes]) for (let i = 1; i < ring.length; i++) {
    const a = ring[i - 1], b = ring[i], ex = b[0] - a[0], ez = b[1] - a[1], divisor = dx * ez - dz * ex;
    if (Math.abs(divisor) < 1e-8) continue;
    const ax = a[0] - from[0], az = a[1] - from[1];
    const t = (ax * ez - az * ex) / divisor, s = (ax * dz - az * dx) / divisor;
    if (t > 0 && t < 1 && s >= 0 && s <= 1) cuts.push(t);
  }
  cuts.sort((a, b) => a - b);
  return cuts.slice(1).flatMap((end, i) => {
    const start = cuts[i], middle = lerp(from, to, (start + end) / 2);
    return end - start < 1e-8 || openings.some(shape => inside(middle, shape.outer) && !shape.holes.some(hole => inside(middle, hole)))
      ? [] : [[lerp(from, to, start), lerp(from, to, end)] as [Point, Point]];
  });
}

// Adapt the archive's guard rails to the existing recessed corridors. Two thin
// rails and widely spaced posts keep the campus overview light and inexpensive.
export function teachingRailGeometry(building: Building, sections: Section[], floorHeight: number, cutawayHeight?: number) {
  const parts: THREE.BufferGeometry[] = [];
  const groundOpenings = (building.groundPassages || []).map(passageShape);
  const corridors = [...(building.floorCorridors || []), ...sections.filter(section => section.roofTerrace).map(section => ({
    partId: section.id, depth: 0, startFloor: section.floors + 1, points: [] as Point[], railEdges: section.roofTerrace!.railEdges, rooftop: true,
  }))];
  for (const corridor of corridors) {
    const section = sections.find(section => section.id === corridor.partId);
    if (!section || 'passageIndex' in corridor) continue;
    const ring = 'holeIndex' in corridor ? section.holes[corridor.holeIndex] : section.outer;
    const edges = 'holeIndex' in corridor ? Array.from({ length: ring.length - 1 }, (_, i) => i) : 'edge' in corridor ? [corridor.edge] : 'edges' in corridor ? corridor.edges : [];
    const segments = 'points' in corridor ? (corridor.railEdges || []).flatMap(points => points.slice(1).map((to, i) => [points[i], to])) : edges.map(edge => [ring[edge], ring[edge + 1]]);
    const area = ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0);
    const inset = 'points' in corridor ? -.09 : .09 * (area >= 0 ? 1 : -1) * ('holeIndex' in corridor ? 1 : -1);
    const rooftop = 'rooftop' in corridor;
    const height = Math.min(section.height + (rooftop ? floorHeight : 0), cutawayHeight ?? Infinity);
    for (let floor = (corridor.startFloor ?? 2) - 1; floor * floorHeight + 1.3 < height; floor++) {
      const y = BASE + (rooftop ? section.height : floor * floorHeight + .25);
      const posts = new Map<string, Point>();
      for (const [a, b] of segments) {
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length < .05) continue;
        const offset: Point = [(b[1] - a[1]) / length * inset, -(b[0] - a[0]) / length * inset];
        const from = a.map((v, i) => v + offset[i]) as Point, to = b.map((v, i) => v + offset[i]) as Point;
        for (const [start, end] of outsideOpenings(from, to, floor === 0 ? groundOpenings : [])) {
          for (const rise of [.5, 1.05]) parts.push(bar([start[0], y + rise, start[1]], [end[0], y + rise, end[1]], .055));
          const count = Math.max(1, Math.ceil(Math.hypot(end[0] - start[0], end[1] - start[1]) / 2.7));
          for (let i = 0; i <= count; i++) {
            const point = lerp(start, end, i / count);
            posts.set(point.map(v => v.toFixed(2)).join(','), point);
          }
        }
      }
      for (const [x, z] of posts.values()) parts.push(bar([x, y, z], [x, y + 1.075, z], .055));
    }
  }
  // Like the corridor slabs, these slim rails must not hide corridor photos.
  return combined(parts, false);
}

export function teachingWindowGeometry(building: Building, sections: Section[], floorHeight: number, cutawayHeight?: number) {
  const windows: ClassroomWindow[] = [], config = building.classroomWindows;
  if (config) for (const section of sections) {
    const height = Math.min(section.height, cutawayHeight ?? section.height);
    const solids = (building.solidCores || []).filter(core => core.partId === section.id);
    const stairs = (building.stairwells || []).filter(stair => stair.partId === section.id);
    const core = buildingCoreFootprint(section, building.groundPassages || [], (building.floorCorridors || []).filter(corridor => corridor.partId === section.id), stairs, solids, (building.cutouts || []).filter(cut => cut.partId === section.id));
    const groundOpenings = (building.groundPassages || []).map(passage => { const shape = passageShape(passage); return [shape.outer, ...shape.holes]; });
    const windowExclusions = [...solids.map(core => [core.outer, ...core.holes]), ...stairs.filter(stair => stair.internal).map(stair => [stair.opening.outer, ...stair.opening.holes])];
    windows.push(...classroomWindowLayout(core, config, height, floorHeight, groundOpenings, windowExclusions));
    windows.push(...solidCoreWindowLayout(solids, height, floorHeight));
  }
  return classroomGlazingGeometry(windows, config);
}

export function classroomGlazingGeometry(windows: ClassroomWindow[], config?: ClassroomWindows) {
  const glass: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [];
  const panel = (from: Point, to: Point, bottom: number, top: number, frame = false, vertical = false) => {
    const dx = to[0] - from[0], dz = to[1] - from[1], width = Math.hypot(dx, dz), height = top - bottom;
    let geometry: THREE.BufferGeometry = new THREE.PlaneGeometry(width, height);
    if (frame) {
      // Keep the front and two long side faces. End caps are covered by the
      // meeting bars/wall jamb, and a double-sided front also reads from inside.
      // Six triangles replace twelve for every 55 mm repeated metal member.
      const indexed = new THREE.BoxGeometry(width, height, .055), box = indexed.toNonIndexed(); indexed.dispose();
      const positions = box.getAttribute('position'), normals = box.getAttribute('normal'), p: number[] = [], n: number[] = [];
      for (let i = 0; i < positions.count; i += 3) if (normals.getZ(i) > .5 || Math.abs(vertical ? normals.getX(i) : normals.getY(i)) > .5) {
        for (let j = 0; j < 3; j++) { p.push(positions.getX(i + j), positions.getY(i + j), positions.getZ(i + j)); n.push(normals.getX(i + j), normals.getY(i + j), normals.getZ(i + j)); }
      }
      geometry.dispose(); box.dispose();
      geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(p, 3)).setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
    }
    return geometry.rotateY(-Math.atan2(dz, dx)).translate((from[0] + to[0]) / 2, BASE + (bottom + top) / 2, (from[1] + to[1]) / 2);
  };
  if (config) for (const { from, to, bottom, top, mullions, upperMullions } of windows) {
      glass.push(panel(from, to, bottom, top));
      const transoms = config.transomFractions
        ? config.transomFractions.filter(f => Number.isFinite(f) && f > 0 && f < 1).map(f => bottom + (top - bottom) * f)
        : [top - Math.min(config.transom, (top - bottom) / 3)];
      for (const y of [bottom, ...transoms, top]) frames.push(panel(from, to, y - .0275, y + .0275, true));
      const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
      const lower = mullions ?? Array.from({ length: config.columns + 1 }, (_, column) => column / config.columns);
      const divider = top - Math.min(config.transom, (top - bottom) / 3);
      const verticals = upperMullions
        ? [...lower.map(fraction => ({ fraction, low: bottom, high: divider })), ...upperMullions.map(fraction => ({ fraction, low: divider, high: top }))]
        : lower.map(fraction => ({ fraction, low: bottom, high: top }));
      for (const { fraction, low, high } of verticals) {
        const point = lerp(from, to, fraction);
        const left: Point = [point[0] - dx / length * .0275, point[1] - dz / length * .0275], right: Point = [point[0] + dx / length * .0275, point[1] + dz / length * .0275];
        frames.push(panel(left, right, low, high, true, true));
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
  // A fixed bridge remains in place when the gym's ground level changes.
  const entryHeight = connection && bridge ? bridgeHeight(bridge, [building], {
    [building.id]: { name: building.name, floors: Math.ceil(height / floorHeight), floorHeight }
  }) - (building.baseElevation ?? 0) - BASE : floorHeight / 2;
  const entryU = connection ? frame.local(connection.points[0])[0] : 0;
  const entry = connection ? { id: connection.id, sourcePathId: '', width: 3.2, points: [connection.points[0], lerp(connection.points[0], connection.points[1], 2.6)] } : undefined;
  const doorTop = Math.min(2.85, floorHeight - .35);
  const groundDoors = [-2.1, 0, 2.1].map(offset => {
    const front = at(length / 2 + offset, 0);
    return { id: `gym-door-${offset}`, sourcePathId: '', width: 1.65,
      points: [front.map((v, i) => v - across[i] * 2) as Point, front.map((v, i) => v + across[i] * 2) as Point] };
  });
  const wallTop = Math.min(roofBottom, shown);
  const windows = gymWindowOpenings(frame, height, floorHeight, roofBottom, connection && {
    u: entryU, width: 3.32, bottom: entryHeight, top: entryHeight + floorHeight
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
  const roofVisible = cutawayHeight === undefined || cutawayHeight > height + 1e-6;
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
        const t0 = point(u0, v, h0 - roofThickness), t1 = point(u1, v, h1 - roofThickness);
        const pane: number[] = [];
        const cuts = [u0, u1];
        if (entry && v === 0 && roofBottom < entryHeight + floorHeight) {
          for (const u of [entryU - 3.32 / 2, entryU + 3.32 / 2]) if (u > u0 && u < u1) cuts.push(u);
        }
        cuts.sort((a, b) => a - b);
        const topAt = (u: number) => t0[1] + (t1[1] - t0[1]) * (u - u0) / (u1 - u0);
        for (let n = 1; n < cuts.length; n++) {
          let from = cuts[n - 1], to = cuts[n];
          const inDoor = entry && v === 0 && Math.abs((from + to) / 2 - entryU) < 3.32 / 2;
          const bottom = BASE + Math.max(roofBottom, inDoor ? entryHeight + floorHeight : 0);
          if (Math.max(topAt(from), topAt(to)) <= bottom + 1e-6) continue;
          if (topAt(from) < bottom) from = u0 + (bottom - t0[1]) * (u1 - u0) / (t1[1] - t0[1]);
          if (topAt(to) < bottom) to = u0 + (bottom - t0[1]) * (u1 - u0) / (t1[1] - t0[1]);
          const corners = [point(from, v, bottom), point(to, v, bottom), point(to, v, topAt(to)), point(from, v, topAt(from))];
          const polygon = corners.filter((p, i) => Math.hypot(...p.map((value, axis) => value - corners[(i + 1) % corners.length][axis])) > 1e-6);
          if (v !== 0) polygon.reverse();
          for (let j = 1; j < polygon.length - 1; j++) face(pane, polygon[0], polygon[j], polygon[j + 1]);
        }
        glassParts.push(surface(pane));
        frameParts.push(bar(t0, t1, .07));
        if (i > 0) {
          const inDoor = entry && v === 0 && Math.abs(u0 - entryU) < 3.32 / 2;
          const bottom = BASE + Math.max(height - 2.8, inDoor ? entryHeight + floorHeight : 0);
          if (bottom < t0[1] - 1e-6) frameParts.push(bar(point(u0, v, bottom), t0, .08));
        }
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
  return { body, roof: surface(roofPositions), glass: combined(glassParts, false), frame: combined(frameParts, false), ...gymStairGeometry(frame, height, floorHeight, cutawayHeight, entryHeight) };
}

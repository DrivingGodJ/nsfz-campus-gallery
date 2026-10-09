import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { basketballGeometry } from './basketball-geometry.ts';
import type { GroundPassage, Point, Shape } from './types';

const BASE = .12;
export const GYM_WALL = .38;
type Vector = [number, number, number];

export function gymFrame(building: Shape) {
  const [p0, p1, p2] = building.outer;
  const length = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  const width = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const along: Point = [(p2[0] - p1[0]) / length, (p2[1] - p1[1]) / length];
  const across: Point = [(p1[0] - p0[0]) / width, (p1[1] - p0[1]) / width];
  const at = (u: number, v: number): Point => [p0[0] + along[0] * u + across[0] * v, p0[1] + along[1] * u + across[1] * v];
  const local = (p: Point): Point => {
    const x = p[0] - p0[0], z = p[1] - p0[1], determinant = along[0] * across[1] - along[1] * across[0];
    return [(x * across[1] - z * across[0]) / determinant, (along[0] * z - along[1] * x) / determinant];
  };
  return { length, width, along, across, at, local };
}
type Frame = ReturnType<typeof gymFrame>;

// The outside photo shows two tall glass bays and a clerestory over a largely
// solid front facade. The interior panorama shows three bays on the short end.
export function gymWindowOpenings(frame: Frame, height: number, floorHeight: number, wallTop: number, entry?: { u: number; width: number; bottom: number; top: number }) {
  const { length, width, at } = frame;
  const windows: { from: Point; to: Point; bottom: number; top: number; cut: GroundPassage }[] = [];
  const add = (id: string, u0: number, v0: number, u1: number, v1: number, bottom: number, top: number): void => {
    if (top - bottom < .2 || Math.hypot(u1 - u0, v1 - v0) < .1) return;
    // Every front pane respects the fixed bridge door, including a high window
    // row that can overlap it when the editable gym has only two storeys.
    if (entry && v0 === 0 && v1 === 0 && top > entry.bottom && bottom < entry.top &&
      u0 < entry.u + entry.width / 2 && u1 > entry.u - entry.width / 2) {
      add(`${id}-below`, u0, 0, u1, 0, bottom, Math.min(top, entry.bottom));
      add(`${id}-above`, u0, 0, u1, 0, Math.max(bottom, entry.top), top);
      const overlapBottom = Math.max(bottom, entry.bottom), overlapTop = Math.min(top, entry.top);
      const left = Math.min(u1, entry.u - entry.width / 2), right = Math.max(u0, entry.u + entry.width / 2);
      if (left > u0) add(`${id}-beside-left`, u0, 0, left, 0, overlapBottom, overlapTop);
      if (right < u1) add(`${id}-beside-right`, right, 0, u1, 0, overlapBottom, overlapTop);
      return;
    }
    const from = at(u0, v0), to = at(u1, v1);
    const du = u1 - u0, dv = v1 - v0;
    const cut = Math.abs(dv) > Math.abs(du)
      ? [at(u0 - 1, (v0 + v1) / 2), at(u0 + 1, (v0 + v1) / 2)]
      : [at((u0 + u1) / 2, v0 - 1), at((u0 + u1) / 2, v0 + 1)];
    windows.push({ from, to, bottom, top, cut: { id, sourcePathId: '', width: Math.hypot(to[0] - from[0], to[1] - from[1]), points: cut } });
  };
  const pier = .65, margin = .9, bayWidth = (width - margin * 2 - pier * 2) / 3;
  for (let floor = 0; floor * floorHeight < wallTop; floor++) {
    const bottom = floor * floorHeight + .55, top = Math.min((floor + 1) * floorHeight - .42, wallTop - .12);
    for (let bay = 0; bay < 3; bay++) {
      const v = margin + bay * (bayWidth + pier);
      add(`gym-end-window-${floor}-${bay}`, length, v, length, v + bayWidth, bottom, top);
    }
  }
  const clerestory = height - 2.8;
  for (const [id, u0, u1] of [['left', .9, 5.4], ['right', length - 8.2, length - 3.7]] as const) {
    add(`gym-tower-${id}`, u0, 0, u1, 0, .55, clerestory);
  }
  const entrance = length / 2;
  for (const u of [10, 17, 24, entrance - 7, entrance + 7, length - 22, length - 15]) {
    add(`gym-ground-window-${u}`, u - 1.4, 0, u + 1.4, 0, .55, Math.min(floorHeight - .6, clerestory));
  }
  add('gym-clerestory-front', .9, 0, length - .9, 0, clerestory, wallTop);
  add('gym-clerestory-back', .9, width, length - .9, width, clerestory, wallTop);
  return windows;
}

export function gymStairLayout(frame: Frame) {
  return { u0: frame.length - 10.1, u1: frame.length - 3.7, near: 9.2, far: 5, gap: .24, steps: 12, bayStart: frame.length - 12.3 };
}

function combined(parts: THREE.BufferGeometry[], blocksPhotos = false) {
  const plain = parts.map(part => {
    const geometry = part.index ? part.toNonIndexed() : part.clone();
    geometry.deleteAttribute('uv'); return geometry;
  });
  const result = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
  // Thin flights, landing slabs and glazing do not hide the archive's photos.
  if (!blocksPhotos) result.userData.photoOcclusionMask = new Uint8Array(result.getAttribute('position').count / 3);
  return result;
}

function clippedProfile(points: Point[], top: number) {
  return points.flatMap((p, i) => {
    const q = points[(i + 1) % points.length], inside = p[1] <= top, nextInside = q[1] <= top;
    return [...(inside ? [p] : []), ...(inside !== nextInside ? [[p[0] + (q[0] - p[0]) * (top - p[1]) / (q[1] - p[1]), top] as Point] : [])];
  });
}

export function gymStairGeometry(frame: Frame, height: number, floorHeight: number, cutawayHeight?: number, entryHeight = floorHeight / 2) {
  const { at, length, width, along } = frame, layout = gymStairLayout(frame);
  const { u0, u1, near, far, gap, steps, bayStart } = layout, middleU = (u0 + u1) / 2;
  const shown = Math.min(height, cutawayHeight ?? height), floors = Math.ceil(height / floorHeight);
  const concrete: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  const court: THREE.BufferGeometry[] = [], courtLines: number[] = [];
  const point = (u: number, v: number, y: number): Vector => { const p = at(u, v); return [p[0], BASE + y, p[1]]; };
  const slab = (a: number, b: number, c: number, d: number, top: number, parts = concrete) => {
    if (cutawayHeight !== undefined && top >= shown - 1e-6) return;
    const bottom = top - .22; top = Math.min(top, shown);
    if (top <= bottom) return;
    const geometry = new THREE.BoxGeometry(b - a, top - bottom, d - c);
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) vertices.setXYZ(i, ...point(
      (a + b) / 2 + vertices.getX(i), (c + d) / 2 - vertices.getZ(i), (bottom + top) / 2 + vertices.getY(i)));
    geometry.computeVertexNormals(); parts.push(geometry);
  };
  const bar = (a: Vector, b: Vector) => {
    const top = BASE + shown;
    if (a[1] > top && b[1] > top) return;
    if (a[1] > top) { const t = (top - b[1]) / (a[1] - b[1]); a = a.map((v, i) => b[i] + (v - b[i]) * t) as Vector; }
    if (b[1] > top) { const t = (top - a[1]) / (b[1] - a[1]); b = b.map((v, i) => a[i] + (v - a[i]) * t) as Vector; }
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), direction = to.clone().sub(from);
    if (direction.length() < .001) return;
    const geometry = new THREE.BoxGeometry(.06, direction.length(), .06);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    geometry.translate(...from.add(to).multiplyScalar(.5).toArray());
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) vertices.setY(i, Math.min(vertices.getY(i), top));
    rails.push(geometry);
  };
  const guard = (a: [number, number], b: [number, number], y0: number, y1: number) => {
    if (Math.min(y0, y1) + .08 >= shown) return;
    const positions: number[] = [];
    const polygon = [point(...a, y0 + .08), point(...b, y1 + .08), point(...b, y1 + .95), point(...a, y0 + .95)];
    const vertices = polygon.flatMap((p, i) => {
      const q = polygon[(i + 1) % polygon.length], inside = p[1] <= BASE + shown, nextInside = q[1] <= BASE + shown;
      const t = (BASE + shown - p[1]) / (q[1] - p[1]);
      return [...(inside ? [p] : []), ...(inside !== nextInside ? [p.map((v, j) => v + (q[j] - v) * t) as Vector] : [])];
    });
    for (let i = 1; i < vertices.length - 1; i++) positions.push(...vertices[0], ...vertices[i], ...vertices[i + 1]);
    const pane = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    pane.computeVertexNormals(); glass.push(pane);
    bar(point(...a, y0 + 1), point(...b, y1 + 1));
    const count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5));
    for (let i = 0; i <= count; i++) {
      const t = i / count, u = a[0] + (b[0] - a[0]) * t, v = a[1] + (b[1] - a[1]) * t, y = y0 + (y1 - y0) * t;
      bar(point(u, v, y), point(u, v, y + 1));
    }
  };
  const flight = (a: number, b: number, v0: number, v1: number, bottom: number, top: number, count = steps) => {
    if (bottom >= shown) return;
    if (top - bottom < 1e-6) {
      slab(a, b, Math.min(v0, v1), Math.max(v0, v1), top);
      for (const u of [a + .06, b - .06]) guard([u, v0], [u, v1], top, top);
      return;
    }
    const profile: Point[] = [[v0, bottom - .22]];
    for (let step = 0; step < count; step++) {
      const y = bottom + (top - bottom) * (step + 1) / count;
      profile.push([v0 + (v1 - v0) * step / count, y], [v0 + (v1 - v0) * (step + 1) / count, y]);
    }
    profile.push([v1, top - .22]);
    const shape = new THREE.Shape(clippedProfile(profile, shown).map(p => new THREE.Vector2(...p)));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: b - a, bevelEnabled: false });
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) vertices.setXYZ(i, ...point(a + vertices.getZ(i), vertices.getX(i), vertices.getY(i)));
    geometry.computeVertexNormals(); concrete.push(geometry);
    for (const u of [a + .06, b - .06]) guard([u, v0], [u, v1], bottom, top);
  };
  for (let level = 0; level < floors - 1; level++) {
    const bottom = level ? level * floorHeight : .16, top = (level + 1) * floorHeight;
    // The entry fixes only the first landing. At unusually low editable storey
    // heights, preserve 2.2 m headroom plus slab thickness above that landing.
    // Each adjustment uses the entry datum, so it cannot accumulate by floor.
    const regularMiddle = (level + .5) * floorHeight;
    const middle = Math.min(top, Math.max(bottom, level ? Math.max(regularMiddle, entryHeight + level * 2.45) : entryHeight));
    const adjusted = level === 0 || Math.abs(middle - regularMiddle) > 1e-6;
    const count = (from: number, to: number) => adjusted ? Math.max(1, Math.ceil((to - from) / .18 - 1e-7)) : steps;
    // Looking toward the bridge-side windows: ascend on the left, then return
    // on the adjacent flight. The first half landing meets the 1.5-floor bridge.
    flight(middleU + gap / 2, u1, near, far, bottom, middle, count(bottom, middle));
    slab(u0, u1, GYM_WALL, far, middle);
    flight(u0, middleU - gap / 2, far, near, middle, top, count(middle, top));
    for (const u of [u0 + .06, u1 - .06]) guard([u, GYM_WALL + .1], [u, far], middle, middle);
    // The shaft includes the half-floor landing: a regular-floor slab above it
    // would cut through the bridge doorway and leave only 1.8 m of headroom.
    // Full-floor balconies stay on the two sides and behind the stair flights.
    slab(bayStart, u0, GYM_WALL, width - GYM_WALL, top);
    slab(u1, length - GYM_WALL, GYM_WALL, width - GYM_WALL, top);
    slab(u0, u1, near, width - GYM_WALL, top);
    guard([length - GYM_WALL - .18, .8], [length - GYM_WALL - .18, width - .8], top, top);
  }
  // The basketball hall starts on floor two and stays open up to the roof.
  // Exclude slabs at the selected ceiling, rather than leaving their underside.
  if (shown > floorHeight + .001) {
    slab(GYM_WALL, bayStart, GYM_WALL, width - GYM_WALL, floorHeight, court);
    if (shown > floorHeight + .015 + 1e-6) {
      const [marking] = basketballGeometry({ center: at((GYM_WALL + bayStart) / 2, width / 2), axis: along,
        length: Math.min(28, bayStart - GYM_WALL - 4), width: Math.min(15, width - 2 * GYM_WALL - 4), count: 1, gap: 0 });
      for (const mark of marking.marks) for (let i = 1; i < mark.points.length; i++) {
        if (mark.dashed && i % 2 === 0) continue;
        for (const p of [mark.points[i - 1], mark.points[i]]) courtLines.push(p[0], BASE + floorHeight + .015, p[1]);
      }
    }
  }
  // The marked long side faces away from the running track. Its third-floor
  // viewing gallery joins the existing stair landing without crossing the hall.
  if (shown > 2 * floorHeight + .001) {
    const edge = width - GYM_WALL, inner = edge - 3, top = 2 * floorHeight;
    slab(GYM_WALL, bayStart, inner, edge, top);
    guard([GYM_WALL + .08, inner + .06], [bayStart, inner + .06], top, top);
    guard([GYM_WALL + .08, inner + .06], [GYM_WALL + .08, edge], top, top);
  }
  return { stairs: combined(concrete), stairRails: combined(rails), stairGlass: combined(glass),
    court: combined(court, true), courtLines: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(courtLines, 3)) };
}

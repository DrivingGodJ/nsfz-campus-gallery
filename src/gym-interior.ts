import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
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
  const add = (id: string, u0: number, v0: number, u1: number, v1: number, bottom: number, top: number) => {
    if (top - bottom < .2) return;
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
    const bottom = .55;
    // Leave the half-floor bridge doorway completely free of glass as well as
    // concrete; the panes beside and above it remain a continuous tall bay.
    if (entry && entry.u + entry.width / 2 > u0 && entry.u - entry.width / 2 < u1) {
      add(`gym-tower-${id}-below`, u0, 0, u1, 0, bottom, Math.min(entry.bottom, clerestory));
      add(`gym-tower-${id}-above`, u0, 0, u1, 0, Math.max(entry.top, bottom), clerestory);
      for (const [a, b] of [[u0, Math.max(u0, entry.u - entry.width / 2)], [Math.min(u1, entry.u + entry.width / 2), u1]]) {
        if (b - a > .1) add(`gym-tower-${id}-beside-${a}`, a, 0, b, 0, Math.max(bottom, entry.bottom), Math.min(clerestory, entry.top));
      }
    } else add(`gym-tower-${id}`, u0, 0, u1, 0, bottom, clerestory);
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

function combined(parts: THREE.BufferGeometry[]) {
  const plain = parts.map(part => {
    const geometry = part.index ? part.toNonIndexed() : part.clone();
    geometry.deleteAttribute('uv'); return geometry;
  });
  const result = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
  // Thin flights, landing slabs and glazing do not hide the archive's photos.
  result.userData.photoOcclusionMask = new Uint8Array(result.getAttribute('position').count / 3);
  return result;
}

function clippedProfile(points: Point[], top: number) {
  return points.flatMap((p, i) => {
    const q = points[(i + 1) % points.length], inside = p[1] <= top, nextInside = q[1] <= top;
    return [...(inside ? [p] : []), ...(inside !== nextInside ? [[p[0] + (q[0] - p[0]) * (top - p[1]) / (q[1] - p[1]), top] as Point] : [])];
  });
}

export function gymStairGeometry(frame: Frame, height: number, floorHeight: number, cutawayHeight?: number) {
  const { at, length, width, along } = frame, layout = gymStairLayout(frame);
  const { u0, u1, near, far, gap, steps, bayStart } = layout, middleU = (u0 + u1) / 2;
  const shown = Math.min(height, cutawayHeight ?? height), floors = Math.ceil(height / floorHeight);
  const concrete: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  const point = (u: number, v: number, y: number): Vector => { const p = at(u, v); return [p[0], BASE + y, p[1]]; };
  const slab = (a: number, b: number, c: number, d: number, top: number) => {
    const bottom = top - .22; top = Math.min(top, shown);
    if (top <= bottom) return;
    const geometry = new THREE.BoxGeometry(b - a, top - bottom, d - c);
    geometry.rotateY(-Math.atan2(along[1], along[0]));
    concrete.push(geometry.translate(...point((a + b) / 2, (c + d) / 2, (bottom + top) / 2)));
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
  const flight = (a: number, b: number, v0: number, v1: number, bottom: number, top: number) => {
    if (bottom >= shown) return;
    const profile: Point[] = [[v0, bottom - .22]];
    for (let step = 0; step < steps; step++) {
      const y = bottom + (top - bottom) * (step + 1) / steps;
      profile.push([v0 + (v1 - v0) * step / steps, y], [v0 + (v1 - v0) * (step + 1) / steps, y]);
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
    const bottom = level ? level * floorHeight : .16, middle = (level + .5) * floorHeight, top = (level + 1) * floorHeight;
    // Looking toward the bridge-side windows: ascend on the left, then return
    // on the adjacent flight. The first half landing meets the 1.5-floor bridge.
    flight(middleU + gap / 2, u1, near, far, bottom, middle);
    slab(u0, u1, GYM_WALL, far, middle);
    flight(u0, middleU - gap / 2, far, near, middle, top);
    for (const u of [u0 + .06, u1 - .06]) guard([u, GYM_WALL + .1], [u, far], middle, middle);
    // The shaft includes the half-floor landing: a regular-floor slab above it
    // would cut through the bridge doorway and leave only 1.8 m of headroom.
    // Full-floor balconies stay on the two sides and behind the stair flights.
    slab(bayStart, u0, GYM_WALL, width - GYM_WALL, top);
    slab(u1, length - GYM_WALL, GYM_WALL, width - GYM_WALL, top);
    slab(u0, u1, near, width - GYM_WALL, top);
    guard([length - GYM_WALL - .18, .8], [length - GYM_WALL - .18, width - .8], top, top);
  }
  return { stairs: combined(concrete), stairRails: combined(rails), stairGlass: combined(glass) };
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import polygonClipping from 'polygon-clipping';
import { gymRoofHeight, teachingWindowGeometry } from './architecture-geometry.ts';
import { gymFrame, gymStairLayout } from './gym-interior.ts';
import { buildingGeometry } from './building-geometry.ts';
import type { Building, GroundPassage, Point, Shape } from './types';

export const STANDS_ID = 'way/855459409';
export const THEATRE_ID = 'local/theatre';
const BASE = .12;
type Vector = [number, number, number];
type Frame = { at: (u: number, v: number) => Point; along: Point; across: Point };

function combined(parts: THREE.BufferGeometry[], blocking = false) {
  const plain = parts.map(part => {
    const geometry = part.index ? part.toNonIndexed() : part.clone();
    geometry.deleteAttribute('uv'); return geometry;
  });
  const geometry = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
  if (!blocking) geometry.userData.photoOcclusionMask = new Uint8Array(geometry.getAttribute('position').count / 3);
  return geometry;
}

function box(frame: Frame, u: number, v: number, bottom: number, top: number, length: number, width: number, shown = Infinity) {
  top = Math.min(top, shown);
  if (top <= bottom) return undefined;
  const p = frame.at(u, v), geometry = new THREE.BoxGeometry(length, top - bottom, width);
  const matrix = new THREE.Matrix4().makeBasis(new THREE.Vector3(frame.along[0], 0, frame.along[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(frame.across[0], 0, frame.across[1]));
  // The gym's map frame is reflected. Preserve outward triangle winding when
  // baking that frame, so its boxes light and raycast like the other venues.
  if (matrix.determinant() < 0) {
    const indices = geometry.getIndex()!;
    for (let i = 0; i < indices.count; i += 3) { const index = indices.getX(i + 1); indices.setX(i + 1, indices.getX(i + 2)); indices.setX(i + 2, index); }
  }
  geometry.applyMatrix4(matrix); geometry.translate(p[0], BASE + (bottom + top) / 2, p[1]);
  return geometry;
}

function bar(from: Vector, to: Vector, width: number, shown = Infinity) {
  const ceiling = BASE + shown;
  if (from[1] >= ceiling && to[1] >= ceiling) return undefined;
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to);
  if (a.y > ceiling) a.lerp(b, (a.y - ceiling) / (a.y - b.y));
  if (b.y > ceiling) b.lerp(a, (b.y - ceiling) / (b.y - a.y));
  const direction = b.clone().sub(a);
  if (direction.length() < .001) return undefined;
  const geometry = new THREE.BoxGeometry(width, direction.length(), width);
  geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
  geometry.translate(...a.add(b).multiplyScalar(.5).toArray());
  const vertices = geometry.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) vertices.setY(i, Math.min(vertices.getY(i), ceiling));
  return geometry;
}

function add(parts: THREE.BufferGeometry[], geometry: THREE.BufferGeometry | undefined) { if (geometry) parts.push(geometry); }

// DJI_0004 shows ten shallow rows, colour blocks, a central canopy, and rooms
// underneath. Row rise and canopy span are estimates within the existing plan.
export function standsFrame(building: Building) {
  const [origin, next] = building.outer, back = building.outer.at(-2)!;
  const length = Math.hypot(next[0] - origin[0], next[1] - origin[1]), width = Math.hypot(back[0] - origin[0], back[1] - origin[1]);
  const along: Point = [(next[0] - origin[0]) / length, (next[1] - origin[1]) / length];
  const across: Point = [(back[0] - origin[0]) / width, (back[1] - origin[1]) / width];
  const at = (u: number, v: number): Point => [origin[0] + along[0] * u + across[0] * v, origin[1] + along[1] * u + across[1] * v];
  return { at, along, across, length, width };
}

export function standsArchitecture(building: Building, height: number, floorHeight: number, cutawayHeight?: number) {
  const frame = standsFrame(building), { at, length, width } = frame, shown = Math.min(height, cutawayHeight ?? height);
  const bodyParts: THREE.BufferGeometry[] = [], blue: THREE.BufferGeometry[] = [], green: THREE.BufferGeometry[] = [], red: THREE.BufferGeometry[] = [];
  const canopy: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  const point = (u: number, v: number, y: number): Vector => { const p = at(u, v); return [p[0], BASE + y, p[1]]; };
  const inner = [at(.35, .35), at(length - .35, .35), at(length - .35, width - .35), at(.35, width - .35)];
  const shell: Shape = { outer: building.outer, holes: [[...inner, inner[0]]] };
  const opening = (u: number, span: number): GroundPassage => ({ id: `stand-${u}`, sourcePathId: '', width: span, points: [at(u, -1), at(u, 1)] });
  const doors = [length * .18, length * .5, length * .82].map(u => opening(u, 2.3));
  const windows = Array.from({ length: 9 }, (_, i) => opening(length * (.065 + i * .105), 3.7))
    .filter(window => doors.every(door => Math.abs(Number(window.id.slice(6)) - Number(door.id.slice(6))) > (window.width + door.width) / 2 + .2));
  const housingTop = Math.min(floorHeight, shown), bands = [0, .65, 2.55, 2.8, housingTop].filter(y => y >= 0 && y <= housingTop).sort((a, b) => a - b);
  for (let i = 1; i < bands.length; i++) {
    const bottom = bands[i - 1], top = bands[i];
    if (top <= bottom) continue;
    const cuts = [...(top <= 2.8 ? doors : []), ...(bottom >= .65 && top <= 2.55 ? windows : [])];
    const geometry = buildingGeometry(shell, top - bottom, floorHeight, cuts); geometry.translate(0, 0, bottom); bodyParts.push(geometry);
  }
  for (const [bottom, top] of [[0, .2], [floorHeight - .22, floorHeight]]) {
    const end = Math.min(top, shown);
    if (end <= bottom || (cutawayHeight !== undefined && top >= shown - 1e-6 && bottom > 0)) continue;
    const slab = buildingGeometry(building, end - bottom, floorHeight); slab.translate(0, 0, bottom); bodyParts.push(slab);
  }
  for (const cut of windows) {
    const u = Number(cut.id.slice(6)), top = Math.min(2.55, shown);
    add(glass, box(frame, u, .13, .65, top, cut.width, .04));
    for (const x of [u - cut.width / 2, u, u + cut.width / 2]) add(frames, box(frame, x, .13, .65, top, .06, .065));
    for (const y of [.65, 2.55]) add(frames, box(frame, u, .13, y - .03, y + .03, cut.width, .065, shown));
  }
  // A stair/control block occupies the photographed end; it does not change the
  // imported building footprint or add a false third storey over all the seats.
  const towerWidth = 6.2, tower: Shape = { outer: [at(0, 0), at(towerWidth, 0), at(towerWidth, width), at(0, width), at(0, 0)], holes: [] };
  if (shown > floorHeight) {
    const towerHeight = shown - floorHeight;
    const classroomWindows = { wallThickness: .3, bayWidth: 3.1, windowWidth: 2.15, sill: .55, top: floorHeight - .42, columns: 2, transom: .3 };
    const geometry = buildingGeometry(tower, towerHeight, floorHeight, [], [], [], classroomWindows, [], [], cutawayHeight !== undefined);
    geometry.translate(0, 0, floorHeight); bodyParts.push(geometry);
    const windows = teachingWindowGeometry({ ...building, ...tower, floorCorridors: [], classroomWindows }, [{ ...tower, id: 'main', name: '', height: towerHeight, floors: Math.ceil(towerHeight / floorHeight) }], floorHeight);
    windows.glass.translate(0, floorHeight, 0); windows.frames.translate(0, floorHeight, 0);
    glass.push(windows.glass); frames.push(windows.frames);
  }
  const rows = 10, deck = floorHeight, tread = (width - 2.1) / rows, rise = Math.min(.32, floorHeight / rows), aisles = [length * .27, length * .53, length * .78];
  if (shown > deck + .001) {
    add(frames, box(frame, (towerWidth + length) / 2, .95, deck - .18, deck, length - towerWidth, 1.9, shown));
    for (let row = 0; row < rows; row++) {
      const top = deck + (row + 1) * rise, v = 1.9 + (row + .5) * tread;
      const boundaries = [towerWidth, ...aisles.flatMap(u => [u - 1.1, u + 1.1]), length - .2];
      for (let section = 0; section < boundaries.length - 1; section += 2) {
        const from = boundaries[section], to = boundaries[section + 1];
        const parts = section % 6 === 0 ? blue : section % 6 === 2 ? red : green;
        add(parts, box(frame, (from + to) / 2, v, deck - .15, top, to - from, tread, shown));
      }
      for (const u of aisles) for (let half = 0; half < 2; half++) add(frames, box(frame, u, v - tread / 4 + half * tread / 2, deck - .15, deck + row * rise + rise * (half + 1) / 2, 2.2, tread / 2, shown));
    }
    for (const v of [.1, width - .12]) {
      const base = v < 1 ? deck : deck + rows * rise;
      for (const y of [.55, 1.02]) add(rails, bar(point(towerWidth, v, base + y), point(length - .2, v, base + y), .05, shown));
      for (let u = towerWidth; u < length; u += 1.4) add(rails, bar(point(u, v, base), point(u, v, base + 1.05), .045, shown));
    }
    for (const u of aisles) for (const offset of [-1.1, 1.1]) add(rails, bar(point(u + offset, 1.9, deck + 1), point(u + offset, width - .1, deck + rows * rise + 1), .055, shown));
  }
  const canopyBottom = Math.min(height - .45, deck + rows * rise + 2.55), canopyShown = cutawayHeight === undefined || cutawayHeight > canopyBottom + .32;
  if (canopyShown && shown > canopyBottom) {
    const u0 = length * .23, u1 = length * .78;
    add(canopy, box(frame, (u0 + u1) / 2, width / 2, canopyBottom, canopyBottom + .28, u1 - u0, width - .2, shown));
    for (let i = 0; i < 5; i++) {
      const u = u0 + (u1 - u0) * i / 4;
      add(frames, box(frame, u, width - .65, deck + rows * rise - .32, canopyBottom, .3, .3, shown));
      add(frames, box(frame, u, width / 2, canopyBottom - .24, canopyBottom, .18, width - .35, shown));
    }
  }
  return { body: combined(bodyParts, true), tiersBlue: combined(blue), tiersGreen: combined(green), tiersRed: combined(red), canopy: combined(canopy), frames: combined(frames), glass: combined(glass), rails: combined(rails) };
}

export function theatreInteriorLayout(building: Building, floorHeight: number) {
  // DSC2649 confirms a raked auditorium and overhead balcony; dimensions and
  // unseen stage depth are estimated, inside the unchanged main section.
  const section = building.parts?.find(part => part.id === 'main') ?? building;
  const sideA = section.outer[18], sideB = section.outer[19];
  const direction = new THREE.Vector2(sideA[0] - sideB[0], sideA[1] - sideB[1]).normalize();
  const across: Point = [direction.x, direction.y], along: Point = [direction.y, -direction.x];
  const origin: Point = [49.5, -36];
  const at = (u: number, v: number): Point => [origin[0] + along[0] * u + across[0] * v, origin[1] + along[1] * u + across[1] * v];
  return { at, along, across, floor: floorHeight + .25, rows: 14, firstRadius: 8.5, rowDepth: .9, halfWidth: 11.5, rowRise: .105, section };
}

export function theatreInteriorGeometry(building: Building, height: number, floorHeight: number, cutawayHeight?: number) {
  const layout = theatreInteriorLayout(building, floorHeight), { at, floor, rows, firstRadius, rowDepth, halfWidth, rowRise } = layout;
  const shown = Math.min(height, cutawayHeight ?? height), tiers: THREE.BufferGeometry[] = [], seats: THREE.BufferGeometry[] = [], wood: THREE.BufferGeometry[] = [], curtains: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
  const point = (u: number, v: number, y: number): Vector => { const p = at(u, v); return [p[0], BASE + y, p[1]]; };
  const curvedTier = (radius: number, depth: number, bottom: number, top: number) => {
    top = Math.min(top, shown); if (top <= bottom) return;
    const angle = Math.min(.95, Math.asin(halfWidth / Math.max(halfWidth + .001, radius + depth))), points: Point[] = [];
    for (let i = 0; i <= 24; i++) { const a = -angle + 2 * angle * i / 24; points.push(at(Math.sin(a) * radius, Math.cos(a) * radius)); }
    for (let i = 24; i >= 0; i--) { const a = -angle + 2 * angle * i / 24; points.push(at(Math.sin(a) * (radius + depth), Math.cos(a) * (radius + depth))); }
    points.push(points[0]);
    const geometry = buildingGeometry({ outer: points, holes: [] }, top - bottom, floorHeight);
    geometry.rotateX(-Math.PI / 2); geometry.translate(0, BASE + bottom, 0); tiers.push(geometry);
  };
  if (shown > floor + .001) {
    // A thin floor anchors the furniture in full photo perspective as well as
    // cutaways; no auditorium furnishing touches the confirmed north hall.
    const floorOutline = [at(-12, -.5), at(12, -.5), at(12, 24.5), at(-12, 24.5), at(-12, -.5)];
    const floors = polygonClipping.intersection([floorOutline], [layout.section.outer, ...layout.section.holes]);
    for (const [outer, ...holes] of floors) {
      const geometry = buildingGeometry({ outer: outer as Point[], holes: holes as Point[][] }, .08, floorHeight);
      geometry.rotateX(-Math.PI / 2); geometry.translate(0, BASE + floor - .07, 0); tiers.push(geometry);
    }
    add(wood, box(layout, 0, 2.2, floor, floor + .45, 16, 5.2, shown));
    add(curtains, box(layout, -7.25, -.15, floor + .45, floor + 2.6, 1.45, .18, shown));
    add(curtains, box(layout, 7.25, -.15, floor + .45, floor + 2.6, 1.45, .18, shown));
    add(curtains, box(layout, 0, -.15, floor + 2.28, floor + 2.6, 16, .18, shown));
    for (let row = 0; row < rows; row++) {
      const radius = firstRadius + row * rowDepth, y = floor + (row + 1) * rowRise;
      curvedTier(radius, rowDepth, floor - .05, y);
      const angle = Math.min(.9, Math.asin(halfWidth / (radius + rowDepth / 2))), count = Math.floor(2 * angle * radius / .7);
      for (let seat = 0; seat < count; seat++) {
        const a = -angle + 2 * angle * (seat + .5) / count;
        if (Math.abs(Math.abs(a) - .28) < .048) continue; // two continuous curved aisles
        const u = Math.sin(a) * (radius + rowDepth * .55), v = Math.cos(a) * (radius + rowDepth * .55);
        const along: Point = [layout.along[0] * Math.cos(a) - layout.across[0] * Math.sin(a), layout.along[1] * Math.cos(a) - layout.across[1] * Math.sin(a)];
        const across: Point = [layout.along[0] * Math.sin(a) + layout.across[0] * Math.cos(a), layout.along[1] * Math.sin(a) + layout.across[1] * Math.cos(a)];
        const chair = { along, across, at: (x: number, z: number): Point => { const p = at(u, v); return [p[0] + along[0] * x + across[0] * z, p[1] + along[1] * x + across[1] * z]; } };
        add(seats, box(chair, 0, 0, y + .34, y + .44, .54, .51, shown));
        add(seats, box(chair, 0, .22, y + .39, y + .94, .54, .12, shown));
      }
    }
    // Horizontal timber absorption bands stay just inside the curved room wall.
    for (let edge = 9; edge < 19; edge++) {
      const a = layout.section.outer[edge], b = layout.section.outer[edge + 1], midpoint: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const toward = new THREE.Vector2(51 - midpoint[0], -24 - midpoint[1]).normalize().multiplyScalar(.35);
      for (let band = 0; band < 6; band++) add(wood, bar([a[0] + toward.x, BASE + floor + .65 + band * .32, a[1] + toward.y], [b[0] + toward.x, BASE + floor + .65 + band * .32, b[1] + toward.y], .2, shown));
    }
    const balcony = 2 * floorHeight + .25;
    if (shown > balcony + .001) {
      curvedTier(21, 2, balcony - .2, balcony);
      for (let i = 0; i < 20; i++) {
        const a = -.52 + i * .052, b = a + .052;
        add(rails, bar(point(Math.sin(a) * 21, Math.cos(a) * 21, balcony + .9), point(Math.sin(b) * 21, Math.cos(b) * 21, balcony + .9), .055, shown));
        add(rails, bar(point(Math.sin(a) * 21, Math.cos(a) * 21, balcony), point(Math.sin(a) * 21, Math.cos(a) * 21, balcony + .9), .05, shown));
      }
    }
  }
  return { tiers: combined(tiers), seats: combined(seats), wood: combined(wood), curtains: combined(curtains), rails: combined(rails) };
}

// The 3F hall panorama shows mobile baskets, blue gallery benches, wall displays
// and a shallow metal roof lattice. Reuse its existing court/stair frame.
export function gymDetailGeometry(building: Building, height: number, floorHeight: number, cutawayHeight?: number) {
  const frame = gymFrame(building), { at, width } = frame, { bayStart } = gymStairLayout(frame);
  const shown = Math.min(height, cutawayHeight ?? height), floor = floorHeight, metal: THREE.BufferGeometry[] = [], blue: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [], screens: THREE.BufferGeometry[] = [], lattice: THREE.BufferGeometry[] = [];
  const point = (u: number, v: number, y: number): Vector => { const p = at(u, v); return [p[0], BASE + y, p[1]]; };
  if (shown > floor + .001) {
    const center = (.38 + bayStart) / 2, courtLength = Math.min(28, bayStart - .38 - 4), halfCourt = courtLength / 2;
    for (const sign of [-1, 1]) {
      const baseline = center + sign * halfCourt, support = baseline + sign * 2.4;
      const u = baseline - sign * courtLength * 1.2 / 28, rimU = baseline - sign * courtLength * 1.575 / 28;
      add(blue, box(frame, support, width / 2, floor, floor + .72, 2.1, 1.25, shown));
      add(metal, bar(point(support, width / 2, floor + .5), point(u + sign * .45, width / 2, floor + 3.25), .13, shown));
      add(metal, bar(point(support - sign * .8, width / 2, floor + .5), point(u + sign * .5, width / 2, floor + 3.25), .08, shown));
      add(glass, box(frame, u, width / 2, floor + 2.83, floor + 3.88, .055, 1.8, shown));
      for (const v of [width / 2 - .9, width / 2 + .9]) add(metal, bar(point(u, v, floor + 2.83), point(u, v, floor + 3.88), .05, shown));
      if (floor + 3.05 < shown) {
        const p = at(rimU, width / 2), rim = new THREE.TorusGeometry(.23, .022, 4, 14);
        rim.rotateX(Math.PI / 2); rim.translate(p[0], BASE + floor + 3.05, p[1]); metal.push(rim);
      }
    }
    add(screens, box(frame, bayStart * .45, .43, floor + 1.25, floor + 3.85, 5, .06, shown));
    add(screens, box(frame, .43, width / 2, floor + 1.6, floor + 3.7, .06, 3.5, shown));
    const gallery = 2 * floorHeight;
    if (shown > gallery + .05) for (const v of [width - 1.75, width - .8]) for (let bay = 0; bay < 4; bay++) {
      const length = (bayStart - 4) / 4, u = 2 + (bay + .5) * length;
      add(blue, box(frame, u, v, gallery + .35, gallery + .46, length - 1.2, .46, shown));
      add(blue, box(frame, u, v + .22, gallery + .4, gallery + .88, length - 1.2, .09, shown));
      for (const x of [u - length / 2 + 1, u + length / 2 - 1]) add(metal, box(frame, x, v, gallery, gallery + .37, .06, .37, shown));
    }
  }
  if (cutawayHeight === undefined || cutawayHeight > height) for (let bay = 0; bay < 10; bay++) {
    const u = 1.2 + (frame.length - 2.4) * bay / 9, y = gymRoofHeight(height, u / frame.length) - .38;
    for (const rise of [0, -.65]) add(lattice, bar(point(u, .6, y + rise), point(u, width - .6, y + rise), .07));
    for (let panel = 0; panel < 8; panel++) {
      const v0 = .6 + (width - 1.2) * panel / 8, v1 = .6 + (width - 1.2) * (panel + 1) / 8;
      add(lattice, bar(point(u, v0, y), point(u, v1, y - .65), .045));
      add(lattice, bar(point(u, v0, y - .65), point(u, v1, y), .045));
    }
    if (bay < 9) for (const v of [width * .25, width * .5, width * .75]) {
      const next = 1.2 + (frame.length - 2.4) * (bay + 1) / 9;
      add(lattice, bar(point(u, v, y), point(next, v, gymRoofHeight(height, next / frame.length) - .38), .045));
    }
  }
  return { metal: combined(metal), blue: combined(blue), glass: combined(glass), screens: combined(screens), lattice: combined(lattice) };
}

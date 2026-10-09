import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { undergroundFootprints, type PassageOpening } from './underground-geometry.ts';
import { undergroundWallPanels } from './underground-mesh.ts';
import type { Feature, Point, Shape } from './types';

type Kind = 'floor' | 'walls' | 'tiles' | 'metal' | 'lights' | 'pipes' | 'glass' | 'green' | 'wood' | 'paint' | 'nets' | 'ceiling' | 'fittings';
type Vector = [number, number, number];
export const UNDERGROUND_COLORS: Record<Kind, string> = { floor: '#7a9799', walls: '#b6beb8', tiles: '#546566', metal: '#777d78', lights: '#f4eccc', pipes: '#a45342', glass: '#abc9cb', green: '#278778', wood: '#c89e66', paint: '#ede8d2', nets: '#a3afa2', ceiling: '#525d5b', fittings: '#56819a' };

export function undergroundRoomFrame(feature: Feature) {
  const ring = feature.outer!, origin = ring[0], short = ring[1], long = ring.at(-2)!;
  const width = Math.hypot(short[0] - origin[0], short[1] - origin[1]), length = Math.hypot(long[0] - origin[0], long[1] - origin[1]);
  const across: Point = [(short[0] - origin[0]) / width, (short[1] - origin[1]) / width], along: Point = [(long[0] - origin[0]) / length, (long[1] - origin[1]) / length];
  const at = (u: number, v: number): Point => [origin[0] + across[0] * u + along[0] * v, origin[1] + across[1] * u + along[1] * v];
  return { at, across, along, width, length };
}

// Structure and recognizable fittings are retained; exact unseen court counts
// and service routing are estimates, documented alongside the 13 source views.
export function undergroundDetailGeometry(feature: Feature, footprints = undergroundFootprints(feature), openings: PassageOpening[] = []) {
  const parts = Object.fromEntries(Object.keys(UNDERGROUND_COLORS).map(kind => [kind, [] as THREE.BufferGeometry[]])) as Record<Kind, THREE.BufferGeometry[]>;
  const floor = feature.height ?? -3, clear = feature.wallHeight || 2.4, top = floor + clear;
  const point = ([x, z]: Point, height: number): Vector => [x, height, z];
  const box = (p: Point, bottom: number, height: number, length: number, width: number, angle: number, kind: Kind) => {
    if (height <= 0 || length <= 0 || width <= 0) return;
    parts[kind].push(new THREE.BoxGeometry(length, height, width).rotateY(angle).translate(p[0], bottom + height / 2, p[1]));
  };
  const segment = (from: Point, to: Point, bottom: number, height: number, width: number, kind: Kind) => {
    const dx = to[0] - from[0], dz = to[1] - from[1];
    box([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], bottom, height, Math.hypot(dx, dz), width, -Math.atan2(dz, dx), kind);
  };
  const bar = (from: Vector, to: Vector, radius: number, kind: Kind, sides = 5) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a), length = direction.length();
    if (length < 1e-5) return;
    const geometry = new THREE.CylinderGeometry(radius, radius, length, sides);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    parts[kind].push(geometry.translate(...a.add(b).multiplyScalar(.5).toArray()));
  };
  const flat = (shape: Shape, height: number, kind: Kind) => {
    const outline = new THREE.Shape(shape.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    outline.holes = shape.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    parts[kind].push(new THREE.ShapeGeometry(outline).rotateX(-Math.PI / 2).translate(0, height, 0));
  };
  for (const shape of footprints) {
    flat(shape, floor + .045, feature.type === 'undergroundRoom' ? 'green' : 'floor');
    // Windows cut through the high wall band; lower panels keep the sports hall
    // enclosure, and door heads are retained above each real connection.
    const panels = undergroundWallPanels(shape, clear, openings);
    for (const panel of panels) {
      const length = Math.hypot(panel.to[0] - panel.from[0], panel.to[1] - panel.from[1]);
      const highWindows = feature.type === 'undergroundRoom' && length > 16 && clear > 5;
      if (highWindows) {
        segment(panel.from, panel.to, floor + panel.bottom, clear - .95 - panel.bottom, .2, 'walls');
        segment(panel.from, panel.to, top - .2, .2, .2, 'walls');
        segment(panel.from, panel.to, top - .95, .75, .055, 'glass');
        const bays = Math.ceil(length / 3.4);
        for (let i = 0; i <= bays; i++) {
          const p: Point = panel.from.map((n, j) => n + (panel.to[j] - n) * i / bays) as Point;
          bar(point(p, top - .95), point(p, top), .035, 'metal');
        }
      } else segment(panel.from, panel.to, floor + panel.bottom, panel.top - panel.bottom, .2, 'walls');
      const trimHeight = feature.type === 'undergroundTrack' ? 1.55 : feature.type === 'undergroundCorridor' ? 1.1 : clear - 1;
      for (let y = .55; y < trimHeight; y += .55) if (y > panel.bottom) segment(panel.from, panel.to, floor + y, .018, .215, 'tiles');
      if (panel.bottom < 1.1) {
        const count = Math.ceil(length / (feature.type === 'undergroundTrack' ? .55 : 2.4));
        for (let i = 1; i < count; i++) {
          const p = panel.from.map((n, j) => n + (panel.to[j] - n) * i / count) as Point;
          bar(point(p, floor + Math.max(.08, panel.bottom)), point(p, floor + trimHeight), .008, 'tiles', 4);
        }
      }
    }
  }
  const routes = feature.points ? [feature.points, ...(feature.branches || [])] : [];
  for (const route of routes) for (let edge = 1; edge < route.length; edge++) {
    const a = route[edge - 1], b = route[edge], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz), width = feature.width || 4;
    if (length < 1e-6) continue;
    const at = (distance: number, side = 0): Point => [a[0] + dx / length * distance + dz / length * side, a[1] + dz / length * distance - dx / length * side];
    const lightwell = feature.type === 'undergroundCorridor' && edge === 1;
    const positions = Math.max(1, Math.floor(length / 4.8));
    for (let i = 0; i <= positions; i++) {
      const distance = Math.min(length - .4, .4 + i * (length - .8) / positions), p = at(distance);
      segment(at(distance, -width / 2 + .12), at(distance, width / 2 - .12), top - .34, .28, .18, 'metal');
      const light = at(distance, lightwell ? width / 4 : 0);
      box(light, top - .45, .06, lightwell ? 1.2 : .95, .32, -Math.atan2(dz, dx), 'lights');
      for (const side of [-1, 1]) {
        const wallLight = at(distance, side * (width / 2 - .17));
        box(wallLight, floor + 1.85, .22, .22, .08, -Math.atan2(dz, dx), 'lights');
        if (i % 3 === 0) box(wallLight, floor + .15, .16, .34, .09, -Math.atan2(dz, dx), 'green');
      }
      if (lightwell && i % 2 === 0 && i > 0 && i < positions) {
        const pillar = at(distance, .15);
        bar(point(pillar, floor), point(pillar, top - .2), .28, 'walls', 10);
        bar(point(pillar, floor), point(pillar, floor + .18), .31, 'metal', 10);
        // The long corridor photographs show black steel window bays on the
        // building side of a glazed open lightwell, not a closed low tunnel.
        segment(at(distance - 1.65, width / 2 - .16), at(distance + 1.65, width / 2 - .16), floor + 1.45, 1.5, .06, 'glass');
        for (const d of [-1.65, 0, 1.65]) bar(point(at(distance + d, width / 2 - .19), floor + 1.45), point(at(distance + d, width / 2 - .19), floor + 2.95), .035, 'metal');
      }
      if (feature.type === 'undergroundTrack' && i % 4 === 2) {
        const center = at(distance), sideA = at(distance, -width / 2 + .25), sideB = at(distance, width / 2 - .25);
        for (const post of [sideA, sideB]) { bar(point(post, floor + .05), point(post, floor + 1.55), .035, 'fittings'); box(post, floor + .04, .05, .45, .35, -Math.atan2(dz, dx), 'fittings'); }
        segment(sideA, sideB, floor + 1.45, .025, .025, 'pipes');
        segment(sideA, sideB, floor + .8, .65, .013, 'nets');
        box(at(distance, width / 2 - .65), floor + .04, .43, .36, .35, 0, 'fittings');
        // Center stays navigable underneath the hanging practice net; no lane
        // barrier is written into the route or photo placement geometry.
        void center;
      }
    }
    for (const side of [width / 2 - .32, -width / 2 + .32]) {
      const from = at(.35, side), to = at(length - .35, side);
      bar(point(from, top - .58), point(to, top - .58), .035, 'pipes');
      segment(from, to, floor + .065, .025, .2, 'tiles');
    }
    if (lightwell) {
      segment(at(.1, -width / 4), at(length - .1, -width / 4), top - .05, .045, width / 2 - .25, 'glass');
      segment(at(.1, width / 4), at(length - .1, width / 4), top - .12, .08, width / 2, 'ceiling');
    } else segment(at(.1), at(length - .1), top - .12, .08, width - .2, 'ceiling');
    if (feature.type === 'tunnel') {
      // Orange guiding strip, suspended red service pipe and bright rectangular
      // ceiling panels are visible in _DSC8295 and the two exit-stair photos.
      segment(at(.2, -.8), at(length - .2, -.8), floor + .07, .015, .12, 'wood');
      bar(point(at(.3, .7), top - .45), point(at(length - .3, .7), top - .45), .055, 'pipes');
    }
    if (feature.type === 'undergroundTrack') {
      for (const side of [-width / 3, 0, width / 3]) segment(at(.3, side), at(length - .3, side), floor + .07, .013, .03, 'paint');
      // End high windows bring daylight into the photographed practice strip.
      for (const distance of [.12, length - .12]) segment(at(distance, -width / 2 + .25), at(distance, width / 2 - .25), top - 1.4, .95, .045, 'glass');
    }
  }
  if (feature.type === 'undergroundRoom' && feature.outer) {
    const { at, width, length, along, across } = undergroundRoomFrame(feature), angle = -Math.atan2(across[1], across[0]);
    const roomPoint = (u: number, v: number, y: number) => point(at(u, v), y);
    const cols = Math.max(1, Math.floor((width - 3.8) / 7.6)), rows = Math.max(1, Math.floor((length - 5.5) / 15.4));
    const marginU = (width - cols * 7.6) / 2, marginV = (length - rows * 15.4) / 2;
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const u = marginU + col * 7.6 + 3.8, v = marginV + row * 15.4 + 7.7;
      const line = (u0: number, v0: number, u1: number, v1: number) => segment(at(u + u0, v + v0), at(u + u1, v + v1), floor + .07, .012, .04, 'paint');
      for (const x of [-3.05, 3.05, -2.59, 2.59]) line(x, -6.7, x, 6.7);
      for (const z of [-6.7, -5.94, -1.98, 1.98, 5.94, 6.7]) line(-3.05, z, 3.05, z);
      for (const sign of [-1, 1]) line(0, sign * 1.98, 0, sign * 6.7);
      for (const x of [-3.2, 3.2]) { bar(roomPoint(u + x, v, floor + .06), roomPoint(u + x, v, floor + 1.55), .035, 'wood'); box(at(u + x, v), floor + .05, .07, .55, .35, angle, 'wood'); }
      segment(at(u - 3.2, v), at(u + 3.2, v), floor + 1.51, .026, .025, 'paint');
      segment(at(u - 3.2, v), at(u + 3.2, v), floor + .78, .72, .014, 'nets');
      for (const y of [.8, 1.05, 1.3]) segment(at(u - 3.2, v), at(u + 3.2, v), floor + y, .006, .018, 'tiles');
    }
    // The pale timber multipurpose bay in DSC01480 is confined to the far end;
    // it does not turn the green badminton hall into an all-wood basketball hall.
    box(at(width / 2, length - 8), floor + .075, .015, Math.min(15, width - 6), 10, angle, 'wood');
    for (const u of [.8, width - .8]) {
      segment(at(u, .3), at(u, length - .3), floor + 4.25, .16, 1.1, 'metal');
      for (const y of [4.75, 5.25]) bar(roomPoint(u, .3, floor + y), roomPoint(u, length - .3, floor + y), .025, 'paint');
      for (let v = .3; v < length; v += 1.25) bar(roomPoint(u, v, floor + 4.4), roomPoint(u, v, floor + 5.3), .023, 'paint');
    }
    const bays = Math.max(2, Math.round(length / 8));
    for (let i = 0; i <= bays; i++) {
      const v = .7 + (length - 1.4) * i / bays;
      for (const u of [.35, width * .5, width - .35]) {
        bar(roomPoint(u, v, floor + .05), roomPoint(u, v, top - .25), .26, 'walls', 8);
        box(at(u, v), top - .55, .4, .55, .6, angle, 'metal');
      }
      segment(at(.35, v), at(width - .35, v), top - .5, .28, .25, 'metal');
      for (const u of [width * .25, width * .75]) box(at(u, v), top - .6, .08, 1.5, .6, angle, 'lights');
      for (const u of [width * .25, width * .75]) bar(roomPoint(u, v, top - .65), roomPoint(u, v, top - 1.1), .015, 'pipes');
    }
    for (const u of [1.5, width * .33, width * .66, width - 1.5]) bar(roomPoint(u, .4, top - .7), roomPoint(u, length - .4, top - .7), .05, 'pipes');
    segment(at(width * .5, .4), at(width * .5, length - .4), top - .6, .24, .75, 'metal');
    for (const shape of footprints) flat(shape, top - .06, 'ceiling');
    // Retractable ceiling frames are photographed above the timber bay.
    const boardV = length - 9.5, boardU = width * .5;
    segment(at(boardU - .9, boardV), at(boardU + .9, boardV), floor + 3.1, 1.05, .045, 'glass');
    bar(roomPoint(boardU, boardV, floor + 3.1), roomPoint(boardU, boardV, top - .4), .05, 'metal');
    const rim = new THREE.TorusGeometry(.225, .021, 5, 14).rotateX(Math.PI / 2); const p = at(boardU, boardV - .36); parts.pipes.push(rim.translate(p[0], floor + 3.05, p[1]));
    void along;
  }
  const merge = (geometries: THREE.BufferGeometry[]) => {
    const plain = geometries.map(part => { const data = part.index ? part.toNonIndexed() : part.clone(); data.deleteAttribute('uv'); return data; });
    const result = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    geometries.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
    result.userData.photoOcclusionMask = new Uint8Array(result.getAttribute('position').count / 3);
    return result;
  };
  return Object.fromEntries(Object.entries(parts).map(([kind, list]) => [kind, merge(list)])) as Record<Kind, THREE.BufferGeometry>;
}

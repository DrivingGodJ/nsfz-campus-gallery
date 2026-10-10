import polygonClipping from 'polygon-clipping';
import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import type { BasketballLayout, Feature, Point, Shape } from './types';

type CourtMark = { points: Point[]; dashed?: boolean };
export function basketballGeometry(layout: BasketballLayout) {
  const { length, width, count, gap, axis, center } = layout;
  const across = width / 2, along = length / 2;
  const circle = (radius: number, origin: Point = [0, 0]): Point[] => Array.from({ length: 65 }, (_, i) => [origin[0] + radius * Math.cos(i * Math.PI / 32), origin[1] + radius * Math.sin(i * Math.PI / 32)]);
  return Array.from({ length: count }, (_, i) => {
    const offset = (i - (count - 1) / 2) * (width + gap);
    const world = ([x, z]: Point): Point => [center[0] + axis[1] * (x + offset) + axis[0] * z, center[1] - axis[0] * (x + offset) + axis[1] * z];
    const boundary: Point[] = [[-across, -along], [across, -along], [across, along], [-across, along], [-across, -along]];
    const marks: CourtMark[] = [{ points: boundary }, { points: [[-across, 0], [across, 0]] }, { points: circle(width * 1.8 / 15) }];
    for (const sign of [-1, 1]) {
      const basket = length * 1.575 / 28, freeThrow = length * 5.8 / 28, keyHalfWidth = width * 2.45 / 15, radius = width * 1.8 / 15;
      const point = (x: number, depth: number): Point => [x, sign * (along - depth)];
      marks.push({ points: [point(-keyHalfWidth, 0), point(-keyHalfWidth, freeThrow), point(keyHalfWidth, freeThrow), point(keyHalfWidth, 0)] });
      const freeArc = (start: number, sweep: number): Point[] => Array.from({ length: 33 }, (_, j) => {
        const angle = start + sweep * j / 32;
        return point(radius * Math.sin(angle), freeThrow + radius * Math.cos(angle));
      });
      marks.push({ points: freeArc(-Math.PI / 2, Math.PI) }, { points: freeArc(Math.PI / 2, Math.PI), dashed: true });
      const threeRadius = width * .45, corner = across - width * .06, angle = Math.asin(corner / threeRadius);
      marks.push({ points: [point(-corner, 0), ...Array.from({ length: 49 }, (_, j) => {
        const theta = -angle + 2 * angle * j / 48;
        return point(threeRadius * Math.sin(theta), basket + threeRadius * Math.cos(theta));
      }), point(corner, 0)] });
      marks.push({ points: circle(width * .6 / 15, point(0, basket)) });
    }
    return { center: world([0, 0]), surface: { outer: boundary.map(world), holes: [] } as Shape,
      marks: marks.map(mark => ({ ...mark, points: mark.points.map(world) })) };
  });
}

export function basketballSurfaces(feature: Feature) {
  const courts = basketballGeometry(feature.courts!);
  const polygons = courts.map(court => [court.surface.outer]);
  const surround = polygonClipping.difference([feature.outer!, ...(feature.holes || [])], polygons[0], ...polygons.slice(1))
    .map(([outer, ...holes]) => ({ outer, holes }));
  return { courts, surround };
}

// All equipment uses real metres, independent of the map's court orientation.
export function basketballEquipment(layout: BasketballLayout) {
  const { center, axis, length, width, count, gap } = layout, ground = .16;
  type Vector = [number, number, number];
  const metal: THREE.BufferGeometry[] = [], bases: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [];
  const rims: THREE.BufferGeometry[] = [], nets: THREE.BufferGeometry[] = [];
  const baskets = [];
  const rotation = Math.atan2(axis[0], axis[1]);
  const world = (x: number, z: number): Point => [center[0] + axis[1] * x + axis[0] * z, center[1] - axis[0] * x + axis[1] * z];
  const point = (x: number, y: number, z: number): Vector => { const p = world(x, z); return [p[0], ground + y, p[1]]; };
  const box = (parts: THREE.BufferGeometry[], x: number, y: number, z: number, w: number, h: number, d: number) => {
    const geometry = new THREE.BoxGeometry(w, h, d); geometry.rotateY(rotation); geometry.translate(...point(x, y, z)); parts.push(geometry);
  };
  const bar = (parts: THREE.BufferGeometry[], from: Vector, to: Vector, size: number) => parts.push(architectureBar(from, to, size));
  for (let courtIndex = 0; courtIndex < count; courtIndex++) {
    const x = (courtIndex - (count - 1) / 2) * (width + gap);
    for (const end of [-1, 1]) {
      const baseline = end * length / 2, board = baseline - end * 1.2, ring = baseline - end * 1.575, support = baseline + end * 1.2;
      const baseRing = [[x - .6, support - .65], [x + .6, support - .65], [x + .6, support + .65], [x - .6, support + .65], [x - .6, support - .65]];
      baskets.push({ courtIndex, end, baseline: world(x, baseline), inward: [-end * axis[0], -end * axis[1]] as Point,
        ring: point(x, 3.05, ring), boardCenter: point(x, 3.425, board), support: world(x, support),
        base: { outer: baseRing.map(([u, v]) => world(u, v)), holes: [] } as Shape });
      // A compact outdoor base and upright stay completely behind the baseline.
      box(bases, x, .24, support, 1.2, .48, 1.3);
      bar(metal, point(x, .48, support), point(x, 3.5, support), .16);
      bar(metal, point(x, 3.5, support), point(x, 3.5, board + end * .12), .13);
      bar(metal, point(x, 2.25, support), point(x, 3.5, board + end * .55), .085);
      box(glass, x, 3.425, board, 1.8, 1.05, .045);
      for (const u of [x - .9, x + .9]) bar(metal, point(u, 2.9, board), point(u, 3.95, board), .045);
      for (const y of [2.9, 3.95]) bar(metal, point(x - .9, y, board), point(x + .9, y, board), .045);
      // Painted target sits on the inward face of the transparent board.
      const face = board - end * .028;
      for (const u of [x - .295, x + .295]) bar(nets, point(u, 3.025, face), point(u, 3.475, face), .018);
      for (const y of [3.025, 3.475]) bar(nets, point(x - .295, y, face), point(x + .295, y, face), .018);
      const hoop = new THREE.TorusGeometry(.225, .022, 5, 24); hoop.rotateX(Math.PI / 2); hoop.translate(...point(x, 3.05, ring)); rims.push(hoop);
      bar(rims, point(x, 3.05, board), point(x, 3.05, ring + end * .225), .04);
      // A few crossed cords describe the hanging net without a solid cone.
      for (let i = 0; i < 10; i++) {
        const angle = i * Math.PI / 5, top = point(x + .205 * Math.cos(angle), 3.04, ring + .205 * Math.sin(angle));
        for (const shift of [-.5, .5]) {
          const lower = angle + shift * Math.PI / 5;
          bar(nets, top, point(x + .11 * Math.cos(lower), 2.63, ring + .11 * Math.sin(lower)), .012);
        }
      }
    }
  }
  return { metal: architectureBatch(metal), bases: architectureBatch(bases), glass: architectureBatch(glass),
    rims: architectureBatch(rims), nets: architectureBatch(nets), baskets };
}

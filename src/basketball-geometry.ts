import polygonClipping from 'polygon-clipping';
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

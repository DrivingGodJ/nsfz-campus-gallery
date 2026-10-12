import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { architectureBatch } from './architecture-geometry.ts';
import { buildingGeometry, passageShape } from './building-geometry.ts';
import type { Building, Feature, Point } from './types';

export const LAB_REAR_GROUND_COLORS = { paving: '#b2b0a5', joints: '#8d928b', curbs: '#c7c8bd', soil: '#697362', metal: '#505c56' };

// The supplied rear photograph shows a clear tiled walk and a tree row on its
// outside edge. Dimensions are estimates; both strips follow the actual wall.
export function laboratoryRearLandscape(building: Building) {
  const parts: Record<keyof typeof LAB_REAR_GROUND_COLORS, THREE.BufferGeometry[]> = { paving: [], joints: [], curbs: [], soil: [], metal: [] };
  const trees: NonNullable<Feature['trees']> = [], footprints: Point[][] = [];
  const roads = (building.groundPassages || []).map(p => { const shape = passageShape(p); return [shape.outer, ...shape.holes] as polygonClipping.Polygon; });
  for (const [start, end] of [[11, 10], [9, 8]]) {
    const from = building.outer[start], to = building.outer[end];
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const along: Point = [(to[0] - from[0]) / length, (to[1] - from[1]) / length], outward: Point = [-along[1], along[0]];
    const at = (u: number, v: number): Point => [from[0] + along[0] * u + outward[0] * v, from[1] + along[1] * u + outward[1] * v];
    const box = (kind: keyof typeof parts, u: number, v: number, width: number, depth: number, y: number, rise: number) => {
      if (kind === 'curbs') {
        const ring = [at(u - width / 2, v - depth / 2), at(u + width / 2, v - depth / 2), at(u + width / 2, v + depth / 2), at(u - width / 2, v + depth / 2), at(u - width / 2, v - depth / 2)];
        const pieces = roads.length ? polygonClipping.difference([ring], ...roads) : [[ring]];
        for (const [outer, ...holes] of pieces) parts.curbs.push(buildingGeometry({ outer: outer as Point[], holes: holes as Point[][] }, rise, 3.6).rotateX(-Math.PI / 2).translate(0, y, 0));
        return;
      }
      const point = at(u, v);
      parts[kind].push(new THREE.BoxGeometry(width, rise, depth).rotateY(-Math.atan2(along[1], along[0])).translate(point[0], y + rise / 2, point[1]));
    };
    const ring = [at(.25, .14), at(length - .25, .14), at(length - .25, 7.4), at(.25, 7.4), at(.25, .14)];
    footprints.push(ring);
    box('paving', length / 2, 3.77, length - .5, 7.26, .078, .018);
    box('curbs', length / 2, 7.43, length - .5, .16, .07, .1);
    for (let u = 1.4; u < length - .4; u += 1.2) box('joints', u, 3.77, .012, 7.26, .096, .003);
    for (let v = 1.34; v < 7.3; v += 1.2) box('joints', length / 2, v, length - .5, .012, .096, .003);
    for (let u = 3; u < length - 3; u += 7) {
      const pit = [at(u - .85, 5.35), at(u + .85, 5.35), at(u + .85, 7.05), at(u - .85, 7.05), at(u - .85, 5.35)];
      if (roads.some(road => polygonClipping.intersection([pit], road).length)) continue;
      trees.push({ position: at(u, 6.2), radius: 2.8, height: 11, kind: 'plane' });
      box('soil', u, 6.2, 1.45, 1.45, .1, .01);
      for (const side of [-1, 1]) {
        box('curbs', u + side * .77, 6.2, .09, 1.63, .1, .04);
        box('curbs', u, 6.2 + side * .77, 1.45, .09, .1, .04);
      }
    }
    box('metal', length * .63, 3.25, .9, .65, .1, .015);
    for (const side of [-1, 1]) box('joints', length * .63 + side * .43, 3.25, .012, .62, .116, .005);
  }
  const a = building.outer[10], b = building.outer[9], size = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const axis: Point = [(b[0] - a[0]) / size, (b[1] - a[1]) / size], out: Point = [-axis[1], axis[0]];
  const point = (u: number, v: number): Point => [a[0] + axis[0] * u + out[0] * v, a[1] + axis[1] * u + out[1] * v];
  const join = [point(-1, -.5), point(size + 1, -.5), point(size + 1, 7.4), point(-1, 7.4), point(-1, -.5)];
  for (const [outer, ...holes] of polygonClipping.difference([join], [building.outer, ...building.holes])) {
    footprints.push(outer as Point[]);
    parts.paving.push(buildingGeometry({ outer: outer as Point[], holes: holes as Point[][] }, .018, 3.6).rotateX(-Math.PI / 2).translate(0, .078, 0));
  }
  return { geometry: Object.fromEntries(Object.entries(parts).map(([kind, geometries]) => [kind, architectureBatch(geometries, false)])) as Record<keyof typeof parts, THREE.BufferGeometry>, trees, footprints };
}

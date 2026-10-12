import * as THREE from 'three';
import { architectureBatch } from './architecture-geometry.ts';
import { buildingGeometry } from './building-geometry.ts';
import type { Building, Point } from './types';

export const WEST_COLONNADE_ID = 'way/1233313439';
const BASE = .12, SLAB = .25;

// _DSC2548 and the supplied lamp photo show five open galleries, never a glass
// curtain wall. Upper piers are grey brick; only the wide bottom piers, floor
// beams and guard rails are pale stone. Repeats are estimated from those views.
export function westColonnadeFaces(building: Building) {
  const ring = building.outer;
  const edges = ring.slice(1).map((to, edge) => ({ from: ring[edge], to, length: Math.hypot(to[0] - ring[edge][0], to[1] - ring[edge][1]) }));
  const area = edges.reduce((sum, edge) => sum + edge.from[0] * edge.to[1] - edge.to[0] * edge.from[1], 0);
  return edges.sort((a, b) => b.length - a.length).slice(0, 2).map(edge => {
    const axis: Point = [(edge.to[0] - edge.from[0]) / edge.length, (edge.to[1] - edge.from[1]) / edge.length];
    const inward: Point = [-axis[1] * Math.sign(area), axis[0] * Math.sign(area)];
    const at = (u: number, v: number): Point => [edge.from[0] + axis[0] * u + inward[0] * v, edge.from[1] + axis[1] * u + inward[1] * v];
    const bays = Math.max(1, Math.round((edge.length - .65) / 3.2));
    const stations = Array.from({ length: bays + 1 }, (_, i) => .325 + (edge.length - .65) * i / bays);
    return { ...edge, axis, inward, at, stations };
  });
}

export function westColonnadeGeometry(building: Building, height: number, floorHeight: number, cutawayHeight?: number) {
  const slabs: THREE.BufferGeometry[] = [], masonry: THREE.BufferGeometry[] = [], brick: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
  const shown = Math.min(height, cutawayHeight ?? height), faces = westColonnadeFaces(building);
  const slab = (bottom: number, top: number) => slabs.push(buildingGeometry(building, top - bottom, floorHeight).rotateX(-Math.PI / 2).translate(0, BASE + bottom, 0));
  const floors = Math.ceil(height / floorHeight - 1e-8);
  for (let floor = 0; floor < floors; floor++) {
    const bottom = floor * floorHeight, ceiling = Math.min(height, (floor + 1) * floorHeight);
    if (bottom + SLAB >= shown) break;
    slab(bottom, bottom + SLAB);
    const hasCeiling = cutawayHeight === undefined || ceiling < cutawayHeight - 1e-6;
    for (const face of faces) {
      const box = (parts: THREE.BufferGeometry[], u0: number, u1: number, v0: number, v1: number, y0: number, y1: number) => {
        y1 = Math.min(y1, shown); if (y1 <= y0) return;
        const [x, z] = face.at((u0 + u1) / 2, (v0 + v1) / 2);
        parts.push(new THREE.BoxGeometry(u1 - u0, y1 - y0, v1 - v0).rotateY(-Math.atan2(face.axis[1], face.axis[0])).translate(x, BASE + (y0 + y1) / 2, z));
      };
      const pier = floor === 0 ? .65 : .48, y = bottom + SLAB;
      for (const u of face.stations) {
        box(floor === 0 ? masonry : brick, u - pier / 2, u + pier / 2, .04, .04 + pier, y, ceiling - .55);
        box(masonry, u - pier / 2 - .1, u + pier / 2 + .1, .01, .14 + pier, ceiling - .67, ceiling - .55);
      }
      if (hasCeiling) box(masonry, 0, face.length, 0, .74, ceiling - .55, ceiling);
      for (let bay = 1; bay < face.stations.length; bay++) {
        const from = face.stations[bay - 1] + pier / 2;
        // The lower ramp enters beside the southeast end. Its ground-level
        // opening must not inherit the upper floors' continuous balustrade.
        const entry = floor === 0 && Math.hypot(face.to[0] - building.outer[1][0], face.to[1] - building.outer[1][1]) < 1e-6;
        const to = Math.min(face.stations[bay] - pier / 2, entry ? face.length - 3.2 : Infinity);
        if (to <= from) continue;
        box(rails, from, to, .12, .32, y, y + .12);
        box(rails, from, to, .11, .34, y + .95, y + 1.07);
        const count = Math.max(1, Math.ceil((to - from) / .23));
        for (let i = 1; i < count; i++) {
          const u = from + (to - from) * i / count;
          box(rails, u - .035, u + .035, .17, .27, y + .12, y + .95);
        }
      }
    }
  }
  if (cutawayHeight === undefined || cutawayHeight > height + 1e-6) slab(height - SLAB, height);
  return { slabs: architectureBatch(slabs), masonry: architectureBatch(masonry), brick: architectureBatch(brick), rails: architectureBatch(rails, false) };
}

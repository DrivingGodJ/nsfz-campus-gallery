import * as THREE from 'three';
import { architectureBatch } from './architecture-geometry.ts';
import { roadFootprint } from './road-geometry.ts';
import { passageFootprint } from './underground-geometry.ts';
import { trimRailChains } from './garden-geometry.ts';
import { specimenLampParts, GARDEN_LAMP_COLORS } from './specimen-grove.ts';
import type { Feature, Point, Shape } from './types';

const AVENUE = 'way/1233313449', CROSS_ROAD = 'way/1233313445';
export const AVENUE_GARDEN_COLORS = { stone: '#bab3a4', carving: '#cec7b6', ...GARDEN_LAMP_COLORS };
const inside = (point: Point, shape: Shape) => {
  const ringContains = (ring: Point[]) => {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      if ((ring[i][1] > point[1]) !== (ring[j][1] > point[1]) && point[0] <
        (ring[j][0] - ring[i][0]) * (point[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
    }
    return hit;
  };
  return ringContains(shape.outer) && !shape.holes.some(ringContains);
};

export function avenueGardenLayout(features: Feature[], buildings: Shape[]) {
  const avenue = features.find(feature => feature.id === AVENUE);
  const road = features.find(feature => feature.id === CROSS_ROAD);
  if (!avenue?.points || !road?.points) return { lamps: [] as Point[], rails: [] as Point[][] };
  const [a, b] = avenue.points, length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const axis: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], offset = (avenue.width ?? 2) / 2 + .55;
  const roads = features.filter(feature => feature.type === 'path' && feature.points && feature.id !== AVENUE).map(roadFootprint);
  const trees = features.flatMap(feature => feature.trees ?? []);
  const lamps: Point[] = [];
  // Follow the whole source avenue, including the stretch outside the annotated view.
  for (let along = 3; along < length - 3; along += 5) for (const side of [-1, 1]) {
    const point: Point = [a[0] + axis[0] * along - axis[1] * offset * side, a[1] + axis[1] * along + axis[0] * offset * side];
    const box: Shape = { outer: [[point[0] - .25, point[1] - .25], [point[0] + .25, point[1] - .25],
      [point[0] + .25, point[1] + .25], [point[0] - .25, point[1] + .25]], holes: [] };
    if ([...buildings, ...roads].some(shape => box.outer.some(corner => inside(corner, shape))) ||
      trees.some(tree => Math.hypot(tree.position[0] - point[0], tree.position[1] - point[1]) < .75)) continue;
    lamps.push(point);
  }
  // Follow the marked stretch around the avenue junction. Keep its entrance
  // and the new garden branch open, including clearance for the stone caps.
  const junction = road.points[1], end = road.points[0];
  const run = Math.hypot(end[0] - junction[0], end[1] - junction[1]);
  const dx = (end[0] - junction[0]) / run, dz = (end[1] - junction[1]) / run;
  const chains = [-1, 1].map(side => [-3.5, 7.5].map(along =>
    [junction[0] + dx * along - dz * ((road.width ?? 4) / 2 + .2) * side,
      junction[1] + dz * along + dx * ((road.width ?? 4) / 2 + .2) * side] as Point));
  const openings = features.filter(feature => feature.type === 'path' && feature.points && feature.id !== CROSS_ROAD)
    .map(feature => passageFootprint(feature.points!, (feature.width ?? 2) + .7));
  const rails = trimRailChains(chains.map(chain => chain.map(([x, z]) => [x, 0, z])), openings)
    .map(chain => chain.map(([x, , z]): Point => [x, z]));
  return { lamps, rails };
}

export function avenueGardenGeometry(features: Feature[], buildings: Shape[]) {
  const { lamps, rails } = avenueGardenLayout(features, buildings);
  const parts = { stone: [] as THREE.BufferGeometry[], carving: [] as THREE.BufferGeometry[], ...specimenLampParts(lamps) };
  const base = .115;
  for (const [a, b] of rails) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]), angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const at = (u: number, y: number): [number, number, number] => [a[0] + Math.cos(angle) * u, base + y, a[1] + Math.sin(angle) * u];
    const box = (size: [number, number, number], u: number, y: number) =>
      parts.stone.push(new THREE.BoxGeometry(...size).rotateY(-angle).translate(...at(u, y)));
    if (length < .8) {
      box([.24, .95, .24], length / 2, .475); box([.33, .09, .33], length / 2, .995);
      box([.3, .09, .3], length / 2, .045); continue;
    }
    const bays = Math.ceil(length / 2), span = length / bays;
    for (let i = 0; i <= bays; i++) {
      box([.24, .95, .24], i * span, .475); box([.33, .09, .33], i * span, .995);
      box([.3, .09, .3], i * span, .045);
    }
    for (let i = 0; i < bays; i++) {
      const middle = (i + .5) * span;
      box([span - .22, .16, .17], middle, .17);
      box([span - .22, .13, .2], middle, .89);
      box([span - .22, .085, .14], middle, .51);
      // Circular flower medallions and two open horizontal slots match DSC07990.
      parts.stone.push(new THREE.CylinderGeometry(.235, .235, .14, 20).rotateX(Math.PI / 2).rotateY(-angle).translate(...at(middle, .56)));
      parts.carving.push(new THREE.TorusGeometry(.19, .018, 5, 20).rotateY(-angle).translate(...at(middle, .56)));
      for (let petal = 0; petal < 6; petal++) {
        const t = petal * Math.PI / 3;
        for (const side of [-1, 1]) parts.carving.push(new THREE.SphereGeometry(1, 6, 4).scale(.045, .075, .025).rotateZ(t)
          .translate(Math.sin(t) * .085, Math.cos(t) * .085, .08 * side).rotateY(-angle).translate(...at(middle, .56)));
      }
    }
  }
  return Object.fromEntries(Object.entries(parts).map(([key, items]) => [key, architectureBatch(items)])) as Record<keyof typeof parts, THREE.BufferGeometry>;
}

import * as THREE from 'three';
import { architectureBatch, architectureBar } from './architecture-geometry.ts';
import type { Point, Shape, WoodenHutModel } from './types';

export function woodenHutFootprint(model: WoodenHutModel, roof = false): Shape {
  const scale = Math.hypot(...model.axis), [dx, dz] = model.axis.map(value => value / scale);
  const u = model.width / 2 + (roof ? model.overhang : 0), v = model.depth / 2 + (roof ? model.overhang : 0);
  const at = (a: number, b: number): Point => [model.center[0] + dx * a - dz * b, model.center[1] + dz * a + dx * b];
  const outer = [at(-u, -v), at(u, -v), at(u, v), at(-u, v)];
  return { outer: [...outer, outer[0]], holes: [] };
}

// DSC07783: horizontal timber siding, white corner/window trims and a small
// pitched roof. Both visible windows and the side door open through the shell.
export function woodenHutGeometry(model: WoodenHutModel) {
  const parts = { wood: [] as THREE.BufferGeometry[], trim: [] as THREE.BufferGeometry[], glass: [] as THREE.BufferGeometry[], roof: [] as THREE.BufferGeometry[], base: [] as THREE.BufferGeometry[] };
  const w = model.width, d = model.depth, h = model.wallHeight, rise = model.roofRise, over = model.overhang;
  const box = (kind: keyof typeof parts, x: number, y: number, z: number, width: number, height: number, depth: number) => parts[kind].push(new THREE.BoxGeometry(width, height, depth).translate(x, y, z));
  type Opening = { left: number; right: number; bottom: number; top: number };
  const front: Opening[] = [{ left: -1.48, right: -.72, bottom: .13, top: 2.02 }, { left: -.35, right: 1.13, bottom: .83, top: 1.89 }];
  const end: Opening[] = [{ left: -.65, right: .65, bottom: .83, top: 1.89 }];
  const wall = (length: number, fixed: number, swapped: boolean, openings: Opening[]) => {
    const us = [-length / 2, length / 2, ...openings.flatMap(o => [o.left, o.right])].sort((a, b) => a - b);
    const ys = [0, h, ...openings.flatMap(o => [o.bottom, o.top]), ...Array.from({ length: Math.ceil(h / .19) }, (_, i) => i * .19)].filter(y => y >= 0 && y <= h).sort((a, b) => a - b);
    for (let j = 1; j < ys.length; j++) for (let i = 1; i < us.length; i++) {
      const a = us[i - 1], b = us[i], bottom = ys[j - 1], top = ys[j], u = (a + b) / 2, y = (bottom + top) / 2;
      if (b - a < .001 || top - bottom < .001 || openings.some(o => u > o.left && u < o.right && y > o.bottom && y < o.top)) continue;
      box('wood', swapped ? fixed : u, .15 + y, swapped ? u : fixed, swapped ? .08 : b - a, top - bottom - .003, swapped ? b - a : .08);
    }
    for (const o of openings) {
      const center = (o.left + o.right) / 2, width = o.right - o.left, height = o.top - o.bottom;
      box('glass', swapped ? fixed : center, .15 + (o.bottom + o.top) / 2, swapped ? center : fixed, swapped ? .025 : width, height, swapped ? width : .025);
      for (const u of [o.left, center, o.right]) box('trim', swapped ? fixed : u, .15 + (o.bottom + o.top) / 2, swapped ? u : fixed, swapped ? .13 : .065, height + .1, swapped ? .065 : .13);
      for (const y of [o.bottom, o.top]) box('trim', swapped ? fixed : center, .15 + y, swapped ? center : fixed, swapped ? .13 : width + .1, .065, swapped ? width + .1 : .13);
    }
  };
  wall(w, d / 2, false, front); wall(w, -d / 2, false, []);
  wall(d, -w / 2, true, end); wall(d, w / 2, true, []);
  for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) box('trim', x, .15 + h / 2, z, .1, h + .05, .1);
  box('base', 0, .075, 0, w + .12, .15, d + .12);
  box('trim', 0, .16, d / 2 + .02, w + .1, .12, .12);
  box('trim', 0, .16, -d / 2 - .02, w + .1, .12, .12);
  const gable = new THREE.Shape(); gable.moveTo(-d / 2, 0); gable.lineTo(d / 2, 0); gable.lineTo(0, rise); gable.closePath();
  for (const x of [-w / 2, w / 2]) parts.wood.push(new THREE.ExtrudeGeometry(gable, { depth: .08, bevelEnabled: false }).rotateY(Math.PI / 2).translate(x - .04, .15 + h, 0));
  const half = d / 2 + over, pitch = Math.atan2(rise, d / 2), roofLength = half / Math.cos(pitch);
  for (const side of [-1, 1]) parts.roof.push(new THREE.BoxGeometry(w + 2 * over, .09, roofLength).rotateX(side * pitch).translate(0, .15 + h + rise - half * Math.tan(pitch) / 2, side * half / 2));
  for (const x of [-w / 2 - over, w / 2 + over]) for (const side of [-1, 1]) parts.trim.push(architectureBar([x, .15 + h + rise, 0], [x, .15 + h + rise - half * Math.tan(pitch), side * half], .13, .11));
  for (const side of [-1, 1]) box('trim', 0, .15 + h + rise - half * Math.tan(pitch), side * half, w + 2 * over, .13, .11);
  const geometry = Object.fromEntries(Object.entries(parts).map(([kind, pieces]) => [kind, architectureBatch(pieces, kind !== 'glass')])) as Record<keyof typeof parts, THREE.BufferGeometry>;
  for (const part of Object.values(geometry)) { part.computeBoundingBox(); part.computeBoundingSphere(); }
  return geometry;
}

import * as THREE from 'three';
import { architectureBatch } from './architecture-geometry.ts';
import type { Building } from './types';

export const BOUNDARY_HOUSE_COLORS = { walls: '#73786e', joints: '#62685e', roof: '#4b5049', eaves: '#b1aea0', door: '#793c34', hardware: '#aaa391' };
type Kind = keyof typeof BOUNDARY_HOUSE_COLORS;

// DSC06870 confirms a grey-brick shed, a solid red door and an overhanging
// sloped roof. The unseen roof/back are simplified; no glazing is inferred.
export function boundaryHouseGeometry(building: Building, height: number, cutaway = false) {
  const [a, b, c] = building.outer;
  const width = Math.hypot(b[0] - a[0], b[1] - a[1]), length = Math.hypot(c[0] - b[0], c[1] - b[1]);
  const ux = (b[0] - a[0]) / width, uz = (b[1] - a[1]) / width;
  const transform = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux));
  transform.setPosition((a[0] + b[0]) / 2, .12, (a[1] + b[1]) / 2);
  const parts: Record<Kind, THREE.BufferGeometry[]> = { walls: [], joints: [], roof: [], eaves: [], door: [], hardware: [] };
  const rise = .55, low = height - rise - .15, high = low + rise, thickness = .2, overhang = .22;
  const doorWidth = Math.min(.9, width * .4), doorHeight = Math.min(2.1, low - .18);
  const box = (kind: Kind, x: number, y: number, z: number, w: number, h: number, d: number) => parts[kind].push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const profile = (points: number[][], depth: number, z: number, kind: Kind) => parts[kind].push(new THREE.ExtrudeGeometry(
    new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: false }).translate(0, 0, z));
  // The front door is a real notch in the brick shell, with a recessed solid
  // leaf behind it. The surrounding wall never sits in front of the door.
  profile([[-width / 2, 0], [-doorWidth / 2, 0], [-doorWidth / 2, doorHeight], [doorWidth / 2, doorHeight], [doorWidth / 2, 0], [width / 2, 0], [width / 2, high], [-width / 2, low]], thickness, -thickness, 'walls');
  profile([[-width / 2, 0], [width / 2, 0], [width / 2, high], [-width / 2, low]], thickness, -length, 'walls');
  box('walls', -width / 2 + thickness / 2, low / 2, -length / 2, thickness, low, length);
  box('walls', width / 2 - thickness / 2, high / 2, -length / 2, thickness, high, length);
  box('walls', 0, .04, -length / 2, width, .08, length);
  box('door', 0, doorHeight / 2, -.1, doorWidth, doorHeight, .045);
  for (const y of [.35, 1.25]) box('door', 0, y, -.073, doorWidth - .13, .055, .015);
  box('hardware', doorWidth / 2 - .1, .95, -.062, .045, .13, .025);
  // A few thin batched brick courses provide scale without photo textures.
  for (let y = .16; y < low; y += .16) {
    const spans = y < doorHeight ? [[-width / 2, -doorWidth / 2], [doorWidth / 2, width / 2]] : [[-width / 2, width / 2]];
    for (const [from, to] of spans) box('joints', (from + to) / 2, y, .004, to - from, .008, .006);
    box('joints', -width / 2 - .004, y, -length / 2, .006, .008, length);
    box('joints', width / 2 + .004, y, -length / 2, .006, .008, length);
  }
  if (!cutaway) {
    const x = width / 2 + overhang, roofY = (at: number) => low + rise * (at / width + .5);
    profile([[-x, roofY(-x)], [x, roofY(x)], [x, roofY(x) + .1], [-x, roofY(-x) + .1]], length + 2 * overhang, -length - overhang, 'roof');
    profile([[-x, roofY(-x) - .09], [x, roofY(x) - .09], [x, roofY(x)], [-x, roofY(-x)]], .1, overhang - .1, 'eaves');
    box('eaves', -x, roofY(-x) - .045, -length / 2, .07, .09, length + 2 * overhang);
    box('eaves', x, roofY(x) - .045, -length / 2, .07, .09, length + 2 * overhang);
  }
  return Object.fromEntries(Object.entries(parts).map(([kind, list]) => [kind, architectureBatch(list).applyMatrix4(transform)])) as Record<Kind, THREE.BufferGeometry>;
}

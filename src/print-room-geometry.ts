import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import type { Building } from './types';

export const PRINT_ROOM_COLORS = { walls: '#827e6e', joints: '#625f53', roof: '#a66147', tiles: '#bf7b58', eaves: '#afa696', plaque: '#77462e' };
type Kind = keyof typeof PRINT_ROOM_COLORS;

// The first edge is the long west-facing wall, ordered south to north.
export function printRoomLayout(building: Building, height: number) {
  const [a, b, c] = building.outer;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]), depth = Math.hypot(c[0] - b[0], c[1] - b[1]);
  // Local +x runs north to south so local -z lies inside this footprint.
  const ux = (a[0] - b[0]) / length, uz = (a[1] - b[1]) / length;
  const transform = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux));
  transform.setPosition((a[0] + b[0]) / 2, .12, (a[1] + b[1]) / 2);
  return { length, depth, transform, eave: height - .65, ridge: height - .1, plaqueX: length / 2 - 1.25 };
}

export function printRoomSignGeometry(building: Building, height: number) {
  const { transform, plaqueX } = printRoomLayout(building, height);
  return new THREE.PlaneGeometry(1.96, .5).translate(plaqueX, 1.95, .111).applyMatrix4(transform);
}

// DSC06904 shows the long red-tile pitched roof; DSC07566 shows solid grey
// brick and a small brown plaque. Neither confirms a room window or door.
export function printRoomGeometry(building: Building, height: number, cutaway = false) {
  const { length, depth, transform, eave, ridge, plaqueX } = printRoomLayout(building, height);
  const parts: Record<Kind, THREE.BufferGeometry[]> = { walls: [], joints: [], roof: [], tiles: [], eaves: [], plaque: [] };
  const wall = .22, overhang = .3;
  const box = (kind: Kind, x: number, y: number, z: number, w: number, h: number, d: number) => parts[kind].push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const profile = (points: number[][], width: number, x: number, kind: Kind) => parts[kind].push(new THREE.ExtrudeGeometry(
    new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y))), { depth: width, bevelEnabled: false }).rotateY(Math.PI / 2).translate(x, 0, 0));
  for (const z of [-wall / 2, -depth + wall / 2]) box('walls', 0, eave / 2, z, length, eave, wall);
  const end = [[0, 0], [depth, 0], [depth, eave], [depth / 2, ridge], [0, eave]];
  for (const x of [-length / 2, length / 2 - wall]) profile(end, wall, x, 'walls');
  box('walls', 0, .04, -depth / 2, length, .08, depth);
  // Batched shallow mortar courses read as masonry without a photo texture.
  for (let y = .18; y < eave; y += .18) {
    box('joints', 0, y, .004, length, .01, .007);
    for (const x of [-length / 2 - .004, length / 2 + .004]) box('joints', x, y, -depth / 2, .007, .01, depth);
    for (let x = -length / 2 + (Math.round(y / .18) % 2 ? .3 : .6); x < length / 2; x += .6) box('joints', x, y - .09, .004, .008, .17, .007);
  }
  box('plaque', plaqueX, 1.95, .055, 2.1, .6, .1);
  if (!cutaway) {
    const roofY = (z: number) => ridge - (ridge - eave) * Math.abs(z - depth / 2) / (depth / 2);
    const rim = roofY(-overhang), x0 = -length / 2 - overhang, roofLength = length + 2 * overhang;
    profile([[-overhang, rim], [depth / 2, ridge], [depth + overhang, rim], [depth + overhang, rim + .1], [depth / 2, ridge + .1], [-overhang, rim + .1]], roofLength, x0, 'roof');
    for (const z of [overhang, -depth - overhang]) box('eaves', 0, rim - .04, z, roofLength, .1, .1);
    // Raised tile seams are merged once per material, not individual React meshes.
    for (let x = x0 + .16; x < -x0; x += .32) {
      parts.tiles.push(architectureBar([x, rim + .11, overhang], [x, ridge + .11, -depth / 2], .035));
      parts.tiles.push(architectureBar([x, ridge + .11, -depth / 2], [x, rim + .11, -depth - overhang], .035));
    }
    for (let q = -overhang; q <= depth + overhang; q += .38) box('tiles', 0, roofY(q) + .11, -q, roofLength, .025, .025);
    box('tiles', 0, ridge + .135, -depth / 2, roofLength, .07, .09);
  }
  return Object.fromEntries(Object.entries(parts).map(([kind, list]) => [kind, architectureBatch(list).applyMatrix4(transform)])) as Record<Kind, THREE.BufferGeometry>;
}

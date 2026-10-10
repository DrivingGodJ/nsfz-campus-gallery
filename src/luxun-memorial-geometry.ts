import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import type { Building } from './types';

export const LUXUN_MEMORIAL_COLORS = { brick: '#888a80', joints: '#666c63', stone: '#b6b6a9', floor: '#a2a89f', frames: '#434b43', roof: '#a05d46', tiles: '#b57254' };
type Kind = keyof typeof LUXUN_MEMORIAL_COLORS;

export function luxunMemorialLayout(building: Building) {
  // The photographed south arcade is the west-to-east third edge.
  const [a, b] = [building.outer[2], building.outer[3]], north = building.outer[1];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]), depth = Math.hypot(north[0] - a[0], north[1] - a[1]);
  const ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
  const transform = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux));
  transform.setPosition(a[0], .12, a[1]);
  // Projected pillars in DSC06905 are about 2.45 m apart; preserve that scale.
  return { length, depth, transform, corridor: 2.75, bays: 12, pier: .5 };
}

export function luxunMemorialGeometry(building: Building, height: number, floorHeight: number, cutawayHeight?: number) {
  const { length, depth, transform, corridor, bays, pier } = luxunMemorialLayout(building);
  const shown = Math.min(height, cutawayHeight ?? height), roofVisible = cutawayHeight === undefined || cutawayHeight > height;
  const parts: Record<Kind, THREE.BufferGeometry[]> = { brick: [], joints: [], stone: [], floor: [], frames: [], roof: [], tiles: [] };
  const wall = .28, bay = length / bays;
  const box = (kind: Kind, x: number, y: number, z: number, w: number, h: number, d: number) => {
    if (w <= 0 || h <= 0 || d <= 0) return;
    // Mortar is a shallow surface mark: two triangles rather than a tiny box.
    const geometry = kind === 'joints' ? d > .1 ? new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2) : new THREE.PlaneGeometry(w, h) : new THREE.BoxGeometry(w, h, d);
    parts[kind].push(geometry.translate(x, y, z));
  };
  const extrusion = (kind: Kind, points: number[][], thickness: number, x: number, y: number, z: number, end = false) => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(points.map(p => new THREE.Vector2(p[0], p[1]))), { depth: thickness, bevelEnabled: false });
    if (end) g.rotateY(Math.PI / 2);
    parts[kind].push(g.translate(x, y, z));
  };
  // A bottom-connected arch notch is a real through-opening, including the
  // two end doors seen down the first-floor passage in IMG_9807.
  const archNotch = (width: number, top: number, open: number, spring: number, rise: number) => {
    const left = (width - open) / 2, right = left + open;
    const curve = Array.from({ length: 17 }, (_, i) => {
      const angle = Math.PI - Math.PI * i / 16;
      return [width / 2 + open / 2 * Math.cos(angle), spring + rise * Math.sin(angle)];
    });
    return [[0, 0], [left, 0], ...curve, [right, 0], [width, 0], [width, top], [0, top]];
  };
  box('floor', length / 2, .065, -depth / 2, length, .13, depth);
  box('brick', length / 2, shown / 2, -depth + wall / 2, length, shown, wall);
  for (const x of [wall / 2, length - wall / 2]) box('brick', x, shown / 2, -(depth + corridor) / 2, wall, shown, depth - corridor);
  // Flat stone ceilings/slabs keep the photographed corridor covered. Floor
  // selection removes the ceiling immediately above the selected floor.
  for (let y = floorHeight; y < shown - .001; y += floorHeight) box('floor', length / 2, y - .09, -depth / 2, length, .18, depth);
  if (roofVisible) box('floor', length / 2, height - .09, -depth / 2, length, .18, depth);
  for (let floor = 0; floor * floorHeight < shown - .001; floor++) {
    const base = floor * floorHeight, storey = Math.min(floorHeight, shown - base), upper = floor > 0;
    const archRise = Math.min(1.15, storey * .31), spring = storey - .2 - archRise;
    for (let i = 0; i <= bays; i++) {
      const x = i === 0 ? pier / 2 : i === bays ? length - pier / 2 : i * bay;
      box('brick', x, base + storey / 2, -.3, pier, storey, .6);
      box('stone', x, base + .16, -.31, pier + .1, .32, .64);
      if (upper) box('stone', x, base + spring - .08, -.32, pier + .16, .17, .68);
      for (let y = .4; y < storey - .12; y += .22) {
        box('joints', x, base + y, .004, pier, .012, .008);
        box('joints', x, base + y - .1, .004, .009, .2, .008);
      }
    }
    for (let i = 0; i < bays; i++) {
      const from = i * bay + (i === 0 ? pier : pier / 2), to = (i + 1) * bay - (i === bays - 1 ? pier : pier / 2), span = to - from;
      // Both levels remain open. The upper rounded arches and white bottle
      // balustrades are directly visible in the snow-covered exterior photo.
      const arch = [[0, storey], [span, storey], ...Array.from({ length: 17 }, (_, n) => {
        const t = n / 16, x = span * (1 - t);
        return [x, spring + archRise * Math.sin(Math.PI * t)];
      })];
      extrusion('brick', arch, .6, from, base, -.6);
      if (upper) {
        box('stone', (from + to) / 2, base + .2, -.28, span, .16, .31);
        box('stone', (from + to) / 2, base + 1.14, -.28, span, .12, .36);
        const count = Math.max(2, Math.floor(span / .31));
        const bottle = [[.07, 0], [.075, .1], [.105, .2], [.066, .36], [.04, .65], [.073, .77], [.07, .82]].map(p => new THREE.Vector2(p[0], p[1]));
        for (let n = 0; n < count; n++) parts.stone.push(new THREE.LatheGeometry(bottle, 6).translate(from + span * (n + .5) / count, base + .27, -.28));
      }
      const openingWidth = 1.45, openingBottom = i % 3 === 1 ? 0 : .82, openingTop = Math.min(2.72, storey - .25), center = (i + .5) * bay;
      if (!upper) {
        // Recessed inner openings lead into the shaded room volume; there is
        // no black rectangle or guessed glass pane filling these apertures.
        box('brick', center, base + openingBottom / 2, -corridor - wall / 2, bay, openingBottom, wall);
        for (const side of [-1, 1]) box('brick', center + side * (bay + openingWidth) / 4, base + (openingBottom + openingTop) / 2, -corridor - wall / 2, (bay - openingWidth) / 2, openingTop - openingBottom, wall);
        box('brick', center, base + (openingTop + storey) / 2, -corridor - wall / 2, bay, storey - openingTop, wall);
        for (const x of [center - openingWidth / 2, center + openingWidth / 2]) box('frames', x, base + (openingBottom + openingTop) / 2, -corridor + .02, .075, openingTop - openingBottom, .07);
        for (const y of [openingBottom, openingTop]) box('frames', center, base + y, -corridor + .02, openingWidth + .07, .075, .07);
      } else box('brick', center, base + storey / 2, -corridor - wall / 2, bay, storey, wall);
      for (let y = .22; y < storey - .1; y += .22) {
        const spans = !upper && y > openingBottom && y < openingTop ? [[center - bay / 2, center - openingWidth / 2], [center + openingWidth / 2, center + bay / 2]] : [[center - bay / 2, center + bay / 2]];
        for (const [left, right] of spans) box('joints', (left + right) / 2, base + y, -corridor + .004, right - left, .01, .008);
      }
    }
    for (const x of [0, length - wall]) extrusion('brick', archNotch(corridor, storey, corridor - .82, Math.min(2.1, storey * .58), Math.min(.75, storey * .22)), wall, x, base, 0, true);
    // Large stone paving joints provide scale without repeating photo textures.
    for (let x = 0; x < length; x += .9) box('joints', x, base + .137, -corridor / 2, .012, .008, corridor);
    box('joints', length / 2, base + .137, -corridor / 2, length, .008, .012);
  }
  if (roofVisible) {
    // DJI_0048 establishes a red-tile hip roof, not the apparent white
    // roof colour in the snow photo. Four real pitched faces meet a short ridge.
    const overhang = .45, rise = 3, hip = depth / 2, halfDepth = depth / 2 + overhang;
    type Vertex = [number, number, number];
    const a: Vertex = [-overhang, height, overhang], b: Vertex = [length + overhang, height, overhang];
    const c: Vertex = [length + overhang, height, -depth - overhang], d: Vertex = [-overhang, height, -depth - overhang];
    const left: Vertex = [hip, height + rise, -depth / 2], right: Vertex = [length - hip, height + rise, -depth / 2];
    const vertices: number[] = [];
    const face = (...points: Vertex[]) => { for (let i = 1; i < points.length - 1; i++) vertices.push(...points[0], ...points[i], ...points[i + 1]); };
    for (const points of [[a, b, right, left], [d, left, right, c], [a, left, d], [b, c, right]]) {
      face(...points); face(...points.slice().reverse().map(([x, y, z]): Vertex => [x, y - .13, z]));
    }
    for (const [start, end] of [[a, b], [b, c], [c, d], [d, a]]) face(start, [start[0], start[1] - .13, start[2]], [end[0], end[1] - .13, end[2]], end);
    const roof = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); roof.computeVertexNormals(); parts.roof.push(roof);
    const roofY = (x: number, q: number) => height + rise * Math.max(0, Math.min(1, (q + overhang) / halfDepth, (depth + overhang - q) / halfDepth, (x + overhang) / (hip + overhang), (length + overhang - x) / (hip + overhang)));
    const tileLine = (points: [number, number][]) => points.slice(1).forEach(([x, q], i) => {
      const [fromX, fromQ] = points[i];
      if (Math.hypot(x - fromX, q - fromQ) > .005) parts.tiles.push(architectureBar([fromX, roofY(fromX, fromQ) + .015, -fromQ], [x, roofY(x, q) + .015, -q], .026));
    });
    for (let x = -.2; x < length + .2; x += .42) {
      const t = Math.min(1, (x + overhang) / (hip + overhang), (length + overhang - x) / (hip + overhang));
      tileLine([-overhang, -overhang + t * halfDepth, depth / 2, depth + overhang - t * halfDepth, depth + overhang].map(q => [x, q]));
    }
    for (let q = -overhang; q < depth + overhang; q += .5) {
      const t = Math.min(1, (q + overhang) / halfDepth, (depth + overhang - q) / halfDepth);
      tileLine([-overhang, -overhang + t * (hip + overhang), length + overhang - t * (hip + overhang), length + overhang].map(x => [x, q]));
    }
    for (const [start, end] of [[a, left], [d, left], [b, right], [c, right], [left, right]]) parts.tiles.push(architectureBar([start[0], start[1] + .04, start[2]], [end[0], end[1] + .04, end[2]], .09));
    for (const z of [overhang, -depth - overhang]) box('stone', length / 2, height - .06, z, length + overhang * 2, .14, .14);
  }
  return Object.fromEntries(Object.entries(parts).map(([kind, list]) => [kind, architectureBatch(list).applyMatrix4(transform)])) as Record<Kind, THREE.BufferGeometry>;
}

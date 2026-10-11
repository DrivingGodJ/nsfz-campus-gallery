import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import type { Building } from './types';

export const CAMPUS_SHOP_COLORS = { walls: '#e0d9c6', roof: '#558398', soffit: '#6e5947', fascia: '#e8e4d4', frames: '#bdc3ba', glass: '#91aaa6', floor: '#b8b5a5' };
type Kind = keyof typeof CAMPUS_SHOP_COLORS;

export function campusShopLayout(building: Building, height: number) {
  const edge = building.facade?.entry?.edge ?? 2, a = building.outer[edge + 1], b = building.outer[edge];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]), ux = (b[0] - a[0]) / length, uz = (b[1] - a[1]) / length;
  const center = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const depth = Math.max(...building.outer.map(p => (p[0] - center[0]) * uz - (p[1] - center[1]) * ux));
  const transform = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-uz, 0, ux));
  transform.setPosition(center[0], .12, center[1]);
  // DSC07402 and the April third-floor view confirm only a shallow central
  // glass entrance, cream gable and metal roof; hidden elevations stay plain.
  return { length, depth, transform, entryX: length * (.5 - (building.facade?.entry?.at ?? .5)),
    eave: height - .75, ridge: height - .08, entryWidth: 4.7, glassWidth: 4.2, projection: 1.05, gableRise: 1.1 };
}

export function campusShopGeometry(building: Building, height: number, cutaway = false) {
  const { length, depth, transform, entryX, eave, ridge, entryWidth, glassWidth, projection, gableRise } = campusShopLayout(building, height);
  const parts: Record<Kind, THREE.BufferGeometry[]> = { walls: [], roof: [], soffit: [], fascia: [], frames: [], glass: [], floor: [] };
  const wall = .22, glassTop = eave - .12, transom = glassTop - .4, glassBottom = .08, overhang = .25;
  const box = (kind: Kind, x: number, y: number, z: number, w: number, h: number, d: number) => parts[kind].push(new THREE.BoxGeometry(w, h, d).translate(x, y, z));
  const profile = (kind: Kind, points: number[][], thickness: number, x: number, z: number, across = false, hole?: number[][]) => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    if (hole) shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    if (across) geometry.rotateY(Math.PI / 2);
    parts[kind].push(geometry.translate(x, 0, z));
  };
  const left = entryX - glassWidth / 2, right = entryX + glassWidth / 2;
  // Leave an actual opening behind the projected glass bay, rather than
  // placing the glass over the old opaque box face.
  const front = [[-length / 2, 0], [left, 0], [left, glassTop], [right, glassTop], [right, 0], [length / 2, 0], [length / 2, eave], [-length / 2, eave]];
  // One high narrow window is visible on the southern front wall in DSC07402.
  const sideWindowX = entryX + 5.1, sideWindowWidth = 1.8, sideBottom = 1.75, sideTop = 2.22;
  const sideWindow = [[sideWindowX - sideWindowWidth / 2, sideBottom], [sideWindowX - sideWindowWidth / 2, sideTop], [sideWindowX + sideWindowWidth / 2, sideTop], [sideWindowX + sideWindowWidth / 2, sideBottom]];
  profile('walls', front, wall, 0, -wall, false, sideWindow);
  box('walls', 0, eave / 2, -depth + wall / 2, length, eave, wall);
  for (const x of [-length / 2, length / 2 - wall]) profile('walls', [[0, 0], [depth, 0], [depth, eave], [depth / 2, ridge], [0, eave]], wall, x, 0, true);
  for (const x of [entryX - entryWidth / 2 + wall / 2, entryX + entryWidth / 2 - wall / 2]) box('walls', x, eave / 2, projection / 2, wall, eave, projection);
  box('floor', 0, .04, -depth / 2, length, .08, depth);
  box('floor', entryX, .04, projection / 2, entryWidth, .08, projection);
  // Two central leaves and four fixed side panels, with a continuous transom.
  const frames = [-glassWidth / 2, -1.475, -.85, 0, .85, 1.475, glassWidth / 2].map(x => x + entryX);
  box('glass', entryX, (glassBottom + glassTop) / 2, projection - .08, glassWidth, glassTop - glassBottom, .025);
  for (const x of frames) box('frames', x, (glassBottom + glassTop) / 2, projection - .04, .055, glassTop - glassBottom + .055, .065);
  for (const y of [glassBottom, transom, glassTop]) box('frames', entryX, y, projection - .04, glassWidth + .055, .055, .065);
  for (const x of [entryX - .13, entryX + .13]) box('frames', x, 1.1, projection + .015, .025, .32, .055);
  box('glass', sideWindowX, (sideBottom + sideTop) / 2, -.05, sideWindowWidth, sideTop - sideBottom, .025);
  for (const x of [-.9, -.3, .3, .9]) box('frames', sideWindowX + x, (sideBottom + sideTop) / 2, .01, .045, sideTop - sideBottom + .045, .055);
  for (const y of [sideBottom, sideTop]) box('frames', sideWindowX, y, .01, sideWindowWidth + .045, .045, .055);
  if (!cutaway) {
    const roofY = (q: number) => ridge - (ridge - eave) * Math.abs(q - depth / 2) / (depth / 2), rim = roofY(-overhang);
    profile('roof', [[-overhang, rim], [depth / 2, ridge], [depth + overhang, rim], [depth + overhang, rim + .08], [depth / 2, ridge + .08], [-overhang, rim + .08]], length + 2 * overhang, -length / 2 - overhang, 0, true);
    for (const z of [overhang, -depth - overhang]) box('soffit', 0, rim - .06, z, length + 2 * overhang, .12, .09);
    for (let x = -length / 2; x <= length / 2; x += .6) {
      parts.roof.push(architectureBar([x, rim + .085, overhang], [x, ridge + .085, -depth / 2], .025));
      parts.roof.push(architectureBar([x, ridge + .085, -depth / 2], [x, rim + .085, -depth - overhang], .025));
    }
    const half = entryWidth / 2, peak = eave + gableRise, frontZ = projection + .26, backZ = -depth / 2;
    profile('fascia', [[-half, eave], [half, eave], [0, peak]], .12, entryX, projection);
    // The thin cross-gable meets the existing main ridge; its unseen valley
    // intersection is simplified without extending the building's long walls.
    const gable = [[-half - .15, eave - .07], [0, peak], [half + .15, eave - .07], [half + .15, eave + .01], [0, peak + .08], [-half - .15, eave + .01]];
    profile('roof', gable, frontZ - backZ, entryX, backZ);
    profile('soffit', gable.map(([x, y]) => [x, y - .09]), frontZ - backZ, entryX, backZ);
    box('soffit', entryX, eave - .17, projection + .15, entryWidth + .1, .22, .4);
    for (const side of [-1, 1]) parts.roof.push(architectureBar([entryX, peak + .085, frontZ], [entryX + side * (half + .15), eave + .015, frontZ], .065));
  }
  return Object.fromEntries(Object.entries(parts).map(([kind, list]) => [kind, architectureBatch(list).applyMatrix4(transform)])) as Record<Kind, THREE.BufferGeometry>;
}

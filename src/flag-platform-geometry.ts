import * as THREE from 'three';
import type { FlagPlatformModel, Point } from './types';

export const FLAG_PLATFORM_GROUND = .12;
export function flagPlatformRotation(model: FlagPlatformModel) {
  return Math.atan2(-model.axis[1], model.axis[0]);
}
export function flagPlatformWorldPoint(model: FlagPlatformModel, [x, z]: Point): Point {
  return [model.center[0] + model.axis[0] * x - model.axis[1] * z,
    model.center[1] + model.axis[1] * x + model.axis[0] * z];
}
export function flagPlatformLayout(model: FlagPlatformModel) {
  const baseHeight = .12, centerWidth = model.width * .52;
  const stairRun = (model.width - centerWidth) / 2;
  const centerDepth = model.depth - stairRun * 2;
  const tread = stairRun / (model.steps - 1);
  const rise = (model.platformHeight - baseHeight) / model.steps;
  return { baseHeight, centerWidth, centerDepth, tread, rise,
    tiers: Array.from({ length: model.steps }, (_, i) => ({
      width: centerWidth + i * tread * 2,
      depth: centerDepth + i * tread * 2,
      height: model.platformHeight - i * rise,
    })),
    poleBaseHeight: .16,
    footprint: [[-model.width / 2 - .12, -model.depth / 2 - .18],
      [model.width / 2 + .12, -model.depth / 2 - .18],
      [model.width / 2 + .12, model.depth / 2 + .18],
      [-model.width / 2 - .12, model.depth / 2 + .18],
      [-model.width / 2 - .12, -model.depth / 2 - .18]].map(p => flagPlatformWorldPoint(model, p as Point)) };
}

export function flagPlatformGeometry(model: FlagPlatformModel) {
  const { tiers, baseHeight } = flagPlatformLayout(model), positions: number[] = [];
  type Vertex = [number, number, number];
  const ring = (width: number, depth: number, y: number): Vertex[] => [
    [-width / 2, y, -depth / 2], [-width / 2, y, depth / 2],
    [width / 2, y, depth / 2], [width / 2, y, -depth / 2],
  ];
  const quad = (a: Vertex, b: Vertex, c: Vertex, d: Vertex) => positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  const vertical = (upper: Vertex[], lower: Vertex[]) => upper.forEach((a, i) => {
    const next = (i + 1) % 4;
    quad(a, lower[i], lower[next], upper[next]);
  });
  const top = ring(tiers[0].width, tiers[0].depth, tiers[0].height);
  quad(top[0], top[1], top[2], top[3]);
  for (let i = 1; i < tiers.length; i++) {
    const previous = tiers[i - 1], current = tiers[i];
    const upper = ring(previous.width, previous.depth, previous.height);
    const inner = ring(previous.width, previous.depth, current.height);
    const outer = ring(current.width, current.depth, current.height);
    vertical(upper, inner);
    inner.forEach((a, j) => { const next = (j + 1) % 4; quad(a, outer[j], outer[next], inner[next]); });
  }
  const last = tiers[tiers.length - 1], bottom = ring(last.width, last.depth, baseHeight);
  vertical(ring(last.width, last.depth, last.height), bottom);
  quad(bottom[0], bottom[3], bottom[2], bottom[1]);
  // One closed solid joins all four stair faces and their corners without overlapping slabs.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

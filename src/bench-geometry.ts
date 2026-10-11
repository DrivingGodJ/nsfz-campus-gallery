import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import type { BenchModel } from './types';

// The lakeside photograph shows a backless wood seat on two legs and a low brace.
export function benchGeometry(model: BenchModel) {
  const { length, depth, seatHeight } = model, thickness = .075, gap = .012;
  const slatDepth = (depth - 2 * gap) / 3, legX = length * .3, legTop = seatHeight - thickness;
  const seat = architectureBatch(Array.from({ length: 3 }, (_, i) =>
    new THREE.BoxGeometry(length, thickness, slatDepth).translate(0, seatHeight - thickness / 2, (i - 1) * (slatDepth + gap))));
  const supports = architectureBatch([
    ...[-legX, legX].map(x => new THREE.BoxGeometry(.085, legTop, depth * .65).translate(x, legTop / 2, 0)),
    architectureBar([-legX, .12, 0], [legX, .12, 0], .05, .055),
  ]);
  for (const geometry of [seat, supports]) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  return { seat, supports };
}

import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import type { BenchModel } from './types';

function ringBenchGeometry(model: BenchModel) {
  const inner = model.innerRadius!, outer = inner + model.depth, thickness = .075;
  const radius = (inner + outer) / 2, count = Math.ceil(Math.PI * 2 * radius / .17), angleGap = .012 / inner;
  const seat = architectureBatch(Array.from({ length: count }, (_, i) => {
    const from = i * Math.PI * 2 / count + angleGap / 2, to = (i + 1) * Math.PI * 2 / count - angleGap / 2;
    const shape = new THREE.Shape([[inner, from], [outer, from], [outer, to], [inner, to]]
      .map(([r, angle]) => new THREE.Vector2(r * Math.cos(angle), -r * Math.sin(angle))));
    return new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false })
      .rotateX(-Math.PI / 2).translate(0, model.seatHeight - thickness, 0);
  }));
  const legTop = model.seatHeight - thickness;
  const supports = architectureBatch(Array.from({ length: 8 }, (_, i) => {
    const angle = (i + .5) * Math.PI / 4;
    return new THREE.BoxGeometry(model.depth * .65, legTop, .085).rotateY(-angle)
      .translate(Math.cos(angle) * radius, legTop / 2, Math.sin(angle) * radius);
  }));
  for (const geometry of [seat, supports]) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  return { seat, supports };
}

// The lakeside photograph shows a backless wood seat on two legs and a low brace.
export function benchGeometry(model: BenchModel) {
  if (model.innerRadius !== undefined) return ringBenchGeometry(model);
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

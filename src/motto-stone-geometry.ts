import * as THREE from 'three';
import type { MottoStoneModel, Point } from './types';

export const mottoStoneRotation = (model: MottoStoneModel) => Math.atan2(-model.axis[1], model.axis[0]);
export function mottoStoneWorldPoint(model: MottoStoneModel, [x, y, z]: [number, number, number]): [number, number, number] {
  return [model.center[0] + model.axis[0] * x - model.axis[1] * z, y,
    model.center[1] + model.axis[1] * x + model.axis[0] * z];
}

export function mottoStoneLayout(model: MottoStoneModel) {
  const w = model.width, h = model.totalHeight, d = model.depth;
  // A broad, uneven natural stone, with a low left shoulder and sloping right end.
  const profile: Point[] = [[-.5, .12], [-.49, .49], [-.45, .76], [-.34, .87], [-.25, .94],
    [-.1, .91], [.03, 1], [.12, .94], [.24, .95], [.38, .84], [.47, .74], [.5, .26],
    [.43, .11], [.24, .07], [.04, .1], [-.13, .06], [-.34, .08]];
  return {
    outline: profile.map(([x, y]) => [x * w, y * h] as Point),
    baseRocks: [
      { position: [-.36 * w, .15, 0] as [number, number, number], scale: [.9, .28, d * .84] as [number, number, number] },
      { position: [-.07 * w, .12, 0] as [number, number, number], scale: [1.15, .24, d * .95] as [number, number, number] },
      { position: [.3 * w, .16, 0] as [number, number, number], scale: [1, .32, d * .8] as [number, number, number] }
    ],
    // PlaneGeometry faces +Z: its UVs read left to right from the lake side.
    sign: { position: [0, h * .52, d / 2 + .025] as [number, number, number], size: [w * .84, h * .57] as [number, number] }
  };
}

export function mottoStoneGeometry(model: MottoStoneModel) {
  const shape = new THREE.Shape(mottoStoneLayout(model).outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const bevel = Math.min(.055, model.depth / 8);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: model.depth - bevel * 2, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, steps: 1 });
  geometry.translate(0, 0, -model.depth / 2 + bevel);
  return geometry;
}

export function mottoStoneInscriptionGeometry(model: MottoStoneModel) {
  const sign = mottoStoneLayout(model).sign;
  const geometry = new THREE.PlaneGeometry(...sign.size);
  geometry.translate(...sign.position);
  return geometry;
}

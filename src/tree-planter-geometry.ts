import * as THREE from 'three';
import { architectureBatch } from './architecture-geometry.ts';
import { buildingGeometry } from './building-geometry.ts';
import type { Point, Shape, TreePlanterModel } from './types';

export function treePlanterFootprint(model: TreePlanterModel, inset = 0): Shape {
  const length = Math.hypot(...model.axis), axis = model.axis.map(v => v / length), normal = [-axis[1], axis[0]];
  const outer: Point[] = Array.from({ length: 65 }, (_, i) => {
    const angle = i * Math.PI / 32;
    return model.center.map((v, j) => v + axis[j] * Math.cos(angle) * (model.length / 2 - inset)
      + normal[j] * Math.sin(angle) * (model.width / 2 - inset)) as Point;
  });
  return { outer, holes: [] };
}

export function treePlanterGeometry(model: TreePlanterModel) {
  const outer = treePlanterFootprint(model), inner = treePlanterFootprint(model, model.rimWidth);
  const rim = buildingGeometry({ outer: outer.outer, holes: [inner.outer] }, model.height, 1);
  const soil = buildingGeometry(inner, model.height - .07, 1);
  for (const geometry of [rim, soil]) { geometry.rotateX(-Math.PI / 2); geometry.translate(0, .12, 0); }
  const length = Math.hypot(...model.axis), axis = model.axis.map(v => v / length), normal = [-axis[1], axis[0]];
  const leaves: THREE.BufferGeometry[] = [];
  for (let x = -model.length / 2 + .5; x < model.length / 2; x += .45) for (let z = -model.width / 2 + .4; z < model.width / 2; z += .4) {
    if ((x / (model.length / 2 - model.rimWidth)) ** 2 + (z / (model.width / 2 - model.rimWidth)) ** 2 > .83) continue;
    leaves.push(new THREE.IcosahedronGeometry(.22, 0).scale(1, .65, 1).translate(
      model.center[0] + axis[0] * x + normal[0] * z, .12 + model.height + .025,
      model.center[1] + axis[1] * x + normal[1] * z));
  }
  return { rim, soil, foliage: architectureBatch(leaves, false) };
}

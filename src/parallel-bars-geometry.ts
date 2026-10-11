import * as THREE from 'three';
import { architectureBatch } from './architecture-geometry.ts';
import type { ParallelBarsModel, Point, Shape } from './types';

const PAD_HEIGHT = .05, POST_RADIUS = .06, RAIL_RADIUS = .027;

export function parallelBarsLayout(model: ParallelBarsModel) {
  const minU = Math.min(...model.sets.map(set => set.offset[0] - model.length / 2));
  const maxU = Math.max(...model.sets.map(set => set.offset[0] + model.length / 2));
  const minV = Math.min(...model.sets.map(set => set.offset[1] - model.width / 2));
  const maxV = Math.max(...model.sets.map(set => set.offset[1] + model.width / 2));
  const pad = { center: [(minU + maxU) / 2, (minV + maxV) / 2] as Point,
    length: model.pad?.length ?? maxU - minU + 1.6, width: model.pad?.width ?? maxV - minV + 1.3 };
  const rails = model.sets.flatMap(set => [-1, 1].map(side => ({
    from: [set.offset[0] - model.length / 2, set.height, set.offset[1] + side * model.width / 2] as [number, number, number],
    to: [set.offset[0] + model.length / 2, set.height, set.offset[1] + side * model.width / 2] as [number, number, number],
  })));
  return { pad, rails };
}

export function parallelBarsFootprint(model: ParallelBarsModel): Shape {
  const { pad } = parallelBarsLayout(model), size = Math.hypot(...model.axis), [dx, dz] = model.axis.map(value => value / size);
  const point = (u: number, v: number): Point => [model.center[0] + u * dx - v * dz, model.center[1] + u * dz + v * dx];
  const [u, v] = pad.center, halfU = pad.length / 2, halfV = pad.width / 2;
  const outer = [point(u - halfU, v - halfV), point(u + halfU, v - halfV), point(u + halfU, v + halfV), point(u - halfU, v + halfV)];
  return { outer: [...outer, outer[0]], holes: [] };
}

// Photo 77bb78cb-1908-4cc8-bd7d-9a7d1215d117: four painted round posts and
// two silver long rails per set, rather than a single pull-up crossbar. Reuse
// the existing merged architecture path; exact sizes are model estimates.
export function parallelBarsGeometry(model: ParallelBarsModel) {
  const { pad, rails } = parallelBarsLayout(model), posts: THREE.BufferGeometry[] = [], bars: THREE.BufferGeometry[] = [];
  const post = new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS, 1, 8);
  const rail = new THREE.CylinderGeometry(RAIL_RADIUS, RAIL_RADIUS, 1, 10).rotateZ(-Math.PI / 2);
  for (const { from, to } of rails) {
    const [left, height, across] = from, right = to[0];
    bars.push(rail.clone().scale(model.length, 1, 1).translate((left + right) / 2, height, across));
    for (const along of [left + model.length * .16, right - model.length * .16]) {
      const collar = PAD_HEIGHT + (height - PAD_HEIGHT) * .67;
      posts.push(post.clone().scale(1, collar - PAD_HEIGHT, 1).translate(along, (collar + PAD_HEIGHT) / 2, across));
      posts.push(post.clone().scale(.48, height - collar, .48).translate(along, (height + collar) / 2, across));
    }
  }
  post.dispose(); rail.dispose();
  const geometry = {
    rails: architectureBatch(bars), posts: architectureBatch(posts),
    pad: new THREE.BoxGeometry(pad.length, PAD_HEIGHT, pad.width).translate(pad.center[0], PAD_HEIGHT / 2, pad.center[1]),
  };
  for (const part of Object.values(geometry)) { part.computeBoundingBox(); part.computeBoundingSphere(); }
  return geometry;
}

import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { architectureBatch } from './architecture-geometry.ts';
import type { CourtyardSculptureModel, Point, Shape } from './types';

export function courtyardSculptureFootprint(model: CourtyardSculptureModel): Shape {
  const length = Math.hypot(...model.facing), [x, z] = model.facing.map(n => n / length);
  return { outer: [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([u, v]) =>
    [model.center[0] + z * u * model.width / 2 + x * v * model.depth / 2,
      model.center[1] - x * u * model.width / 2 + z * v * model.depth / 2] as Point), holes: [] };
}

export function courtyardSculptureGeometry(model: CourtyardSculptureModel) {
  const rim: THREE.BufferGeometry[] = [], leaves: THREE.BufferGeometry[] = [], orange: THREE.BufferGeometry[] = [], cream: THREE.BufferGeometry[] = [];
  const ring = (x: number, y: number, z: number, radius: number, tube: number, scale: [number, number, number], center: [number, number, number], twist: number) => {
    const point = new THREE.Vector3(x - center[0], y - center[1], z - center[2]);
    point.applyAxisAngle(new THREE.Vector3(0, 1, 0), twist * .55).applyAxisAngle(new THREE.Vector3(0, 0, 1), -twist);
    const u = point.x / scale[0], v = point.y / scale[1], angle = Math.atan2(v, u);
    const depth = (point.z - .08 * Math.sin(angle * 2)) / scale[2];
    return Math.hypot(Math.hypot(u, v) - radius, depth) - tube * (1 + .16 * Math.sin(angle - .8));
  };
  // DSC9699: a larger lower opening and a smaller off-centre upper opening,
  // smoothly fused into one organic surface, with two real through-holes.
  const resolution = 56, material = new THREE.MeshBasicMaterial(), surface = new MarchingCubes(resolution, material, false, false, 24000);
  surface.isolation = 0;
  for (let z = 0; z < resolution; z++) for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
    const px = (x / resolution * 2 - 1) * 1.6, py = y / resolution * 4, pz = (z / resolution * 2 - 1);
    const lower = ring(px, py, pz, .65, .34, [1.13, 1, 1.13], [.14, 1.8, -.05], .08);
    const upper = ring(px, py, pz, .49, .28, [1.17, .83, .96], [-.30, 2.94, .08], -.30);
    const blend = Math.max(.24 - Math.abs(lower - upper), 0) / .24;
    surface.field[z * resolution * resolution + y * resolution + x] = -Math.min(lower, upper) + blend * blend * .06;
  }
  surface.update();
  const sculpture = new THREE.BufferGeometry();
  for (const kind of ['position', 'normal']) sculpture.setAttribute(kind, new THREE.BufferAttribute(surface.geometry.attributes[kind].array.slice(0, surface.count * 3), 3));
  surface.geometry.dispose(); material.dispose();
  sculpture.scale(1.6, 2, 1).translate(0, 2, 0);
  const pedestal = new THREE.BoxGeometry(2.2, .60, 1.55).translate(0, .55, 0);
  sculpture.computeBoundingBox();
  const scale = model.totalHeight / sculpture.boundingBox!.max.y;
  sculpture.scale(scale, scale, scale); pedestal.scale(scale, scale, scale);
  // The planter is a low stone rim with green foliage and the orange/cream
  // flower bands visible around the original rectangular dark pedestal.
  for (const sign of [-1, 1]) {
    rim.push(new THREE.BoxGeometry(model.width, .23, .16).translate(0, .115, sign * (model.depth / 2 - .08)));
    rim.push(new THREE.BoxGeometry(.16, .23, model.depth - .32).translate(sign * (model.width / 2 - .08), .115, 0));
  }
  for (let x = -model.width / 2 + .35; x < model.width / 2 - .2; x += .32) for (let z = -model.depth / 2 + .35; z < model.depth / 2 - .2; z += .32) {
    if (Math.abs(x) < 1.2 && Math.abs(z) < .85) continue;
    leaves.push(new THREE.SphereGeometry(.17, 6, 4).scale(1, .65, 1).translate(x, .25, z));
    const flowers = Math.abs(z) > model.depth / 2 - .8 ? cream : orange;
    flowers.push(new THREE.IcosahedronGeometry(.065, 0).translate(x + .06, .39, z - .035));
    flowers.push(new THREE.IcosahedronGeometry(.055, 0).translate(x - .055, .35, z + .055));
  }
  const result = { silver: sculpture, pedestal, rim: architectureBatch(rim), soil: new THREE.BoxGeometry(model.width - .32, .18, model.depth - .32).translate(0, .09, 0),
    leaves: architectureBatch(leaves), orange: architectureBatch(orange), cream: architectureBatch(cream) };
  for (const geometry of Object.values(result)) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  sculpture.userData.apertures = [[.14, 1.8, -.05], [-.30, 2.94, .08]].map(p => p.map(n => n * scale));
  return result;
}

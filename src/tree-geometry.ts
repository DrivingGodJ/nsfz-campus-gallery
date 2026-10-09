import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Feature } from './types';

type Tree = NonNullable<Feature['trees']>[number];

// Mature campus trees fork above the whitewashed base. A single shared trunk
// geometry and three overlapping crown instances keep the whole row batched.
export function treeTrunkGeometry() {
  const trunk = new THREE.CylinderGeometry(.72, 1, .53, 6).translate(0, .265, 0);
  const parts = [trunk], up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < 3; i++) {
    const angle = i * Math.PI * 2 / 3;
    const from = new THREE.Vector3(0, .43, 0), to = new THREE.Vector3(Math.cos(angle) * 3.3, .72, Math.sin(angle) * 3.3);
    const direction = to.clone().sub(from);
    const geometry = new THREE.CylinderGeometry(.24, .58, direction.length(), 5);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, direction.normalize()));
    geometry.translate(...from.add(to).multiplyScalar(.5).toArray()); parts.push(geometry);
  }
  const geometry = mergeGeometries(parts)!; parts.forEach(part => part.dispose());
  return geometry;
}

export function treeInstances(tree: Tree) {
  const seed = Math.abs(Math.sin(tree.position[0] * 12.9898 + tree.position[1] * 78.233));
  const rotation = seed * Math.PI * 2, width = Math.max(.2, tree.radius * .13);
  const trunk = new THREE.Matrix4().compose(new THREE.Vector3(tree.position[0], .12, tree.position[1]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation), new THREE.Vector3(width, tree.height, width));
  const base = new THREE.Matrix4().makeScale(width * 1.015, .85, width * 1.015);
  base.setPosition(tree.position[0], .12 + .85 / 2, tree.position[1]);
  const crowns = Array.from({ length: 3 }, (_, i) => {
    const angle = rotation + i * Math.PI * 2 / 3;
    const radius = tree.radius * (.68 + ((i + Math.floor(seed * 3)) % 3) * .025);
    return new THREE.Matrix4().compose(new THREE.Vector3(tree.position[0] + Math.cos(angle) * tree.radius * .27,
      .12 + tree.height * (.73 + i * .025), tree.position[1] + Math.sin(angle) * tree.radius * .27),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
    new THREE.Vector3(radius, tree.height * (.22 - i * .012), radius * (.94 + seed * .06)));
  });
  return { trunk, base, crowns };
}

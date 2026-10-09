import * as THREE from 'three';
import type { Feature } from './types';

type Tree = Omit<NonNullable<Feature['trees']>[number], 'kind'> & { kind?: 'plane' | 'columnar' | 'palm' };

export function palmCrownGeometry() {
  const vertices: number[] = [];
  for (let frond = 0; frond < 10; frond++) {
    const angle = frond * Math.PI * 2 / 10;
    const at = (t: number, side: number) => {
      const width = Math.sin(t * Math.PI) * .15, x = t, z = width * side;
      return [x * Math.cos(angle) - z * Math.sin(angle), Math.sin(t * Math.PI) * .3 - t * .22, x * Math.sin(angle) + z * Math.cos(angle)];
    };
    for (let i = 0; i < 4; i++) {
      const t = i / 4, next = (i + 1) / 4;
      vertices.push(...at(t,-1), ...at(next,-1), ...at(next,1), ...at(t,-1), ...at(next,1), ...at(t,1));
    }
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(vertices,3));
  geometry.computeVertexNormals(); return geometry;
}

// Keep the upright stem and oriented forks in separate shared instance batches.
export function treeTrunkGeometry(columnar = false) {
  if (columnar) return new THREE.CylinderGeometry(.28, 1, 1, 7).translate(0, .5, 0);
  return new THREE.CylinderGeometry(.72, 1, .53, 6).translate(0, .265, 0);
}

export function treeInstances(tree: Tree, openCanopy = false) {
  const seed = Math.abs(Math.sin(tree.position[0] * 12.9898 + tree.position[1] * 78.233));
  const rotation = seed * Math.PI * 2, width = Math.max(.2, tree.radius * .13);
  // April grove photos show long exposed trunks below a high, broken canopy.
  // ponytail: grove height is a visual estimate; keep calibrated roots fixed.
  const height = openCanopy ? Math.max(12.5, tree.height * 1.6) : tree.height;
  const trunk = new THREE.Matrix4().compose(new THREE.Vector3(tree.position[0], .12, tree.position[1]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation), new THREE.Vector3(width, height * (tree.kind === 'palm' ? .9 : 1), width));
  const whitewash = tree.kind === 'palm' ? .3 : Math.min(1.35, tree.height * .16);
  const base = new THREE.Matrix4().makeScale(width * 1.015, whitewash, width * 1.015);
  base.setPosition(tree.position[0], .12 + whitewash / 2, tree.position[1]);
  const branches: THREE.Matrix4[] = [];
  if (!tree.kind || tree.kind === 'plane') {
    const point = (angle: number, reach: number, y: number) => new THREE.Vector3(tree.position[0] + Math.cos(angle) * reach * width, .12 + y * height, tree.position[1] + Math.sin(angle) * reach * width);
    const branch = (from: THREE.Vector3, to: THREE.Vector3, radius: number) => {
      const direction = to.clone().sub(from), length = direction.length();
      branches.push(new THREE.Matrix4().compose(from.clone().add(to).multiplyScalar(.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()), new THREE.Vector3(radius, length, radius)));
    };
    // Orient after choosing world dimensions: scaling a rotated fork by tree
    // height also scales its circular cross-section into a thick vertical sheet.
    for (let i = 0; i < 3; i++) {
      const angle = rotation + i * Math.PI * 2 / 3;
      branch(point(angle, 0, .43), point(angle, 3.3, .72), width * .58);
      branch(point(angle, 1.8, .59), point(angle + .42, 3.4, .98), width * .24);
    }
  }
  const crowns = Array.from({ length: 3 }, (_, i) => {
    if (tree.kind === 'palm') return new THREE.Matrix4().compose(new THREE.Vector3(tree.position[0],
      .12 + tree.height * [.89, .82, .76][i], tree.position[1]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), rotation + i * .6),
    new THREE.Vector3(tree.radius * [1, .8, .65][i], tree.height * .24, tree.radius * [1, .8, .65][i]));
    if (tree.kind === 'columnar') return new THREE.Matrix4().compose(new THREE.Vector3(tree.position[0],
      .12 + tree.height * [.54, .73, .875][i], tree.position[1]),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotation + i),
    new THREE.Vector3(tree.radius * [.9, .8, .6][i], tree.height * [.23, .18, .12][i], tree.radius * [.85, .8, .55][i]));
    const angle = rotation + i * Math.PI * 2 / 3;
    const radius = tree.radius * (openCanopy ? .38 : .68 + ((i + Math.floor(seed * 3)) % 3) * .025);
    const spread = tree.radius * (openCanopy ? .48 : .27);
    return new THREE.Matrix4().compose(new THREE.Vector3(tree.position[0] + Math.cos(angle) * spread,
      .12 + height * (openCanopy ? .86 + i * .018 : .73 + i * .025), tree.position[1] + Math.sin(angle) * spread),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle),
    new THREE.Vector3(radius, height * (openCanopy ? .09 - i * .008 : .22 - i * .012), radius * (.94 + seed * .06)));
  });
  return { trunk, base, branches, crowns };
}

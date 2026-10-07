import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bridgeRailPosts, type RailPoint } from './bridge-geometry.ts';

const merge = (parts: THREE.BufferGeometry[]) => {
  const result = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry();
  if (!parts.length) result.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose());
  return result;
};

// Keep the same round joints, post spacing and sloping rails, but render each
// material once instead of issuing a draw call for every little rail segment.
export function bridgeRailGeometry(chains: RailPoint[][], smooth = false) {
  const corners = [...new Map(chains.flat().map(point => [point.map(n => n.toFixed(6)).join(','), point])).values()];
  const unitBar = new THREE.CylinderGeometry(1, 1, 1, 8), unitJoint = new THREE.SphereGeometry(1, 8, 6), unitPost = new THREE.BoxGeometry(1, 1, 1);
  const up = new THREE.Vector3(0, 1, 0), transform = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  const rails = [{ offset: 1, radius: .065 }, { offset: .48, radius: .04 }].map(({ offset, radius }) => {
    const parts: THREE.BufferGeometry[] = [];
    for (const chain of chains) for (let i = 1; i < chain.length; i++) {
      const from = new THREE.Vector3(...chain[i - 1]), to = new THREE.Vector3(...chain[i]);
      const direction = to.clone().sub(from), length = direction.length();
      if (length < 1e-6) continue;
      rotation.setFromUnitVectors(up, direction.divideScalar(length));
      const middle = from.add(to).multiplyScalar(.5); middle.y += offset;
      transform.compose(middle, rotation, scale.set(radius, length, radius));
      parts.push(unitBar.clone().applyMatrix4(transform));
    }
    for (const point of corners) {
      transform.makeScale(radius, radius, radius); transform.setPosition(point[0], point[1] + offset, point[2]);
      parts.push(unitJoint.clone().applyMatrix4(transform));
    }
    return merge(parts);
  });
  const posts = merge(bridgeRailPosts(chains, 3, smooth).map(point => {
    transform.makeScale(.13, 1, .13); transform.setPosition(point[0], point[1] + .5, point[2]);
    return unitPost.clone().applyMatrix4(transform);
  }));
  unitBar.dispose(); unitJoint.dispose(); unitPost.dispose();
  return { upper: rails[0], lower: rails[1], posts };
}

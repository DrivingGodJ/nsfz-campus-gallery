import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bridgeRailPosts, type RailPoint } from './bridge-geometry.ts';

// The entrance retains its original 1.065 m top envelope; the exit uses its
// existing 1.045 m envelope. Only the photographed stainless guard changes.
export function undergroundRailGeometry(chains: RailPoint[][], height = 1.065) {
  const parts: THREE.BufferGeometry[] = [];
  const top = height - .035, bottom = .15;
  const bar = (from: RailPoint, to: RailPoint, radius: number) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a), length = direction.length();
    if (length < 1e-6) return;
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 8);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.divideScalar(length)));
    parts.push(geometry.translate(...a.add(b).multiplyScalar(.5).toArray()));
  };
  for (const chain of chains) for (let i = 1; i < chain.length; i++) {
    for (const [offset, radius] of [[top, .035], [bottom, .022]]) {
      const raised = (point: RailPoint): RailPoint => [point[0], point[1] + offset, point[2]];
      bar(raised(chain[i - 1]), raised(chain[i]), radius);
    }
  }
  const joints = [...new Map(chains.flat().map(point => [point.join(','), point])).values()];
  for (const point of joints) for (const [offset, radius] of [[top, .035], [bottom, .022]])
    parts.push(new THREE.SphereGeometry(radius, 8, 6).translate(point[0], point[1] + offset, point[2]));
  for (const point of bridgeRailPosts(chains, 3, true))
    bar(point, [point[0], point[1] + top, point[2]], .028);
  for (const point of bridgeRailPosts(chains, .18, true))
    bar([point[0], point[1] + bottom, point[2]], [point[0], point[1] + top, point[2]], .011);
  const plain = parts.map(part => { const geometry = part.toNonIndexed(); geometry.deleteAttribute('uv'); return geometry; });
  const result = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
  return result;
}

import * as THREE from 'three';
import type { Feature, Point } from './types';
import { bridgeSurfaceHeight } from './structure-geometry.ts';
import { BRIDGE_DECK_THICKNESS } from './bridge-geometry.ts';

// One closed curved slab: the water remains visible through the space below it.
export function archedBridgeGeometry(feature: Feature, height: number) {
  const [from, to] = feature.points!, dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
  const nx = -dz / length, nz = dx / length, half = (feature.width || 3.5) / 2;
  const positions: number[] = [], indices: number[] = [];
  const sections = Array.from({ length: 33 }, (_, i) => {
    const t = i / 32, point: Point = [from[0] + dx * t, from[1] + dz * t];
    const y = bridgeSurfaceHeight(feature, height, point);
    return [[point[0] + nx * half, y, point[1] + nz * half], [point[0] - nx * half, y, point[1] - nz * half],
      [point[0] + nx * half, y - BRIDGE_DECK_THICKNESS, point[1] + nz * half], [point[0] - nx * half, y - BRIDGE_DECK_THICKNESS, point[1] - nz * half]];
  });
  const quad = (...points: number[][]) => {
    const offset = positions.length / 3; positions.push(...points.flat());
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  };
  for (let i = 1; i < sections.length; i++) {
    const a = sections[i - 1], b = sections[i];
    quad(a[0], b[0], b[1], a[1]);
    quad(a[2], a[3], b[3], b[2]);
    quad(a[0], a[2], b[2], b[0]);
    quad(a[1], b[1], b[3], a[3]);
  }
  const first = sections[0], last = sections.at(-1)!;
  quad(first[0], first[1], first[3], first[2]);
  quad(last[0], last[2], last[3], last[1]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Feature, Point } from './types';
import { bridgeSurfaceHeight, stoneBridgeProfile } from './structure-geometry.ts';
import { BRIDGE_DECK_THICKNESS } from './bridge-geometry.ts';

function stoneBridgeGeometry(feature: Feature, height: number) {
  const [from, to] = feature.points!, dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
  const profile = stoneBridgeProfile(feature, height), half = (feature.width || 3.5) / 2, curb = .24;
  const bottom = height - .32, spring = height - .25, crown = height + feature.archRise! - BRIDGE_DECK_THICKNESS;
  const openingHalf = Math.min(length * .23, 2.1), middle = length / 2;
  // Thick stone abutments stand on the banks; one low arch leaves the wet span open.
  const outline: Point[] = [...profile, [length, bottom], [middle + openingHalf, bottom]];
  for (let i = 0; i <= 32; i++) {
    const angle = Math.PI * i / 32;
    outline.push([middle + openingHalf * Math.cos(angle), spring + (crown - spring) * Math.sin(angle)]);
  }
  outline.push([middle - openingHalf, bottom], [0, bottom]);
  const extrude = (points: Point[], width: number, across: number) => {
    const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
    return new THREE.ExtrudeGeometry(shape, { depth: width, bevelEnabled: false }).translate(0, 0, across);
  };
  const run = profile.find(([, y]) => Math.abs(y - height - feature.archRise!) < 1e-7)![0];
  const curbOutline: Point[] = [[0, height + .16], [run, height + feature.archRise! + .16],
    [length - run, height + feature.archRise! + .16], [length, height + .16], ...[...profile].reverse()];
  const parts = [extrude(outline, 2 * (half + curb), -half - curb), extrude(curbOutline, curb, half), extrude(curbOutline, curb, -half - curb)];
  const geometry = mergeGeometries(parts)!;
  parts.forEach(part => part.dispose());
  const transform = new THREE.Matrix4().makeBasis(new THREE.Vector3(dx / length, 0, dz / length), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-dz / length, 0, dx / length));
  transform.setPosition(from[0], 0, from[1]);
  return geometry.applyMatrix4(transform);
}

// One closed curved slab: the water remains visible through the space below it.
export function archedBridgeGeometry(feature: Feature, height: number) {
  if (feature.bridgeStyle === 'stone') return stoneBridgeGeometry(feature, height);
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

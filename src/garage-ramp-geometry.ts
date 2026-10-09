import * as THREE from 'three';
import { buildingGeometry } from './building-geometry.ts';
import { passageFootprint } from './underground-geometry.ts';
import type { Feature } from './types';

const WALL = .22, SLAB = .16;

export function garageRampFootprint(feature: Feature) {
  return passageFootprint(feature.points!, (feature.width || 4.5) + WALL * 2);
}

// The same straight opening cuts the ground and contains the sloping floor.
// Only an entrance is modelled; the dark end stops at the basement doorway.
export function garageRampGeometry(feature: Feature) {
  const [from, to] = feature.points!, width = feature.width || 4.5;
  const { topHeight: top, bottomHeight: bottom } = feature.ramp!;
  const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
  const axis = [dx / length, dz / length], normal = [-axis[1], axis[0]];
  const floor = buildingGeometry(passageFootprint([from, to], width), SLAB, 3.6);
  floor.rotateX(-Math.PI / 2);
  const vertices = floor.getAttribute('position');
  for (let i = 0; i < vertices.count; i++) {
    const progress = ((vertices.getX(i) - from[0]) * axis[0] + (vertices.getZ(i) - from[1]) * axis[1]) / length;
    vertices.setY(i, vertices.getY(i) + top + (bottom - top) * progress - SLAB);
  }
  floor.computeVertexNormals();
  const wallParts = [-1, 1].map(side => {
    const shape = new THREE.Shape([new THREE.Vector2(0, top + .3), new THREE.Vector2(length, top + .3),
      new THREE.Vector2(length, bottom - SLAB), new THREE.Vector2(0, top - SLAB)]);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: WALL, bevelEnabled: false });
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      const distance = positions.getX(i), offset = side * (width / 2 + positions.getZ(i));
      positions.setXYZ(i, from[0] + axis[0] * distance + normal[0] * offset, positions.getY(i), from[1] + axis[1] * distance + normal[1] * offset);
    }
    geometry.computeVertexNormals();
    return geometry;
  });
  const doorway = new THREE.PlaneGeometry(width, Math.min(2.5, top - bottom - .1));
  doorway.rotateY(Math.atan2(normal[1], -normal[0]));
  doorway.translate(to[0], bottom + Math.min(2.5, top - bottom - .1) / 2, to[1]);
  return { floor, leftWall: wallParts[0], rightWall: wallParts[1], doorway };
}

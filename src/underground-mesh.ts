import * as THREE from 'three';
import type { Point, Shape } from './types';
import type { PassageOpening } from './underground-geometry';

function onOpening(point: Point, [from, to]: PassageOpening) {
  const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
  const along = ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / length ** 2;
  return along >= -1e-5 && along <= 1 + 1e-5 && Math.abs((point[0] - from[0]) * dz - (point[1] - from[1]) * dx) / length < 1e-5;
}

export function undergroundBoundaryLines(shape: Shape, openings: PassageOpening[]) {
  return [shape.outer, ...shape.holes].flatMap(ring => {
    const isOpening = ring.slice(1).map((to, i) => openings.some(opening => onOpening(ring[i], opening) && onOpening(to, opening)));
    if (!isOpening.some(Boolean)) return [ring];
    const start = isOpening.findIndex(Boolean), count = ring.length - 1, lines: Point[][] = [];
    let line: Point[] = [];
    for (let step = 1; step <= count; step++) {
      const i = (start + step) % count;
      if (isOpening[i]) { if (line.length > 1) lines.push(line); line = []; }
      else { if (!line.length) line.push(ring[i]); line.push(ring[(i + 1) % count]); }
    }
    if (line.length > 1) lines.push(line);
    return lines;
  });
}

// Keep the floor and ceiling, but remove the two coincident walls at an open join.
export function undergroundVolume(shape: Shape, height: number, openings: PassageOpening[]) {
  const outline = new THREE.Shape(shape.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  outline.holes = shape.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
  const extrusion = new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false });
  if (!openings.length) return extrusion;
  const vertices = extrusion.getAttribute('position'), positions: number[] = [];
  for (let i = 0; i < vertices.count; i += 3) {
    const triangle = [0, 1, 2].map(j => [vertices.getX(i + j), -vertices.getY(i + j)] as Point);
    const vertical = Math.max(...[0, 1, 2].map(j => vertices.getZ(i + j))) - Math.min(...[0, 1, 2].map(j => vertices.getZ(i + j))) > 1e-5;
    if (vertical && openings.some(opening => triangle.every(point => onOpening(point, opening)))) continue;
    for (let j = 0; j < 3; j++) positions.push(vertices.getX(i + j), vertices.getY(i + j), vertices.getZ(i + j));
  }
  extrusion.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

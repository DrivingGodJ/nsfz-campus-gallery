import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { passageFootprint } from './underground-geometry.ts';
import type { GroundPassage, Point, Shape } from './types';

function makeShape(data: Shape) {
  const outer = data.outer.map(([x, z]) => new THREE.Vector2(x, -z));
  if (!THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
  const shape = new THREE.Shape(outer);
  shape.holes = data.holes.map(ring => {
    const points = ring.map(([x, z]) => new THREE.Vector2(x, -z));
    // Extrusion does not normalize hole winding when the outer ring is already
    // clockwise. Keep courtyard walls facing inward across passage floor splits.
    if (THREE.ShapeUtils.isClockWise(points)) points.reverse();
    return new THREE.Path(points);
  });
  return shape;
}

function passageShape(passage: GroundPassage) {
  const points = passage.points.map(point => [...point] as Point);
  // Extend past the facade so a road endpoint on a wall cannot leave a thin cap.
  for (const [end, next] of [[0, 1], [points.length - 1, points.length - 2]]) {
    const dx = points[end][0] - points[next][0], dz = points[end][1] - points[next][1];
    const scale = passage.width / Math.hypot(dx, dz);
    points[end] = [points[end][0] + dx * scale, points[end][1] + dz * scale];
  }
  return passageFootprint(points, passage.width);
}

function splitFacade(section: Shape, corners: Point[]): Shape {
  const split = (ring: Point[]) => {
    const vertices = ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
    const result: Point[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const from = vertices[i], to = vertices[(i + 1) % vertices.length];
      const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
      const cuts = corners.map(point => ({ point, t: ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / length ** 2 }))
        .filter(({ point, t }) => t > 1e-8 && t < 1 - 1e-8 && Math.abs((point[0] - from[0]) * dz - (point[1] - from[1]) * dx) / length < 1e-7)
        .sort((a, b) => a.t - b.t);
      result.push(from);
      for (const { point } of cuts) if (Math.hypot(point[0] - result.at(-1)![0], point[1] - result.at(-1)![1]) > 1e-7) result.push(point);
    }
    result.push(result[0]);
    return result;
  };
  return { outer: split(section.outer), holes: section.holes.map(split) };
}

// Geometry stays in the same local extrusion coordinates as ordinary buildings:
// x / -map z on the footprint, and local z for height above the building base.
export function buildingGeometry(section: Shape, height: number, floorHeight: number, passages: GroundPassage[] = []) {
  const polygon = [section.outer, ...section.holes];
  const cuts = passages.map(passage => {
    const shape = passageShape(passage);
    return [shape.outer, ...shape.holes];
  });
  if (!cuts.length || !polygonClipping.intersection(polygon, polygonClipping.union(cuts[0], ...cuts.slice(1))).length) {
    return new THREE.ExtrudeGeometry(makeShape(section), { depth: height, bevelEnabled: false });
  }

  const lower = polygonClipping.difference(polygon, cuts[0], ...cuts.slice(1));
  const clearance = Math.min(floorHeight, height), hasUpper = height > clearance;
  const positions: number[] = [];
  const addExtrusion = (shape: Shape, depth: number, bottom: number, omitBottom = false, omitTop = false) => {
    const geometry = new THREE.ExtrudeGeometry(makeShape(shape), { depth, bevelEnabled: false });
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i += 3) {
      const heights = [0, 1, 2].map(j => vertices.getZ(i + j));
      if ((omitBottom && heights.every(z => Math.abs(z) < 1e-5)) || (omitTop && heights.every(z => Math.abs(z - depth) < 1e-5))) continue;
      for (let j = 0; j < 3; j++) positions.push(vertices.getX(i + j), vertices.getY(i + j), vertices.getZ(i + j) + bottom);
    }
    geometry.dispose();
  };
  for (const [outer, ...holes] of lower) addExtrusion({ outer, holes }, clearance, 0, false, hasUpper);
  if (hasUpper) {
    // Match wall vertices across the floor boundary so edge outlines do not
    // mistake partially shared facade segments for an exposed horizontal seam.
    addExtrusion(splitFacade(section, lower.flat(2)), height - clearance, clearance, true);
    // Only the passage ceiling is exposed. Removing the internal floor caps
    // keeps the remaining facade continuous, without a new line at every floor.
    const ceiling = polygonClipping.difference(polygon, lower);
    for (const [outer, ...holes] of ceiling) {
      const geometry = new THREE.ShapeGeometry(makeShape({ outer, holes }));
      const vertices = geometry.getAttribute('position'), indices = geometry.getIndex()!;
      for (let i = 0; i < indices.count; i += 3) {
        for (const j of [2, 1, 0]) {
          const vertex = indices.getX(i + j);
          positions.push(vertices.getX(vertex), vertices.getY(vertex), clearance);
        }
      }
      geometry.dispose();
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

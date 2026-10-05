import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { passageFootprint } from './underground-geometry.ts';
import type { FloorCorridor, GroundPassage, Point, Shape } from './types';

const CORRIDOR_SLAB_THICKNESS = .25;

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

function corridorFootprint(section: Shape, corridor: FloorCorridor, passages: GroundPassage[]): Shape {
  if ('passageIndex' in corridor) {
    // Open the connector on every floor, rather than only recessing its facade.
    return passageShape({ ...passages[corridor.passageIndex], width: corridor.depth });
  }
  if ('edges' in corridor) {
    const points = corridor.edges.map(edge => section.outer[edge]);
    points.push(section.outer[corridor.edges.at(-1)! + 1]);
    // A shared miter joins both sides of the recessed return corner, without
    // leaving a wall plug between two separately cut facade strips.
    return passageFootprint(points, corridor.depth * 2);
  }
  if ('holeIndex' in corridor) {
    const ring = section.holes[corridor.holeIndex];
    const vertices = ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
    const area = vertices.reduce((sum, p, i) => { const q = vertices[(i + 1) % vertices.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    const direction = area >= 0 ? 1 : -1;
    const normals = vertices.map((p, i): Point => {
      const q = vertices[(i + 1) % vertices.length], dx = q[0] - p[0], dz = q[1] - p[1], length = Math.hypot(dx, dz);
      return [dz / length * direction, -dx / length * direction];
    });
    const outer = vertices.map((p, i): Point => {
      const before = normals[(i + normals.length - 1) % normals.length], after = normals[i];
      const nx = before[0] + after[0], nz = before[1] + after[1];
      const scale = corridor.depth / (nx * after[0] + nz * after[1]);
      return [p[0] + nx * scale, p[1] + nz * scale];
    });
    return { outer: [...outer, outer[0]], holes: [] };
  }
  const ring = section.outer, from = ring[corridor.edge], to = ring[corridor.edge + 1];
  const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
  const area = ring.slice(1).reduce((sum, point, i) => sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0);
  const direction = area >= 0 ? 1 : -1;
  const nx = -dz / length * direction, nz = dx / length * direction;
  // OSM part boundaries are not quite perpendicular to this facade. Extend
  // the ends across that small skew so no thin but full-height end wall remains.
  const extension = corridor.depth * .05;
  const start: Point = [from[0] - dx / length * extension, from[1] - dz / length * extension];
  const end: Point = [to[0] + dx / length * extension, to[1] + dz / length * extension];
  // Cross the original facade very slightly so no coplanar wall survives the cut.
  const point = (p: Point, distance: number): Point => [p[0] + nx * distance, p[1] + nz * distance];
  const outer = [point(start, -.001), point(end, -.001), point(end, corridor.depth), point(start, corridor.depth)];
  return { outer: [...outer, outer[0]], holes: [] };
}

function corridorGeometry(section: Shape, height: number, floorHeight: number, passages: GroundPassage[], corridors: FloorCorridor[]) {
  const polygon = [section.outer, ...section.holes];
  const corridorCuts = corridors.map(corridor => [corridorFootprint(section, corridor, passages).outer]);
  const infills = corridors.flatMap(corridor => corridor.slabInfill ? [[corridor.slabInfill.outer, ...corridor.slabInfill.holes]] : []);
  const corridorArea = polygonClipping.union(corridorCuts[0], ...corridorCuts.slice(1), ...infills);
  // Stitch the small imported facade notch at slab levels only. The open
  // corridor and courtyard remain hollow between floors.
  const slabFootprint = infills.length ? polygonClipping.union(polygon, ...infills) : [polygon];
  const core = polygonClipping.difference(polygon, corridorCuts[0], ...corridorCuts.slice(1));
  const passageCuts = passages.map(passage => {
    const shape = passageShape(passage);
    return [shape.outer, ...shape.holes];
  });
  const slabThickness = Math.min(CORRIDOR_SLAB_THICKNESS, floorHeight * .1, height * .1);
  const slabs = [[0, slabThickness], [height - slabThickness, height]];
  for (let level = 1; level * floorHeight < height - 1e-8; level++) {
    const bottom = level * floorHeight;
    slabs.push([bottom, Math.min(bottom + slabThickness, height)]);
  }
  const levels = [...new Set([0, height, Math.min(floorHeight, height), ...slabs.flat()])].sort((a, b) => a - b);
  const layers = levels.slice(0, -1).map((bottom, i) => {
    const top = levels[i + 1], middle = (bottom + top) / 2;
    const slab = slabs.some(([a, b]) => middle >= a && middle <= b);
    let footprint = slab ? slabFootprint : core;
    // Existing ground roads stay open across the full width, including the slabs.
    if (middle < floorHeight && passageCuts.length) footprint = polygonClipping.difference(footprint, passageCuts[0], ...passageCuts.slice(1));
    return { bottom, top, footprint, slab };
  });
  const positions: number[] = [], occlusionMask: number[] = [];
  const corners = [...new Map(layers.flatMap(layer => layer.footprint.flat(2)).map(point => [point.join(','), point])).values()];
  const insideRing = (point: Point, ring: Point[]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const insideCorridor = (point: Point) => corridorArea.some(([outer, ...holes]) => insideRing(point, outer) && !holes.some(hole => insideRing(point, hole)));
  const addHorizontal = (footprint: polygonClipping.MultiPolygon, y: number, upward: boolean, blocking: boolean) => {
    for (const [outer, ...holes] of footprint) {
      const geometry = new THREE.ShapeGeometry(makeShape({ outer, holes }));
      const vertices = geometry.getAttribute('position'), indices = geometry.getIndex()!;
      for (let i = 0; i < indices.count; i += 3) {
        for (const offset of upward ? [0, 1, 2] : [2, 1, 0]) {
          const index = indices.getX(i + offset);
          positions.push(vertices.getX(index), vertices.getY(index), y);
        }
        occlusionMask.push(blocking ? 1 : 0);
      }
      geometry.dispose();
    }
  };
  const addCap = (footprint: polygonClipping.MultiPolygon, y: number, upward: boolean) => {
    // Keep classroom roofs and passage ceilings blocking; only the recessed
    // corridor's slab surfaces are transparent to photo-marker visibility rays.
    addHorizontal(polygonClipping.difference(footprint, corridorArea), y, upward, true);
    addHorizontal(polygonClipping.intersection(footprint, corridorArea), y, upward, false);
  };
  for (const [i, layer] of layers.entries()) {
    for (const [outer, ...holes] of layer.footprint) {
      // Identical subdivisions keep intact walls free of false seams at slab levels.
      const geometry = new THREE.ExtrudeGeometry(makeShape(splitFacade({ outer, holes }, corners)), { depth: layer.top - layer.bottom, bevelEnabled: false });
      const vertices = geometry.getAttribute('position');
      for (let j = 0; j < vertices.count; j += 3) {
        if (vertices.getZ(j) === vertices.getZ(j + 1) && vertices.getZ(j) === vertices.getZ(j + 2)) continue;
        for (let k = 0; k < 3; k++) positions.push(vertices.getX(j + k), vertices.getY(j + k), vertices.getZ(j + k) + layer.bottom);
        const middle: Point = [0, 1, 2].reduce((sum, k) => [sum[0] + vertices.getX(j + k) / 3, sum[1] - vertices.getY(j + k) / 3] as Point, [0, 0] as Point);
        occlusionMask.push(layer.slab && insideCorridor(middle) ? 0 : 1);
      }
      geometry.dispose();
    }
    // Only exposed floors/ceilings get caps. Shared slab/core interfaces are
    // removed instead of overlapping, so the open corridors do not flicker.
    const previous = layers[i - 1]?.footprint, next = layers[i + 1]?.footprint;
    addCap(previous ? polygonClipping.difference(layer.footprint, previous) : layer.footprint, layer.bottom, false);
    addCap(next ? polygonClipping.difference(layer.footprint, next) : layer.footprint, layer.top, true);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.userData.photoOcclusionMask = new Uint8Array(occlusionMask);
  geometry.computeVertexNormals();
  return geometry;
}

// Geometry stays in the same local extrusion coordinates as ordinary buildings:
// x / -map z on the footprint, and local z for height above the building base.
export function buildingGeometry(section: Shape, height: number, floorHeight: number, passages: GroundPassage[] = [], corridors: FloorCorridor[] = []) {
  if (corridors.length) return corridorGeometry(section, height, floorHeight, passages, corridors);
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

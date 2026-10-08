import * as THREE from 'three';
import type { GlassPavilion, Shape } from './types';

export type PavilionPoint = [number, number, number];
export const PAVILION_BASE = .48;
export function pavilionGeometry(model: GlassPavilion, height: number, segments = 48, cutaway = false) {
  const point = (radius: number, angle: number, y: number): PavilionPoint => [model.center[0] + Math.cos(angle) * radius, y, model.center[1] + Math.sin(angle) * radius];
  const wallTop = PAVILION_BASE + height * .94, peak = PAVILION_BASE + height;
  // The small front half-circle and large rear half-circle share a diameter.
  const bodyStart = model.canopyStartAngle - Math.PI;
  const frontAngle = model.canopyStartAngle - Math.PI / 2;
  const rim = Array.from({ length: segments + 1 }, (_, i) => point(model.radius, bodyStart + i / segments * Math.PI, wallTop));
  const core: Shape = { outer: [...rim.map(([x, , z]) => [x, z] as [number, number]), [rim[0][0], rim[0][2]]], holes: [] };
  const front = [Math.cos(frontAngle), Math.sin(frontAngle)];
  const depth = model.rearDepth ?? model.radius * 1.2;
  const first = core.outer[0], last = core.outer.at(-2)!;
  const rearWing: Shape = { outer: [first, last, [last[0] - front[0] * depth, last[1] - front[1] * depth], [first[0] - front[0] * depth, first[1] - front[1] * depth], first], holes: [] };
  const rearTop = PAVILION_BASE + height * .6;
  const wallVertices = rim.flatMap(([x, , z]) => [[x, PAVILION_BASE, z], [x, wallTop, z]] as PavilionPoint[]);
  const wallIndices = Array.from({ length: segments }, (_, i) => [i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3]).flat();
  const rearGlassVertices: PavilionPoint[] = [[first[0], rearTop, first[1]], [last[0], rearTop, last[1]], rim.at(-1)!, [model.center[0], peak, model.center[1]], rim[0]];
  const rearGlassIndices = [0, 1, 2, 0, 2, 3, 0, 3, 4];
  const roofVertices = [[model.center[0], peak, model.center[1]], ...rim] as PavilionPoint[];
  const roofIndices = cutaway ? [] : Array.from({ length: segments }, (_, i) => [0, i + 1, i + 2]).flat();
  const canopyInner = Array.from({ length: segments + 1 }, (_, i) => point(model.radius, model.canopyStartAngle + model.canopySweep * i / segments, PAVILION_BASE + height * .7));
  const canopyOuter = Array.from({ length: segments + 1 }, (_, i) => point(model.canopyRadius, model.canopyStartAngle + model.canopySweep * i / segments, PAVILION_BASE + height * .64));
  const canopyVertices = canopyInner.flatMap((p, i) => [p, canopyOuter[i]]);
  const canopyIndices = cutaway ? [] : Array.from({ length: segments }, (_, i) => [i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2]).flat();
  const posts = Array.from({ length: 13 }, (_, i) => rim[Math.round(segments * i / 12)]);
  const canopyRibs = Array.from({ length: 13 }, (_, i) => {
    const at = Math.round(segments * i / 12);
    return { inner: canopyInner[at], outer: canopyOuter[at] };
  });
  return { wallTop, peak, rim, core, rearWing, rearTop, wallVertices, wallIndices, rearGlassVertices, rearGlassIndices,
    roofVertices, roofIndices, canopyInner, canopyOuter, canopyVertices, canopyIndices, posts, canopyRibs };
}

export function pavilionSurfaceGeometry(vertices: PavilionPoint[], indices: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

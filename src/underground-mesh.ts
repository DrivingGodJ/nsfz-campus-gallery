import * as THREE from 'three';
import type { Point, Shape } from './types';
import type { PassageOpening } from './underground-geometry';
import { pointOnStairTread } from './structure-geometry.ts';

export type UndergroundViewSpace = { floor: number; height: number; footprints: Shape[] };
export type UndergroundInspectionMode = 'surface' | 'underground';
export type UndergroundMaterialView = 'inside' | 'nearby' | 'plan' | 'surface' | 'overview';
export function undergroundCameraInside(camera: { x: number; y: number; z: number }, space: UndergroundViewSpace) {
  return camera.y >= space.floor - .02 && camera.y < space.floor + space.height - .025 && space.footprints.some(shape => pointOnStairTread([camera.x,camera.z],shape.outer) && !shape.holes.some(hole=>pointOnStairTread([camera.x,camera.z],hole)));
}
export function undergroundViewMode(camera: { x: number; y: number; z: number }, space: UndergroundViewSpace, _spaces: UndergroundViewSpace[], mode: UndergroundInspectionMode, photoPerspective = false): UndergroundMaterialView {
  // Photo views use the complete physical shell from either side of an entrance.
  // Depth testing and real openings determine visibility, never a plan overlay.
  if (photoPerspective) return 'inside';
  const inside = undergroundCameraInside(camera, space);
  return mode === 'surface' ? 'surface' : inside ? 'inside' : 'overview';
}
export function undergroundPartVisible(part: 'volume' | 'plan' | 'ceiling', mode: UndergroundMaterialView, cameraHeight: number, ceilingHeight: number) {
  if (part === 'volume') return mode === 'plan' || mode === 'nearby';
  if (part === 'plan') return mode === 'plan';
  return mode === 'inside' || ((mode === 'plan' || mode === 'nearby') && cameraHeight < ceilingHeight - .1);
}
export function undergroundMaterialView(material: THREE.Material, mode: UndergroundMaterialView, ghostOpacity: number, translucent = false) {
  const solid = mode === 'inside' || mode === 'overview';
  const transparent = !solid || translucent;
  if(material.transparent!==transparent) {material.transparent=transparent;material.needsUpdate=true;}
  material.userData.inside = mode !== 'plan';
  material.opacity = mode === 'surface' ? Math.min(.045, ghostOpacity * .06) : solid && !translucent ? 1 : ghostOpacity;
  material.depthTest = mode !== 'plan';
  material.depthWrite = solid && !translucent;
}

export function undergroundBoundaryLines(shape: Shape, openings: PassageOpening[]) {
  if (!openings.length) return [shape.outer, ...shape.holes];
  const lines: Point[][] = [];
  for (const { from, to } of undergroundWallPanels(shape, .1, openings)) {
    const last = lines.at(-1), end = last?.at(-1);
    if (end && Math.hypot(end[0] - from[0], end[1] - from[1]) < 1e-6) last!.push(to);
    else lines.push([from, to]);
  }
  return lines;
}

export function undergroundWallPanels(shape: Shape, height: number, openings: PassageOpening[]) {
  return [shape.outer, ...shape.holes].flatMap(ring => ring.slice(1).flatMap((to, i) => {
    const from = ring[i], dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
    if (length < 1e-7) return [];
    const along = (p: Point) => ((p[0] - from[0]) * dx + (p[1] - from[1]) * dz) / length;
    const across = (p: Point) => Math.abs((p[0] - from[0]) * dz - (p[1] - from[1]) * dx) / length;
    const doors = openings.flatMap(opening => {
      if (across(opening[0]) > 1e-5 || across(opening[1]) > 1e-5) return [];
      const start = Math.max(0, Math.min(...opening.map(along))), end = Math.min(length, Math.max(...opening.map(along)));
      return end - start > 1e-5 ? [{ start, end, top: Math.min(height, opening.height ?? height) }] : [];
    });
    const breaks = [...new Set([0, length, ...doors.flatMap(door => [door.start, door.end])])].sort((a, b) => a - b);
    const at = (distance: number): Point => [from[0] + dx / length * distance, from[1] + dz / length * distance];
    return breaks.slice(1).flatMap((end, j) => {
      const start = breaks[j], middle = (start + end) / 2;
      const bottom = Math.max(0, ...doors.filter(door => door.start < middle && door.end > middle).map(door => door.top));
      return height - bottom > 1e-5 ? [{ from: at(start), to: at(end), bottom, top: height }] : [];
    });
  }));
}

// Keep the floor and ceiling. At unequal ceilings, retain the wall above the
// shorter passage; clipping a whole triangle would otherwise leave a tall gap.
export function undergroundVolume(shape: Shape, height: number, openings: PassageOpening[], hideCeiling = false) {
  const outline = new THREE.Shape(shape.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  outline.holes = shape.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
  const extrusion = new THREE.ExtrudeGeometry(outline, { depth: height, bevelEnabled: false });
  if (!openings.length && !hideCeiling) return extrusion;
  const vertices = extrusion.getAttribute('position'), positions: number[] = [];
  for (let i = 0; i < vertices.count; i += 3) {
    const vertical = Math.max(...[0, 1, 2].map(j => vertices.getZ(i + j))) - Math.min(...[0, 1, 2].map(j => vertices.getZ(i + j))) > 1e-5;
    if (vertical) continue;
    if (hideCeiling && [0, 1, 2].every(j => vertices.getZ(i + j) > height - 1e-5)) continue;
    for (let j = 0; j < 3; j++) positions.push(vertices.getX(i + j), vertices.getY(i + j), vertices.getZ(i + j));
  }
  const panels = undergroundWallPanels(shape, height, openings);
  const area = shape.outer.slice(1).reduce((sum, p, i) => sum + shape.outer[i][0] * p[1] - p[0] * shape.outer[i][1], 0);
  for (const { from, to, bottom, top } of panels) {
    const a = [from[0], -from[1], bottom], b = [to[0], -to[1], bottom], c = [to[0], -to[1], top], d = [from[0], -from[1], top];
    const triangles = area > 0 ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const point of triangles) positions.push(...point);
  }
  extrusion.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

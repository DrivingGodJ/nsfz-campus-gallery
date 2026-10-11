import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import type { Feature, Point } from './types';

export const STREET_FENCE_COLOR = '#20382e';
export const STREET_FENCE_RAIL_LEVELS = [.22, .72];

// The frontage chains already stop at the school gates, crossing paths and
// footbridge. Never join separate chains with a rail or an ornamental panel.
export function streetFenceGeometry(feature: Feature) {
  const height = feature.railHeight ?? 1.6, base = feature.height ?? .12;
  const parts: THREE.BufferGeometry[] = [], posts = new Map<string, Point>();
  const picket = new THREE.BoxGeometry(.027, 1, .027);
  const spear = new THREE.ConeGeometry(.052, height * .09, 4).rotateY(Math.PI / 4);
  const stemTop = height * .91;
  for (const chain of feature.railEdges || []) for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1], to = chain[i], dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const point = (along: number, y: number): [number, number, number] => [from[0] + dx * along / length, base + y, from[1] + dz * along / length];
    for (const level of STREET_FENCE_RAIL_LEVELS) parts.push(architectureBar(point(0, height * level), point(length, height * level), .042));
    const panels = Math.ceil(length / 2.4), panelWidth = length / panels, slots = Math.ceil(panelWidth / .18), spacing = panelWidth / slots;
    for (let panel = 0; panel < panels; panel++) {
      const start = panel * panelWidth;
      for (const along of [start, start + panelWidth]) {
        const [x, , z] = point(along, 0); posts.set(x.toFixed(6) + ',' + z.toFixed(6), [x, z]);
      }
      for (let slot = 1; slot < slots; slot++) {
        const along = start + slot * spacing;
        const [x, , z] = point(along, 0);
        parts.push(picket.clone().scale(1, stemTop - .04, 1).translate(x, base + (stemTop + .04) / 2, z));
        parts.push(spear.clone().translate(x, base + height * .955, z));
      }
      // Repeating pointed diamonds make the photographed arch lattice while
      // keeping both horizontal rails and the thin vertical pickets readable.
      for (let slot = 2; slot < slots - 1; slot += 2) {
        const along = start + slot * spacing;
        const diamond = [point(along, height * .68), point(along + spacing, height * .8), point(along, height * .92), point(along - spacing, height * .8)];
        for (let side = 0; side < 4; side++) parts.push(architectureBar(diamond[side], diamond[(side + 1) % 4], .021));
      }
    }
  }
  for (const [x, z] of posts.values()) {
    parts.push(new THREE.BoxGeometry(.065, stemTop, .065).translate(x, base + stemTop / 2, z));
    parts.push(spear.clone().scale(1.25, 1, 1.25).translate(x, base + height * .955, z));
  }
  picket.dispose(); spear.dispose();
  const geometry = architectureBatch(parts);
  geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

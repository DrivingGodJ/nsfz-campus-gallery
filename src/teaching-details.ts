import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { architectureBar as bar, architectureBatch as batch } from './architecture-geometry.ts';
import { passageShape } from './building-geometry.ts';
import type { Building, BuildingPart, Point } from './types';

export const TEACHING_ID = 'way/855459420';
type Section = BuildingPart & { height: number; floors: number };
const BASE = .12;

// DSC07194/IMG_1764 show square atrium columns and blue diamond guards;
// DJI_20250820144450_0006_D shows the circular ground-floor paving motif.
// Dimensions are estimates within the user's unchanged courtyard boundaries.
export function teachingDetailGeometry(building: Building, sections: Section[], floorHeight: number, cutawayHeight?: number) {
  const columns: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], paving: THREE.BufferGeometry[] = [], inlay: THREE.BufferGeometry[] = [];
  const units: THREE.BufferGeometry[] = [], vents: THREE.BufferGeometry[] = [];
  const passages = (building.groundPassages || []).map(passageShape);
  for (const section of sections) {
    const shown = Math.min(section.height, cutawayHeight ?? Infinity);
    for (const corridor of building.floorCorridors || []) {
      if (corridor.partId !== section.id || !('holeIndex' in corridor)) continue;
      const ring = section.holes[corridor.holeIndex], center = ring.slice(0, -1).reduce((sum, p) => [sum[0] + p[0] / (ring.length - 1), sum[1] + p[1] / (ring.length - 1)] as Point, [0, 0]);
      const area = ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0), sign = area > 0 ? 1 : -1;
      const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
      const floor = new THREE.ShapeGeometry(shape); floor.rotateX(-Math.PI / 2); floor.translate(0, BASE + .015, 0); paving.push(floor);
      for (let edge = 0; edge < ring.length - 1; edge++) {
        const a = ring[edge], b = ring[edge + 1], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
        const at = (t: number, offset = .16): Point => [a[0] + dx * t + dz / length * sign * offset, a[1] + dz * t - dx / length * sign * offset];
        const count = Math.max(2, Math.round(length / 4.8));
        for (let i = 0; i < count; i++) {
          const [x, z] = at(i / count);
          const footprint = [[-.18, -.18], [.18, -.18], [.18, .18], [-.18, .18], [-.18, -.18]].map(([u,v]) => [x + dx / length * u - dz / length * v, z + dz / length * u + dx / length * v] as Point);
          const overRoad = passages.some(p => polygonClipping.intersection([footprint], [p.outer, ...p.holes]).length);
          const bottom = overRoad ? floorHeight + .25 : .25;
          if (shown <= bottom) continue;
          const column = new THREE.BoxGeometry(.36, shown - bottom, .36);
          column.rotateY(-Math.atan2(dz, dx)); column.translate(x, BASE + (shown + bottom) / 2, z); columns.push(column);
        }
        for (let level = 1; level * floorHeight + 1.35 < shown; level++) {
          const panels = Math.ceil(length / 2.7), y = BASE + level * floorHeight + .25;
          for (let panel = 0; panel < panels; panel++) {
            const start = at((panel + .05) / panels, .09), end = at((panel + .95) / panels, .09), middle = at((panel + .5) / panels, .09);
            for (const p of [start, end]) for (const rise of [.53, .88]) rails.push(bar([p[0], y + .705, p[1]], [middle[0], y + rise, middle[1]], .035));
          }
          const start = at(0, .09), end = at(1, .09);
          rails.push(bar([start[0], y + .28, start[1]], [end[0], y + .28, end[1]], .035));
        }
      }
      if (section.id === 'main') {
        const disk = new THREE.CircleGeometry(2.75, 48); disk.rotateX(-Math.PI / 2); disk.translate(center[0], BASE + .024, center[1]); inlay.push(disk);
        const ring = new THREE.RingGeometry(2.8, 3.08, 48); ring.rotateX(-Math.PI / 2); ring.translate(center[0], BASE + .025, center[1]); inlay.push(ring);
      }
      // Pale joints follow the courtyard axes, rather than a world-aligned grid.
      if (ring.length === 5) for (const [a, b, c, d] of [[ring[0], ring[1], ring[3], ring[2]], [ring[0], ring[3], ring[1], ring[2]]]) {
        const count = Math.ceil(Math.hypot(a[0] - b[0], a[1] - b[1]) / 2.4);
        for (let i = 1; i < count; i++) inlay.push(bar([a[0] + (b[0] - a[0]) * i / count, BASE + .022, a[1] + (b[1] - a[1]) * i / count], [c[0] + (d[0] - c[0]) * i / count, BASE + .022, c[1] + (d[1] - c[1]) * i / count], .025, .012));
      }
    }
    // Outdoor AC boxes are visible between window bays in DSC1397/IMG_9746.
    // Keep them outside the original outer walls and away from ground passages.
    const ring = section.outer, area = ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0), sign = area > 0 ? 1 : -1;
    for (let edge = 0; edge < ring.length - 1; edge++) {
      const a = ring[edge], b = ring[edge + 1], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz), bays = Math.floor(length / (building.classroomWindows?.bayWidth ?? 6.6));
      if (length < 14) continue;
      if (building.floorCorridors?.some(c => c.partId === section.id && ('edge' in c && c.edge === edge || 'edges' in c && c.edges.includes(edge)))) continue;
      const nx = dz / length * sign, nz = -dx / length * sign;
      for (let bay = 1; bay < bays; bay += 2) for (let level = 1; level < section.floors; level++) {
        const bottom = level * floorHeight + 1.25, top = bottom + .56;
        if (top > shown - .1) continue;
        const x = a[0] + dx * bay / bays + nx * .23, z = a[1] + dz * bay / bays + nz * .23;
        const box = new THREE.BoxGeometry(.82, .56, .36); box.rotateY(-Math.atan2(dz, dx)); box.translate(x, BASE + (bottom + top) / 2, z); units.push(box);
        const fan = new THREE.CylinderGeometry(.2, .2, .025, 12); fan.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)));
        fan.translate(x + nx * .19, BASE + (bottom + top) / 2, z + nz * .19); vents.push(fan);
      }
    }
  }
  return { columns: batch(columns, false), rails: batch(rails, false), paving: batch(paving, false), inlay: batch(inlay, false), units: batch(units, false), vents: batch(vents, false) };
}

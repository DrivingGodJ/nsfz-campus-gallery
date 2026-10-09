import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import polygonClipping from 'polygon-clipping';
import { snapFootprint } from './building-geometry.ts';
import { laboratoryLayout } from './laboratory-geometry.ts';
import { architectureBar } from './architecture-geometry.ts';
import type { Building, BuildingPart, Point } from './types';

export const SKYLIGHT_BASE = .12;
export const SKYLIGHT_THICKNESS = .08;

type Section = BuildingPart & { height: number };

export function buildingSkylightGeometry(building: Building, sections: Section[], cutawayHeight?: number) {
  return (building.skylights || []).flatMap((skylight, index) => {
    const section = sections.find(section => section.id === skylight.partId);
    let hole = skylight.outline === 'outer' ? section?.outer : section?.holes[skylight.holeIndex ?? -1];
    // A roof belongs to its original section. It must not move down onto a
    // selected lower floor, or cover the neighbouring open courtyard.
    if (!section || !hole?.length || cutawayHeight !== undefined && cutawayHeight <= section.height) return [];
    const laboratory = building.facade?.type === 'laboratory';
    if (laboratory && skylight.outline === 'outer') {
      const { at, seam } = laboratoryLayout(building);
      const span = Math.max(...hole.map(p => Math.hypot(p[0] - at(0, 0)[0], p[1] - at(0, 0)[1]))) * 2;
      const boundary = [seam(-span), at(span, -span), at(span, span), seam(span), seam(-span)];
      hole = polygonClipping.intersection(snapFootprint([[hole]]), snapFootprint([[boundary]]))[0]?.[0] as Point[];
      if (!hole?.length) return [];
    }
    const ring = hole[0][0] === hole.at(-1)![0] && hole[0][1] === hole.at(-1)![1] ? hole.slice(0, -1) : hole;
    if (ring.length < 3) return [];
    const y = SKYLIGHT_BASE + section.height + (laboratory ? .18 : .03);
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const glass = new THREE.ExtrudeGeometry(shape, { depth: SKYLIGHT_THICKNESS, bevelEnabled: false });
    glass.rotateX(-Math.PI / 2);
    glass.translate(0, y, 0);
    if ((skylight.opacity ?? .92) < .9) glass.userData.photoOcclusionMask = new Uint8Array(glass.getAttribute('position').count / 3);
    const beams: THREE.BufferGeometry[] = [];
    const beam = (a: Point, b: Point, width: number, height: number, centerY: number) => {
      const dx = b[0] - a[0], dz = b[1] - a[1];
      const box = new THREE.BoxGeometry(width, height, Math.hypot(dx, dz));
      box.rotateY(Math.atan2(dx, dz));
      box.translate((a[0] + b[0]) / 2, centerY, (a[1] + b[1]) / 2);
      beams.push(box);
    };
    ring.forEach((point, i) => beam(point, ring[(i + 1) % ring.length], .16, .18, y + SKYLIGHT_THICKNESS / 2));
    if (ring.length === 4) {
      const interpolate = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const gridY = y + SKYLIGHT_THICKNESS + .025;
      for (const [count, from, to, oppositeFrom, oppositeTo] of [
        [skylight.columns ?? 10, ring[0], ring[1], ring[3], ring[2]],
        [skylight.rows ?? 9, ring[0], ring[3], ring[1], ring[2]],
      ] as [number, Point, Point, Point, Point][]) {
        for (let i = 1; i < count; i++) beam(interpolate(from, to, i / count), interpolate(oppositeFrom, oppositeTo, i / count), .045, .04, gridY);
      }
      if (building.id === 'way/855459420') {
        // The teaching atrium's photographed roof has a shallow space frame
        // under the glass. Keep it attached to the roof, including its cutaway.
        const columns = skylight.columns ?? 10, rows = skylight.rows ?? 9;
        const at = (u: number, v: number): Point => interpolate(interpolate(ring[0], ring[1], u), interpolate(ring[3], ring[2], u), v);
        const lower = y - .68;
        for (let u = 0; u < columns; u++) for (let v = 0; v < rows; v++) {
          const middle = at((u + .5) / columns, (v + .5) / rows);
          for (const du of [0, 1]) for (const dv of [0, 1]) {
            const corner = at((u + du) / columns, (v + dv) / rows);
            beams.push(architectureBar([corner[0], y, corner[1]], [middle[0], lower, middle[1]], .045));
          }
          if (u < columns - 1) beam(middle, at((u + 1.5) / columns, (v + .5) / rows), .05, .05, lower);
          if (v < rows - 1) beam(middle, at((u + .5) / columns, (v + 1.5) / rows), .05, .05, lower);
        }
      }
    }
    const frame = mergeGeometries(beams)!;
    beams.forEach(beam => beam.dispose());
    if ((skylight.opacity ?? .92) < .9) frame.userData.photoOcclusionMask = new Uint8Array((frame.index?.count ?? frame.getAttribute('position').count) / 3);
    return [{ id: `${skylight.partId}-${index}`, glass, frame, opacity: skylight.opacity ?? .92 }];
  });
}

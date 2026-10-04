import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Building, BuildingPart, Point } from './types';

export const SKYLIGHT_BASE = .12;
export const SKYLIGHT_THICKNESS = .08;

type Section = BuildingPart & { height: number };

export function buildingSkylightGeometry(building: Building, sections: Section[], cutawayHeight?: number) {
  return (building.skylights || []).flatMap((skylight, index) => {
    const section = sections.find(section => section.id === skylight.partId);
    const hole = section?.holes[skylight.holeIndex];
    // A roof belongs to its original section. It must not move down onto a
    // selected lower floor, or cover the neighbouring open courtyard.
    if (!section || !hole?.length || cutawayHeight !== undefined && cutawayHeight < section.height) return [];
    const ring = hole[0][0] === hole.at(-1)![0] && hole[0][1] === hole.at(-1)![1] ? hole.slice(0, -1) : hole;
    if (ring.length < 3) return [];
    const y = SKYLIGHT_BASE + section.height + .03;
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    const glass = new THREE.ExtrudeGeometry(shape, { depth: SKYLIGHT_THICKNESS, bevelEnabled: false });
    glass.rotateX(-Math.PI / 2);
    glass.translate(0, y, 0);
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
    }
    const frame = mergeGeometries(beams)!;
    beams.forEach(beam => beam.dispose());
    return [{ id: `${skylight.partId}-${index}`, glass, frame }];
  });
}

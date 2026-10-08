import * as THREE from 'three';
import { cafeteriaLowerProfile, dormitoryProfile } from './facade-geometry.ts';
import { laboratoryLayout } from './laboratory-geometry.ts';
import type { Building, BuildingPart, Point, Shape } from './types';

type Section = BuildingPart & { height: number; floors: number };

// Offset each segment toward the exposed side of its wall, including courtyard walls.
// One line geometry per building keeps floor divisions inexpensive at campus scale.
export function buildingFloorLineGeometry(building: Building, sections: Section[], floorHeight: number, cutawayFloor?: number) {
  const positions: number[] = [];
  const labWalls = building.facade?.type === 'laboratory' ? laboratoryLayout(building).walls : undefined;
  const curved = building.facade?.type === 'dormitory' ? dormitoryProfile(building).shape : undefined;
  const lower = building.facade?.type === 'cafeteria' ? cafeteriaLowerProfile(building).shape : undefined;
  const addRing = (ring: Point[], y: number, hole: boolean) => {
    const vertices = ring[0]?.[0] === ring.at(-1)?.[0] && ring[0]?.[1] === ring.at(-1)?.[1] ? ring.slice(0, -1) : ring;
    const area = vertices.reduce((sum, p, i) => { const q = vertices[(i + 1) % vertices.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    const direction = (area >= 0 ? 1 : -1) * (hole ? -1 : 1);
    vertices.forEach((p, i) => {
      const q = vertices[(i + 1) % vertices.length], dx = q[0] - p[0], dz = q[1] - p[1], length = Math.hypot(dx, dz);
      if (length < 1e-7) return;
      const x = dz / length * .035 * direction, z = -dx / length * .035 * direction;
      positions.push(p[0] + x, y, p[1] + z, q[0] + x, y, q[1] + z);
    });
  };
  for (const section of sections) {
    const levels = Math.min(section.floors, cutawayFloor || section.floors);
    for (let level = 1; level < levels; level++) {
      if (labWalls) {
        for (const wall of labWalls) {
          addRing(wall.outer, .12 + level * floorHeight, false);
          wall.holes.forEach(ring => addRing(ring, .12 + level * floorHeight, true));
        }
        continue;
      }
      const contour: Shape = curved || (level <= 2 && lower) || section;
      addRing(contour.outer, .12 + level * floorHeight, false);
      contour.holes.forEach(ring => addRing(ring, .12 + level * floorHeight, true));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

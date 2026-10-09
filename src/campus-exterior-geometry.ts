import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACADE_COLORS } from './facade-geometry.ts';
import type { Building, Point } from './types';

export const OFFICE_ID = 'way/1233313430';
export const LIBRARY_ID = 'way/855459419';
export const EXTERIOR_COLORS = { glass: FACADE_COLORS.glass, frame: FACADE_COLORS.stone, accent: '#ad7961' };
type Kind = keyof typeof EXTERIOR_COLORS;

// These shallow panels enrich observed faces while preserving the approved body.
// Bay spacing is estimated; no unobserved entrance or rooftop fixture is added.
export function campusExteriorGeometry(building: Building, floors: number, floorHeight: number, cutawayHeight?: number, annexFloors?: number) {
  const parts: Record<Kind, THREE.BufferGeometry[]> = { glass: [], frame: [], accent: [] };
  const area = building.outer.slice(1).reduce((sum, p, i) => sum + building.outer[i][0] * p[1] - p[0] * building.outer[i][1], 0);
  const face = (edge: number) => {
    const a = building.outer[edge], b = building.outer[edge + 1];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]), u: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const n: Point = area > 0 ? [u[1], -u[0]] : [-u[1], u[0]];
    return { a, u, n, length };
  };
  const box = (edge: number, at: number, width: number, bottom: number, top: number, kind: Kind, offset = .1, depth = .07) => {
    top = Math.min(top, .12 + (cutawayHeight ?? Infinity));
    if (top <= bottom + 1e-5 || width <= 0) return;
    const { a, u, n } = face(edge);
    parts[kind].push(new THREE.BoxGeometry(width, top - bottom, depth).rotateY(-Math.atan2(u[1], u[0]))
      .translate(a[0] + u[0] * at + n[0] * offset, (bottom + top) / 2, a[1] + u[1] * at + n[1] * offset));
  };
  if (building.id === OFFICE_ID && building.outer.length > 15) {
    // DSC06615 / DSC8181 view this exact front face; DSC8913 faces edge 6.
    const length = face(13).length, height = .12 + floors * floorHeight;
    if (building.classroomWindows) {
      // Brick spandrels surround the real apertures. The old full-height
      // decorative rectangle would otherwise close their newly hollow holes.
      const { sill, top } = building.classroomWindows;
      for (let floor = 0; floor < floors; floor++) {
        const base = .12 + floor * floorHeight;
        box(13, length * .19, length * .38 - .2, base, base + Math.min(sill, floorHeight * .3) - .025, 'accent', .055);
        box(13, length * .19, length * .38 - .2, base + Math.min(top, floorHeight - .35) + .025, base + floorHeight - .25, 'accent', .055);
      }
    } else {
      box(13, length * .19, length * .38 - .2, .12, height - .25, 'accent', .055);
    }
    // Ordinary windows and the tall strip have one shared aperture/glazing
    // layout. This shallow detail layer supplies only the observed brickwork.
  } else if (building.id === LIBRARY_ID && building.outer.length > 14) {
    const levels = annexFloors ?? building.parts?.find(part => part.id === 'curved-annex')?.floors ?? 3;
    // Glazing belongs to the evidence-gated aperture layout. Missing window
    // data must leave the body solid, rather than paste glass over its walls.
    // White diagonal steel visible beside the entry. Stop each brace at a floor.
    for (const edge of [1, 2]) {
      const { a, u, n, length } = face(edge);
      const at = (distance: number, y: number) => new THREE.Vector3(a[0] + u[0] * distance + n[0] * .22, y, a[1] + u[1] * distance + n[1] * .22);
      for (let floor = 0; floor < levels; floor++) {
        const bottom = .12 + floor * floorHeight + .25, top = Math.min(.12 + (floor + 1) * floorHeight - .2, .05 + (cutawayHeight ?? Infinity));
        if (top <= bottom) continue;
        const fraction = (top - bottom) / (floorHeight - .45), from = at(.25, bottom), to = at(.25 + (length - .5) * fraction, top), direction = to.clone().sub(from);
        parts.frame.push(new THREE.CylinderGeometry(.055, .055, direction.length(), 6)
          .applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()))
          .translate(...from.add(to).multiplyScalar(.5).toArray()));
      }
    }
  }
  const merge = (list: THREE.BufferGeometry[]) => {
    const plain = list.map(part => { const geometry = part.toNonIndexed(); geometry.deleteAttribute('uv'); return geometry; });
    const geometry = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    list.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
    geometry.userData.photoOcclusionMask = new Uint8Array(geometry.getAttribute('position').count / 3);
    return geometry;
  };
  return Object.fromEntries(Object.entries(parts).map(([kind, list]) => [kind, merge(list)])) as Record<Kind, THREE.BufferGeometry>;
}

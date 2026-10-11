import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FACADE_COLORS } from './facade-geometry.ts';
import { architectureBar, classroomGlazingGeometry } from './architecture-geometry.ts';
import { officeCurvedFacade, officeCurvedWindows } from './office-windows.ts';
import type { Building, Point } from './types';

export const OFFICE_ID = 'way/1233313430';
export const LIBRARY_ID = 'way/855459419';
export const EXTERIOR_COLORS = { glass: FACADE_COLORS.glass, frame: FACADE_COLORS.stone, accent: '#ad7961', darkFrame: '#354b50', canopyGlass: '#b1c8bf', canopyFrame: '#c5cbc5' };
type Kind = keyof typeof EXTERIOR_COLORS;

export function libraryAnnexWindowsConfig(building: Building, floorHeight: number) {
  const config = building.classroomWindows;
  return config && { ...config, sill: .3, top: floorHeight - .35, transomFractions: [.5] };
}

// The marked door is at the south end of the curved annex. Projection and
// member spacing are estimates from 34868811; no freestanding posts are seen.
export function libraryEntranceLayout(building: Building, floorHeight: number) {
  const a = building.outer[2], b = building.outer[3], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const along: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const area = building.outer.slice(1).reduce((sum, p, i) => sum + building.outer[i][0] * p[1] - p[0] * building.outer[i][1], 0);
  const outward: Point = area > 0 ? [along[1], -along[0]] : [-along[1], along[0]];
  const center: Point = [a[0] + along[0] * length * .62, a[1] + along[1] * length * .62];
  const width = 4, depth = 2.3, wallHeight = .12 + floorHeight + .05;
  const at = (u: number, v: number, y = wallHeight - .2 * v / depth) => new THREE.Vector3(center[0] + along[0] * u + outward[0] * v, y, center[1] + along[1] * u + outward[1] * v);
  return { center, along, outward, width, depth, wallHeight, at };
}

// Observed brick panels and the deep west window reveals preserve the approved
// footprint. Bay spacing is estimated; no unobserved entrance is added.
export function campusExteriorGeometry(building: Building, floors: number, floorHeight: number, cutawayHeight?: number, annexFloors?: number) {
  const parts: Record<Kind, THREE.BufferGeometry[]> = { glass: [], frame: [], accent: [], darkFrame: [], canopyGlass: [], canopyFrame: [] };
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
    // Ordinary windows and the tall strip keep their shared aperture/glazing
    // layout. The curved panes below use the same cuts with their deep reveals.
    const curved = officeCurvedFacade(building), windows = officeCurvedWindows(building, Math.min(floors * floorHeight, cutawayHeight ?? Infinity), floorHeight, floors);
    if (curved) {
      const glazing = classroomGlazingGeometry(windows, { ...building.classroomWindows!, transomFractions: [.5] });
      parts.glass.push(glazing.glass); parts.darkFrame.push(glazing.frames);
      for (let edge = 0; edge < curved.faces.length; edge++) {
        const { length } = curved.faces[edge];
        // The lower two unseen storeys retain the existing solid wall. Above,
        // red-brown spandrels border the true continuous apertures.
        box(edge, length / 2, length, .12, .12 + (floors - 2) * floorHeight, 'accent', .045, .06);
        for (let floor = floors - 2; floor < floors; floor++) {
          const bottom = .12 + floor * floorHeight, high = .12 + (floor + 1) * floorHeight;
          const sill = floor === floors - 1 ? .35 : .95, head = floor === floors - 1 ? .28 : .72;
          box(edge, length / 2, length, bottom, bottom + sill, 'accent', .045, .06);
          box(edge, length / 2, length, high - head, high, 'accent', .045, .06);
        }
        for (const window of windows.filter(window => window.from[0] === curved.at(edge, .72)[0] && window.from[1] === curved.at(edge, .72)[1])) {
          // A real deep reveal meets the inset glazing; the underside casts the
          // dark shadow visible below the broad projecting brick waist band.
          box(edge, length / 2, length, .12 + window.top - .035, .12 + window.top + .025, 'darkFrame', -.36, .78);
          box(edge, length / 2, length, .12 + window.bottom - .025, .12 + window.bottom + .025, 'accent', -.36, .78);
        }
      }
      // The photographed tall brick wing is the north return, not a new mass
      // over the whole roof. Its cap stays on the existing end-wall footprint.
      const wing = face(15);
      box(15, wing.length / 2, wing.length, .12, height, 'accent', .045, .06);
      if (cutawayHeight === undefined) box(15, wing.length / 2, wing.length, height, height + .9, 'accent', -.1, .2);
      for (const index of [0, curved.faces.length]) {
        const from = curved.at(index, .04), to = curved.at(index, .76), dx = to[0] - from[0], dz = to[1] - from[1];
        const low = .12 + (floors - 2) * floorHeight + .95, high = Math.min(.12 + (floors - 1) * floorHeight - .72, .12 + (cutawayHeight ?? Infinity));
        if (high > low) parts.darkFrame.push(new THREE.BoxGeometry(Math.hypot(dx, dz), high - low, .08)
          .rotateY(-Math.atan2(dz, dx)).translate((from[0] + to[0]) / 2, (low + high) / 2, (from[1] + to[1]) / 2));
      }
    }
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
    const { width, depth, wallHeight, at } = libraryEntranceLayout(building, floorHeight), ceiling = .12 + (cutawayHeight ?? Infinity);
    const corners = [at(-width / 2, .08), at(width / 2, .08), at(width / 2, depth), at(-width / 2, depth)];
    if (corners.every(point => point.y <= ceiling)) {
      const roof = new THREE.BufferGeometry().setFromPoints(corners);
      roof.setIndex([0, 1, 2, 0, 2, 3]); roof.computeVertexNormals(); parts.canopyGlass.push(roof);
    }
    const member = (from: THREE.Vector3, to: THREE.Vector3, size = .065) => {
      if (from.y <= ceiling && to.y <= ceiling) parts.canopyFrame.push(architectureBar(from.toArray(), to.toArray(), size));
    };
    for (let i = 0; i < corners.length; i++) member(corners[i], corners[(i + 1) % corners.length], .08);
    for (let i = 1; i < 4; i++) member(at(-width / 2 + width * i / 4, .08), at(-width / 2 + width * i / 4, depth));
    for (const u of [-width * .36, width * .36]) {
      member(at(u, .06, wallHeight + .9), at(u, depth * .85), .035);
      member(at(u, .06, wallHeight - .65), at(u, depth * .7, wallHeight - .2), .055);
    }
  }
  const merge = (list: THREE.BufferGeometry[]) => {
    const plain = list.map(part => { const geometry = part.index ? part.toNonIndexed() : part.clone(); geometry.deleteAttribute('uv'); return geometry; });
    const geometry = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    list.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
    geometry.userData.photoOcclusionMask = new Uint8Array(geometry.getAttribute('position').count / 3);
    return geometry;
  };
  return Object.fromEntries(Object.entries(parts).map(([kind, list]) => [kind, merge(list)])) as Record<Kind, THREE.BufferGeometry>;
}

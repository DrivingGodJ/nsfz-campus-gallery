import * as THREE from 'three';
import { architectureBatch } from './architecture-geometry.ts';
import type { ClassroomWindow } from './teaching-classrooms';
import type { Building, Point } from './types';

// DSC07782 locates the modern lobby on the long lake-facing wing. It is
// separate from the older arched entrance below the observatory.
export function dormitoryEntranceLayout(building: Building) {
  const model = building.facade?.lobbyEntry;
  if (!model) return undefined;
  const a = building.outer[model.edge], b = building.outer[model.edge + 1];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const axis: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const area = building.outer.slice(1).reduce((sum, point, i) => sum + building.outer[i][0] * point[1] - point[0] * building.outer[i][1], 0);
  const inward: Point = area > 0 ? [-axis[1], axis[0]] : [axis[1], -axis[0]];
  const center: Point = [a[0] + (b[0] - a[0]) * model.at, a[1] + (b[1] - a[1]) * model.at];
  const at = (u: number, v: number): Point => [center[0] + axis[0] * u + inward[0] * v, center[1] + axis[1] * u + inward[1] * v];
  const wall = building.classroomWindows?.wallThickness ?? .3;
  const half = model.width / 2, from = at(-half, 0), to = at(half, 0);
  const opening: ClassroomWindow = { from, to, bottom: .02, top: model.height,
    cut: [[at(-half, -.22), at(half, -.22), at(half, wall + .3), at(-half, wall + .3), at(-half, -.22)]] };
  // Six photographed face readers serve glass-flap lanes; a wider side gate
  // leaves an accessible route beside the bank. Dimensions are estimates.
  const spacing = .9, start = -model.width / 2 + .4;
  const pedestals = Array.from({ length: model.lanes + 1 }, (_, i) => ({ u: start + i * spacing, v: 3.4, reader: i < model.lanes }));
  const accessible = { from: start + model.lanes * spacing + .12, to: half - .15, v: 3.4 };
  return { ...model, center, axis, inward, at, opening, pedestals, accessible, spacing };
}

export function dormitoryEntranceGeometry(building: Building, visibleHeight = Infinity) {
  const layout = dormitoryEntranceLayout(building);
  const parts = { metal: [] as THREE.BufferGeometry[], dark: [] as THREE.BufferGeometry[], glass: [] as THREE.BufferGeometry[], screens: [] as THREE.BufferGeometry[] };
  if (layout) {
    const box = (kind: keyof typeof parts, u: number, y: number, v: number, width: number, height: number, depth: number) => {
      const bottom = Math.max(0, y - height / 2), top = Math.min(visibleHeight - .12, y + height / 2);
      if (top <= bottom) return;
      const point = layout.at(u, v);
      parts[kind].push(new THREE.BoxGeometry(width, top - bottom, depth).rotateY(-Math.atan2(layout.axis[1], layout.axis[0])).translate(point[0], .12 + (bottom + top) / 2, point[1]));
    };
    const half = layout.width / 2, top = layout.height, transom = top - .5, leaf = 1.7;
    // One continuous glazed entry, with two broad door leaves and fixed lights.
    box('glass', 0, top / 2, .06, layout.width - .1, top - .1, .025);
    for (const u of [-half, -leaf, 0, leaf, half]) box('metal', u, top / 2, .04, .065, top, .12);
    for (const y of [.045, transom, top - .025]) box('metal', 0, y, .04, layout.width, .055, .12);
    for (const u of [-.18, .18]) box('metal', u, 1.13, -.05, .04, .48, .05);
    for (const pedestal of layout.pedestals) {
      const { u, v } = pedestal;
      box('metal', u, .48, v, .2, .96, 1.62);
      box('dark', u, .97, v, .21, .035, 1.64);
      if (pedestal.reader) {
        box('metal', u, 1.16, v - .46, .06, .36, .08);
        box('dark', u, 1.46, v - .46, .29, .48, .08);
        box('screens', u, 1.46, v - .51, .245, .405, .015);
        box('metal', u, 1.76, v - .46, .27, .095, .09);
        box('dark', u, 1.76, v - .515, .065, .065, .012);
      }
    }
    for (let i = 0; i < layout.lanes; i++) {
      const center = (layout.pedestals[i].u + layout.pedestals[i + 1].u) / 2;
      for (const side of [-1, 1]) box('glass', center + side * .19, .66, 3.4, .31, .66, .025);
    }
    const access = layout.accessible;
    box('metal', access.to, .5, access.v, .06, 1, .06);
    for (const y of [.39, .84]) box('metal', (access.from + access.to) / 2, y, access.v, access.to - access.from, .035, .035);
    box('glass', (access.from + access.to) / 2, .615, access.v, access.to - access.from, .415, .025);
  }
  return Object.fromEntries(Object.entries(parts).map(([kind, pieces]) => [kind, architectureBatch(pieces, kind !== 'glass')])) as Record<keyof typeof parts, THREE.BufferGeometry>;
}

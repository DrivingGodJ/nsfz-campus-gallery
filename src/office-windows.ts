import polygonClipping from 'polygon-clipping';
import { classroomWindowLayout, confirmedFacade, type ClassroomWindow } from './teaching-classrooms.ts';
import type { Building, Point } from './types';

export type OfficeWindow = ClassroomWindow & { curvedOffice?: true };

// April 28's upward west view confirms this curved run, independently of the
// ordinary windows on the already calibrated south and north faces.
export function officeCurvedFacade(building: Building) {
  const config = building.classroomWindows, outline = building.outer.slice(0, 6);
  if (!config || outline.length !== 6) return;
  const evidence = config.facadeLines?.flatMap(line => line.slice(1).map((to, i) => ({ from: line[i], to })));
  if (!evidence || !outline.slice(1).every((to, i) => confirmedFacade(outline[i], to, evidence))) return;
  const area = building.outer.slice(1).reduce((sum, p, i) => sum + building.outer[i][0] * p[1] - p[0] * building.outer[i][1], 0), sign = area >= 0 ? 1 : -1;
  const faces = outline.slice(1).map((b, i) => {
    const a = outline[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const axis: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    return { a, b, length, axis, normal: [-axis[1] * sign, axis[0] * sign] as Point };
  });
  const at = (index: number, depth: number): Point => {
    const p = outline[index], before = faces[Math.max(0, index - 1)].normal, after = faces[Math.min(index, faces.length - 1)].normal;
    const nx = before[0] + after[0], nz = before[1] + after[1], scale = depth / (nx * after[0] + nz * after[1]);
    return [p[0] + nx * scale, p[1] + nz * scale];
  };
  return { faces, at };
}

export function officeCurvedWindows(building: Building, height: number, floorHeight: number, effectiveFloors = building.floors ?? 4): OfficeWindow[] {
  const facade = officeCurvedFacade(building);
  if (!facade) return [];
  const floors = effectiveFloors, result: OfficeWindow[] = [];
  for (let floor = floors - 2; floor < floors; floor++) {
    const depth = floor === floors - 1 ? .14 : .72;
    const bottom = floor * floorHeight + (floor === floors - 1 ? .35 : .95);
    const top = Math.min((floor + 1) * floorHeight - (floor === floors - 1 ? .28 : .72), height - .25);
    if (top <= bottom) continue;
    const outside = facade.faces.map((_, i) => facade.at(i, -.04)); outside.push(facade.at(facade.faces.length, -.04));
    const inside = facade.faces.map((_, i) => facade.at(i, depth + building.classroomWindows!.wallThickness + .04));
    inside.push(facade.at(facade.faces.length, depth + building.classroomWindows!.wallThickness + .04));
    const cut: polygonClipping.Polygon = [[...outside, ...inside.reverse(), outside[0]]];
    for (const [i, face] of facade.faces.entries()) {
      const from = facade.at(i, depth), to = facade.at(i + 1, depth), columns = Math.max(2, Math.round(face.length / 2.25));
      result.push({ from, to, cut, bottom, top, mullions: Array.from({ length: columns + 1 }, (_, column) => column / columns), curvedOffice: true });
    }
  }
  return result;
}

// DSC06615 / DSC8181 show a narrow tall light strip on the same confirmed
// front face as the ordinary windows. Both the body and glass use this layout.
export function officeWindowLayout(building: Building, height: number, floorHeight: number, effectiveFloors = building.floors ?? 4): OfficeWindow[] {
  const config = building.classroomWindows;
  if (!config) return [];
  const curved = officeCurvedWindows(building, height, floorHeight, effectiveFloors);
  const facade = officeCurvedFacade(building);
  const regular = classroomWindowLayout([[building.outer, ...building.holes]], config, height, floorHeight)
    .filter(window => !facade?.faces.some(face => {
      const station = ((window.from[0] - face.a[0]) * face.axis[0] + (window.from[1] - face.a[1]) * face.axis[1]);
      const distance = Math.abs((window.from[0] - face.a[0]) * face.normal[0] + (window.from[1] - face.a[1]) * face.normal[1]);
      return station >= -.01 && station <= face.length + .01 && distance < config.wallThickness + .01;
    }));
  const a = building.outer[13], b = building.outer[14];
  if (!a || !b) return [...regular, ...curved];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1e-5) return [...regular, ...curved];
  const axis: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const area = building.outer.slice(1).reduce((sum, point, i) => sum + building.outer[i][0] * point[1] - point[0] * building.outer[i][1], 0);
  const sign = area >= 0 ? 1 : -1, normal: Point = [-axis[1] * sign, axis[0] * sign];
  const point = (station: number, depth: number): Point => [a[0] + axis[0] * station + normal[0] * depth, a[1] + axis[1] * station + normal[1] * depth];
  const start = length * .48 - .95, end = length * .48 + .95;
  const facadeEdges = config.facadeLines?.flatMap(points => points.slice(1).map((to, i) => ({ from: points[i], to })));
  if (facadeEdges && !confirmedFacade(point(start, 0), point(end, 0), facadeEdges)) return [...regular, ...curved];
  const cut: polygonClipping.Polygon = [[point(start, -.04), point(end, -.04), point(end, config.wallThickness + .04), point(start, config.wallThickness + .04), point(start, -.04)]];
  const windows = regular.filter(window => !polygonClipping.intersection(window.cut, cut).length);
  for (let floor = 0; floor * floorHeight < height; floor++) {
    const bottom = floor * floorHeight + .25, top = Math.min((floor + 1) * floorHeight - .35, height - .25);
    if (top > bottom) windows.push({ from: point(start, config.wallThickness / 2), to: point(end, config.wallThickness / 2), cut, bottom, top, mullions: [0, .5, 1] });
  }
  return [...windows, ...curved];
}

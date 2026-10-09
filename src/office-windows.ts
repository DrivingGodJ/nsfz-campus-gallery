import polygonClipping from 'polygon-clipping';
import { classroomWindowLayout, confirmedFacade, type ClassroomWindow } from './teaching-classrooms.ts';
import type { Building, Point } from './types';

// DSC06615 / DSC8181 show a narrow tall light strip on the same confirmed
// front face as the ordinary windows. Both the body and glass use this layout.
export function officeWindowLayout(building: Building, height: number, floorHeight: number): ClassroomWindow[] {
  const config = building.classroomWindows;
  if (!config) return [];
  const regular = classroomWindowLayout([[building.outer, ...building.holes]], config, height, floorHeight);
  const a = building.outer[13], b = building.outer[14];
  if (!a || !b) return regular;
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1e-5) return regular;
  const axis: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const area = building.outer.slice(1).reduce((sum, point, i) => sum + building.outer[i][0] * point[1] - point[0] * building.outer[i][1], 0);
  const sign = area >= 0 ? 1 : -1, normal: Point = [-axis[1] * sign, axis[0] * sign];
  const point = (station: number, depth: number): Point => [a[0] + axis[0] * station + normal[0] * depth, a[1] + axis[1] * station + normal[1] * depth];
  const start = length * .48 - .95, end = length * .48 + .95;
  const facadeEdges = config.facadeLines?.flatMap(points => points.slice(1).map((to, i) => ({ from: points[i], to })));
  if (facadeEdges && !confirmedFacade(point(start, 0), point(end, 0), facadeEdges)) return regular;
  const cut: polygonClipping.Polygon = [[point(start, -.04), point(end, -.04), point(end, config.wallThickness + .04), point(start, config.wallThickness + .04), point(start, -.04)]];
  const windows = regular.filter(window => !polygonClipping.intersection(window.cut, cut).length);
  for (let floor = 0; floor * floorHeight < height; floor++) {
    const bottom = floor * floorHeight + .25, top = Math.min((floor + 1) * floorHeight - .35, height - .25);
    if (top > bottom) windows.push({ from: point(start, config.wallThickness / 2), to: point(end, config.wallThickness / 2), cut, bottom, top, mullions: [0, .5, 1] });
  }
  return windows;
}

import polygonClipping from 'polygon-clipping';
import { snapFootprint } from './building-geometry.ts';
import { garageRampFootprint } from './garage-ramp-geometry.ts';
import { laboratoryLayout } from './laboratory-geometry.ts';
import type { PassageOpening } from './underground-geometry.ts';
import type { Building, Feature, Point, Shape } from './types';

// The basement follows the occupied classroom band. The existing ramp and its
// retaining walls remain a real notch in both the flat floor and the ceiling.
export function laboratoryGarageLayout(building: Building, entrance?: Feature) {
  const room = laboratoryLayout(building).rooms.at(-1)!;
  const ramp = entrance ? garageRampFootprint(entrance) : building.groundFloorOpenings![0];
  const footprints: Shape[] = polygonClipping.difference(snapFootprint([[room.outer, ...room.holes]]),
    ...snapFootprint([[ramp.outer, ...ramp.holes]]))
    .map(([outer, ...holes]) => ({ outer: outer as Point[], holes: holes as Point[][] }));
  const middle = (a: Point, b: Point): Point => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const [from, to] = entrance?.points || [middle(ramp.outer[0], ramp.outer.at(-2)!), middle(ramp.outer[1], ramp.outer[2])];
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const normal: Point = [-(to[1] - from[1]) / length, (to[0] - from[0]) / length];
  const width = entrance?.width || Math.hypot(ramp.outer[2][0] - ramp.outer[1][0], ramp.outer[2][1] - ramp.outer[1][1]) - .44;
  const rampBottomOpening = [-1, 1].map(side => [to[0] + normal[0] * width / 2 * side,
    to[1] + normal[1] * width / 2 * side] as Point) as PassageOpening;
  rampBottomOpening.height = 2.5;
  return { footprint: footprints[0], footprints, rampBottomOpening };
}

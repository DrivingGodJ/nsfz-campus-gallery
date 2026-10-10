import type { Feature, Shape } from './types';
import { passageFootprint } from './underground-geometry.ts';

export function roadFootprint(feature: Feature): Shape {
  return feature.outer ? { outer: feature.outer, holes: feature.holes || [] }
    : passageFootprint(feature.points!, feature.width || 3);
}

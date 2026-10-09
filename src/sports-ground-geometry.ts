import type { Campus, Feature, Point, Shape } from './types';
import { stadiumRing, trackWorldPoint } from './structure-geometry.ts';
import polygonClipping from 'polygon-clipping';
import { undergroundLayout } from './underground-geometry.ts';
import { snapFootprint } from './building-geometry.ts';

export function sportsGroundPlatform(feature: Feature): Shape {
  if (feature.platform) return feature.platform;
  const track = feature.track!;
  return { outer: stadiumRing(track.halfStraight, track.innerRadius + track.lanes * track.laneWidth)
    .map(point => trackWorldPoint(track, point)), holes: [] };
}

// The raised field is the roof of the sports rooms, not a solid block through them.
export function sportsGroundPlatformLayers(feature: Feature, features: Feature[]) {
  const platform = sportsGroundPlatform(feature), top = feature.height ?? 0;
  const rooms = [...undergroundLayout(features).areas.values()].filter(area =>
    (area.feature.height ?? -3) < top && (area.feature.height ?? -3) + (area.feature.wallHeight || 2.4) > -.06);
  const levels = [...new Set([-.06, top, ...rooms.flatMap(area => {
    const ceiling = (area.feature.height ?? -3) + (area.feature.wallHeight || 2.4);
    return ceiling > -.06 && ceiling < top ? [ceiling] : [];
  })])].sort((a, b) => a - b);
  return levels.slice(1).flatMap((to, index) => {
    const from = levels[index], middle = (from + to) / 2;
    const voids = rooms.filter(area => (area.feature.height ?? -3) < middle
      && (area.feature.height ?? -3) + (area.feature.wallHeight || 2.4) > middle).flatMap(area => area.footprints);
    const polygons = voids.length ? polygonClipping.difference(snapFootprint([[platform.outer, ...platform.holes]]),
      snapFootprint(voids.map(shape => [shape.outer, ...shape.holes]))) : [[platform.outer, ...platform.holes]];
    return polygons.map(([outer, ...holes]) => ({ shape: { outer, holes } as Shape, bottom: from, top: to }));
  });
}

function insideRing([x, z]: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) inside = !inside;
  }
  return inside;
}

// Outdoor photos without a named location still stand on the actual raised ground.
export function groundElevationAt(campus: Campus, point: Point) {
  let height = 0;
  for (const feature of campus.features) {
    const elevation = feature.height ?? 0;
    if (feature.type !== 'runningTrack' || !feature.track || elevation <= height) continue;
    const platform = sportsGroundPlatform(feature);
    if (insideRing(point, platform.outer) && !platform.holes.some(hole => insideRing(point, hole))) height = elevation;
  }
  return height;
}

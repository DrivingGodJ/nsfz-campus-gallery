import type { Campus, Feature, Point, Shape } from './types';
import { stadiumRing, trackWorldPoint } from './structure-geometry.ts';

export function sportsGroundPlatform(feature: Feature): Shape {
  if (feature.platform) return feature.platform;
  const track = feature.track!;
  return { outer: stadiumRing(track.halfStraight, track.innerRadius + track.lanes * track.laneWidth)
    .map(point => trackWorldPoint(track, point)), holes: [] };
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

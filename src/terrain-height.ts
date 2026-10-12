import type { Feature, Point, Shape } from './types';

function insideRing([x, z]: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    const dx = bx - ax, dz = bz - az;
    if (Math.abs((x - ax) * dz - (z - az) * dx) < 1e-7
      && x >= Math.min(ax, bx) - 1e-7 && x <= Math.max(ax, bx) + 1e-7
      && z >= Math.min(az, bz) - 1e-7 && z <= Math.max(az, bz) + 1e-7) return true;
    if ((az > z) !== (bz > z) && x < dx * (z - az) / dz + ax) inside = !inside;
  }
  return inside;
}

export const insideShape = (point: Point, shape: Shape) => insideRing(point, shape.outer)
  && !shape.holes.some(hole => insideRing(point, hole));

export function stairSurfaceHeight(feature: Feature, point: Point): number | undefined {
  const stair = feature.riseStair;
  if (!stair || stair.steps < 1) return;
  const dx = stair.to[0] - stair.from[0], dz = stair.to[1] - stair.from[1], length = Math.hypot(dx, dz);
  if (!length) return;
  const x = point[0] - stair.from[0], z = point[1] - stair.from[1];
  const t = (x * dx + z * dz) / (length * length), across = Math.abs(x * dz - z * dx) / length;
  if (t < -1e-7 || t > 1 + 1e-7 || across > stair.width / 2 + 1e-7) return;
  const tread = Math.min(stair.steps, Math.max(0, Math.ceil(t * stair.steps - 1e-7)));
  return stair.topHeight + (stair.bottomHeight - stair.topHeight) * tread / stair.steps;
}

// Ramp heights follow distance travelled around bends, rather than the end-to-end chord.
export function rampSurfaceHeight(feature: Feature, point: Point): number | undefined {
  if (!feature.ramp || !feature.points || !feature.width) return;
  let length = 0, station = 0, nearest = Infinity;
  for (let i = 1; i < feature.points.length; i++) {
    const from = feature.points[i - 1], to = feature.points[i];
    const dx = to[0] - from[0], dz = to[1] - from[1], span = Math.hypot(dx, dz);
    if (!span) continue;
    const t = Math.min(1, Math.max(0, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / (span * span)));
    const distance = Math.hypot(point[0] - from[0] - t * dx, point[1] - from[1] - t * dz);
    if (distance < nearest) { nearest = distance; station = length + t * span; }
    length += span;
  }
  if (!length || nearest > feature.width / 2 + 1e-7) return;
  return feature.ramp.topHeight + (feature.ramp.bottomHeight - feature.ramp.topHeight) * station / length;
}

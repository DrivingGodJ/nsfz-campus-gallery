import type { Building, BuildingOverride, CurvedStair, Feature, Point, RunningTrack, Shape } from './types';

export function curvedStairPoint(stair: CurvedStair, progress: number, radius = stair.radius): [number, number, number] {
  const angle = stair.startAngle + stair.sweep * progress;
  return [stair.center[0] + Math.cos(angle) * radius,
    stair.topHeight + (stair.bottomHeight - stair.topHeight) * progress,
    stair.center[1] + Math.sin(angle) * radius];
}

export function curvedStairTreads(stair: CurvedStair) {
  return Array.from({ length: stair.steps }, (_, i) => {
    const ring: Point[] = [];
    for (const side of [-1, 1]) for (let n = 0; n <= 4; n++) {
      const progress = (i + (side === -1 ? n / 4 : 1 - n / 4)) / stair.steps;
      const p = curvedStairPoint(stair, progress, stair.radius + side * stair.width / 2);
      ring.push([p[0], p[2]]);
    }
    ring.push(ring[0]);
    return { ring, height: curvedStairPoint(stair, (i + 1) / stair.steps)[1] };
  });
}

export function pointOnStairTread(point: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j], [bx, bz] = ring[i];
    const dx = bx - ax, dz = bz - az, lengthSquared = dx * dx + dz * dz;
    if (lengthSquared > 0) {
      const t = Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - az) * dz) / lengthSquared));
      if (Math.hypot(point[0] - ax - t * dx, point[1] - az - t * dz) < 1e-7) return true;
    }
    if ((az > point[1]) !== (bz > point[1]) && point[0] < ax + (point[1] - az) * dx / dz) inside = !inside;
  }
  return inside;
}

// Use the modeled flat tread, rather than a continuous ramp or the entry's top level.
export function curvedStairSurfaceHeight(stair: CurvedStair, point: Point) {
  return curvedStairTreads(stair).find(tread => pointOnStairTread(point, tread.ring))?.height ?? stair.topHeight;
}

export function bridgeHeight(feature: Feature, buildings: Building[], overrides: Record<string, BuildingOverride>) {
  const anchor = feature.levelAnchor;
  const building = anchor && buildings.find(b => b.id === anchor.buildingId);
  if (anchor && building) {
    return (building.baseElevation ?? 0) + .12 + (anchor.floor - 1) * (overrides[anchor.buildingId]?.floorHeight ?? 3.6);
  }
  return feature.deckHeight ?? (.12 + (feature.height ?? 3.6));
}

export function bridgeSurfaceHeight(feature: Feature, height: number, point: Point) {
  if (!feature.archRise || feature.points?.length !== 2) return height;
  const [from, to] = feature.points, dx = to[0] - from[0], dz = to[1] - from[1];
  const t = Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / (dx * dx + dz * dz)));
  return height + feature.archRise * 4 * t * (1 - t);
}

export function straightStairTreads(from: Point, to: Point, top: number, bottom: number) {
  const steps = Math.max(1, Math.ceil(Math.abs(top - bottom) / .18 - 1e-7));
  const point = (t: number): Point => t === 0 ? [...from] : t === 1 ? [...to] : [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
  return Array.from({ length: steps }, (_, i) => ({ from: point(i / steps), to: point((i + 1) / steps), height: top + (bottom - top) * (i + 1) / steps }));
}

// Local X is across the lanes; local Z follows the long axis of the field.
export function stadiumRing(halfStraight: number, radius: number, segments = 64): Point[] {
  const ring: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = Math.PI * i / segments;
    ring.push([radius * Math.cos(angle), halfStraight + radius * Math.sin(angle)]);
  }
  for (let i = 0; i <= segments; i++) {
    const angle = Math.PI + Math.PI * i / segments;
    ring.push([radius * Math.cos(angle), -halfStraight + radius * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

// These surfaces partition the oval instead of stacking competing color planes.
export function stadiumSurfaces(track: RunningTrack) {
  const outer = stadiumRing(track.halfStraight, track.innerRadius + track.lanes * track.laneWidth);
  const inner = stadiumRing(track.halfStraight, track.innerRadius);
  const halfWidth = track.pitchWidth / 2, halfLength = track.pitchLength / 2;
  const rectangle = (from: number, to: number): Point[] => [[-halfWidth, from], [halfWidth, from], [halfWidth, to], [-halfWidth, to], [-halfWidth, from]];
  const stripes: Shape[] = Array.from({ length: 10 }, (_, i) => ({
    outer: rectangle(-halfLength + track.pitchLength * i / 10, -halfLength + track.pitchLength * (i + 1) / 10), holes: []
  }));
  return { track: { outer, holes: [inner] } as Shape,
    grass: { outer: inner, holes: [rectangle(-halfLength, halfLength)] } as Shape, stripes };
}

export function trackWorldPoint(track: RunningTrack, [across, along]: Point): Point {
  return [track.center[0] + track.axis[1] * across + track.axis[0] * along,
    track.center[1] - track.axis[0] * across + track.axis[1] * along];
}

import polygonClipping from 'polygon-clipping';
import { stairSurfaceHeight } from './terrain-height.ts';
import type { Feature, Point, Shape } from './types';

// Offset both sides of a route so adjacent segments share one mitered corner.
export function passageFootprint(points: Point[], width: number): Shape {
  const route: Point[] = [];
  for (const point of points) {
    const previous = route.at(-1);
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 1e-8) continue;
    while (route.length >= 2) {
      const from = route.at(-2)!, middle = route.at(-1)!;
      const dx = middle[0] - from[0], dz = middle[1] - from[1], nx = point[0] - middle[0], nz = point[1] - middle[1];
      if (Math.abs(dx * nz - dz * nx) > 1e-8 * Math.hypot(dx, dz) * Math.hypot(nx, nz) || dx * nx + dz * nz <= 0) break;
      route.pop();
    }
    route.push(point);
  }
  if (route.length < 2 || width <= 0) throw new Error('A passage needs a route and positive width');
  const normals = route.slice(1).map((to, i): Point => {
    const dx = to[0] - route[i][0], dz = to[1] - route[i][1], length = Math.hypot(dx, dz);
    return [dz / length, -dx / length];
  });
  const side = (offset: number) => route.map((point, i): Point => {
    const before = normals[Math.max(0, i - 1)], after = normals[Math.min(i, normals.length - 1)];
    const sum: Point = [before[0] + after[0], before[1] + after[1]];
    const denominator = sum[0] * after[0] + sum[1] * after[1];
    if (denominator < 1e-8) throw new Error('A passage cannot reverse at a corner');
    return [point[0] + offset * sum[0] / denominator, point[1] + offset * sum[1] / denominator];
  });
  const outer = [...side(width / 2), ...side(-width / 2).reverse()];
  outer.push(outer[0]);
  return { outer, holes: [] };
}

export function undergroundFootprints(feature: Feature, connections: Feature[] = [], aligned: ReadonlyMap<string, Shape> = new Map()): Shape[] {
  const footprints = [feature, ...connections].flatMap(item => aligned.has(item.id) ? [aligned.get(item.id)!] : item.outer
    ? [{ outer: item.outer, holes: item.holes || [] }]
    : [item.points!, ...(item.branches || [])].map(points => passageFootprint(points, item.width || 4)));
  const [first, ...rest] = footprints.map(shape => [shape.outer, ...shape.holes]);
  return polygonClipping.union(first, ...rest).map(([outer, ...holes]) => ({ outer, holes }));
}

export function undergroundConnections(features: Feature[], area: Feature) {
  return features.filter(feature => feature.type === 'tunnelJunction' && feature.connectedTo?.includes(area.id)
    && (feature.height ?? -3) === (area.height ?? -3));
}

export type PassageOpening = [Point, Point] & { height?: number; bottom?: number };
export type UndergroundAreaLayout = { feature: Feature; connections: Feature[]; footprints: Shape[]; openings: PassageOpening[] };

// An entrance belongs to its existing passage: the same footprint locates the
// facade opening, descending treads and guards without adding a map location.
export function undergroundEntranceStair(feature: Feature, stair = feature.entranceStair) {
  if (!stair) return null;
  const length = Math.hypot(stair.to[0] - stair.from[0], stair.to[1] - stair.from[1]);
  const axis: Point = [(stair.to[0] - stair.from[0]) / length, (stair.to[1] - stair.from[1]) / length];
  const at = (distance: number, side = 0): Point => [stair.from[0] + axis[0] * distance - axis[1] * side,
    stair.from[1] + axis[1] * distance + axis[0] * side];
  const opening = [at(0, -stair.width / 2), at(0, stair.width / 2)] as PassageOpening;
  opening.bottom = stair.topHeight - (feature.height ?? -3);
  opening.height = opening.bottom + stair.doorHeight;
  const treads = Array.from({ length: stair.steps }, (_, i) => ({
    from: at(length * i / stair.steps), to: at(length * (i + 1) / stair.steps),
    height: stair.topHeight + (stair.bottomHeight - stair.topHeight) * (i + 1) / stair.steps,
  }));
  return { ...stair, at, length, opening, treads, footprint: passageFootprint([stair.from, stair.to], stair.width) };
}

export function undergroundEntranceStairs(feature: Feature) {
  return [feature.entranceStair, ...(feature.entranceStairs || [])].filter(stair => stair !== undefined)
    .map(stair => undergroundEntranceStair(feature, stair)!);
}

// The exit flight rises inside the straight tunnel, then meets the unchanged
// turning landing. Heights are logical floors; the rendered finish adds .045 m.
export function undergroundRiseStair(feature: Feature) {
  const stair = feature.riseStair;
  if (!stair) return null;
  const length = Math.hypot(stair.to[0] - stair.from[0], stair.to[1] - stair.from[1]);
  const axis: Point = [(stair.to[0] - stair.from[0]) / length, (stair.to[1] - stair.from[1]) / length];
  const at = (distance: number, side = 0): Point => [stair.from[0] + axis[0] * distance - axis[1] * side,
    stair.from[1] + axis[1] * distance + axis[0] * side];
  const treads = Array.from({ length: stair.steps }, (_, i) => ({
    from: at(length * i / stair.steps), to: at(length * (i + 1) / stair.steps),
    height: stair.bottomHeight + (stair.topHeight - stair.bottomHeight) * (i + 1) / stair.steps,
  }));
  return { ...stair, at, length, treads, footprint: passageFootprint([stair.from, stair.to], stair.width) };
}

export function undergroundFloorElevation(feature: Feature, point: Point) {
  for (const stair of feature.entranceStairs || []) {
    const height = stairSurfaceHeight({ ...feature, riseStair: stair }, point);
    if (height !== undefined) return height - .045;
  }
  const floor = feature.height ?? -3, stair = feature.riseStair;
  if (!stair) return floor;
  const dx = stair.to[0] - stair.from[0], dz = stair.to[1] - stair.from[1], length = Math.hypot(dx, dz);
  const distance = ((point[0] - stair.from[0]) * dx + (point[1] - stair.from[1]) * dz) / length;
  const across = Math.abs((point[0] - stair.from[0]) * dz - (point[1] - stair.from[1]) * dx) / length;
  // Include wall thickness and miter rounding, but not an unrelated side route.
  if (distance < -1e-7 || across > Math.max(stair.width, feature.width || 4) / 2 + .12) return floor;
  const tread = Math.min(stair.steps, Math.floor(Math.max(0, distance) / length * stair.steps + 1e-7) + 1);
  return stair.bottomHeight + (stair.topHeight - stair.bottomHeight) * tread / stair.steps;
}

export function undergroundSkylights(feature: Feature) {
  if (feature.type !== 'undergroundCorridor' || !feature.points) return [];
  const width = feature.width || 4;
  return [feature.points, ...(feature.branches || [])].map(([from, to]) => {
    const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
    const at = (distance: number): Point => [from[0] + dx / length * distance - dz / length * width / 4,
      from[1] + dz / length * distance + dx / length * width / 4];
    return passageFootprint([at(.1), at(length - .1)], width / 2 - .25);
  });
}

// Both colored routes share the intersections of their offset edges, rather
// than closing two perpendicular rectangles at the same centerline point.
export function joinedPassages(incoming: Feature, outgoing: Feature) {
  const before = incoming.points!, after = outgoing.points!, joint = before.at(-1)!;
  if (Math.hypot(joint[0] - after[0][0], joint[1] - after[0][1]) > 1e-7) return null;
  const firstFloor = undergroundFloorElevation(incoming, joint), secondFloor = undergroundFloorElevation(outgoing, after[0]);
  if (Math.abs(firstFloor - secondFloor) > 1e-7) return null;
  const unit = (from: Point, to: Point): Point => {
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    return [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  };
  const from = unit(before.at(-2)!, joint), to = unit(after[0], after[1]);
  const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
  const denominator = cross(from, to);
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-7) return null;
  const normalFrom: Point = [from[1], -from[0]], normalTo: Point = [to[1], -to[0]];
  const seam = [-1, 1].map(sign => {
    const a: Point = [joint[0] + normalFrom[0] * (incoming.width || 4) / 2 * sign, joint[1] + normalFrom[1] * (incoming.width || 4) / 2 * sign];
    const b: Point = [joint[0] + normalTo[0] * (outgoing.width || 4) / 2 * sign, joint[1] + normalTo[1] * (outgoing.width || 4) / 2 * sign];
    const t = cross([b[0] - a[0], b[1] - a[1]], to) / denominator;
    return [a[0] + from[0] * t, a[1] + from[1] * t] as Point;
  }) as PassageOpening;
  const firstHeight = incoming.wallHeight || 2.4, secondHeight = outgoing.wallHeight || 2.4;
  if (firstHeight !== secondHeight) seam.height = Math.min(firstHeight, secondHeight);
  let outgoingOpening = seam;
  const incomingBase = incoming.height ?? -3, outgoingBase = outgoing.height ?? -3;
  if (Math.abs(incomingBase - outgoingBase) > 1e-7) {
    const incomingRoof = incomingBase + (incoming.ceilingSegments?.find(segment => segment.edge === before.length - 2)?.height ?? firstHeight);
    const outgoingRoof = outgoingBase + (outgoing.ceilingSegments?.find(segment => segment.edge === 0)?.height ?? secondHeight);
    const roof = Math.min(incomingRoof, outgoingRoof) - .12;
    seam.bottom = firstFloor - incomingBase; seam.height = roof - incomingBase;
    outgoingOpening = seam.map(point => [...point] as Point) as PassageOpening;
    outgoingOpening.bottom = secondFloor - outgoingBase; outgoingOpening.height = roof - outgoingBase;
  }
  const incomingShape = passageFootprint(before, incoming.width || 4), outgoingShape = passageFootprint(after, outgoing.width || 4);
  const middle = (incomingShape.outer.length - 1) / 2;
  incomingShape.outer[middle - 1] = seam[1]; incomingShape.outer[middle] = seam[0];
  outgoingShape.outer[0] = seam[1]; outgoingShape.outer[outgoingShape.outer.length - 2] = seam[0];
  outgoingShape.outer[outgoingShape.outer.length - 1] = seam[1];
  return { incoming: incomingShape, outgoing: outgoingShape, seam, incomingOpening: seam, outgoingOpening };
}

// A lower final leg shares the original mitered turn with the high corridor.
// Its door-height ceiling changes the shell, never the circulation footprint.
export function undergroundCeilingSections(feature: Feature, footprints = undergroundFootprints(feature), openings: PassageOpening[] = [], connections: Feature[] = []) {
  let sections = [{ height: feature.wallHeight || 2.4, footprints, openings }];
  // Joining a return passage keeps its floor continuous, but must not raise
  // its buried roof to the high corridor's above-ground podium.
  const returnHeight = Math.min(sections[0].height, ...connections.map(item => item.wallHeight || 2.4));
  if (feature.outer && returnHeight < sections[0].height) {
    const polygons = footprints.map(shape => [shape.outer, ...shape.holes]);
    const high = polygonClipping.intersection(polygons, [feature.outer, ...(feature.holes || [])]);
    const low = polygonClipping.difference(polygons, [feature.outer, ...(feature.holes || [])]);
    const seams: PassageOpening[] = low.flatMap(([ring]) => ring.slice(1).flatMap((to, i) => {
      const from = ring[i];
      const shared = feature.outer!.slice(1).some((b, j) => {
        const a = feature.outer![j], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
        const off = (p: Point) => Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / length;
        const at = (p: Point) => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / length;
        return length > 1e-7 && [from, to].every(p => off(p) < 1e-5 && at(p) >= -1e-5 && at(p) <= length + 1e-5);
      });
      if (!shared) return [];
      const seam = [from, to] as PassageOpening;
      seam.height = returnHeight - .12;
      return [seam];
    }));
    const shapes = (value: polygonClipping.MultiPolygon): Shape[] => value.map(([outer, ...holes]) => ({ outer, holes }));
    const cuts = [...openings, ...seams];
    sections = [...(high.length ? [{ height: sections[0].height, footprints: shapes(high), openings: cuts }] : []),
      ...(low.length ? [{ height: returnHeight, footprints: shapes(low), openings: cuts }] : [])];
  }
  for (const segment of feature.ceilingSegments || []) {
    const points = feature.points, edge = segment.edge;
    if (!points || edge < 0 || edge >= points.length - 1 || segment.height <= 0) continue;
    const leg = points.slice(edge, edge + 2);
    // The drawn final centerline stops half a width before the hall wall;
    // intersect an extended end cap so the lower roof reaches that real door.
    if (edge === points.length - 2) {
      const [a, b] = leg, length = Math.hypot(b[0] - a[0], b[1] - a[1]), extend = feature.width || 4;
      leg[1] = [b[0] + (b[0] - a[0]) / length * extend, b[1] + (b[1] - a[1]) / length * extend];
    }
    let zone = passageFootprint(leg, feature.width || 4), seam: PassageOpening | undefined;
    if (edge > 0) {
      const joined = joinedPassages({ ...feature, points: points.slice(edge - 1, edge + 1) },
        { ...feature, points: leg, wallHeight: segment.height });
      if (joined) { zone = joined.outgoing; seam = joined.seam; }
      else {
        const previous = points[edge - 1], from = leg[0], to = leg[1];
        const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
        const beforeX = from[0] - previous[0], beforeZ = from[1] - previous[1];
        if (Math.abs(beforeX * dz - beforeZ * dx) < 1e-7 * Math.hypot(beforeX, beforeZ) * length && beforeX * dx + beforeZ * dz > 0) {
          const half = (feature.width || 4) / 2;
          seam = [-1, 1].map(side => [from[0] + dz / length * half * side,
            from[1] - dx / length * half * side]) as PassageOpening;
        }
      }
    }
    sections = sections.flatMap(section => {
      const polygons = section.footprints.map(shape => [shape.outer, ...shape.holes]);
      const shapes = (value: polygonClipping.MultiPolygon): Shape[] => value.map(([outer, ...holes]) => ({ outer, holes }));
      const low = shapes(polygonClipping.intersection(polygons, [zone.outer])), high = shapes(polygonClipping.difference(polygons, [zone.outer]));
      if (seam) seam.height = Math.min(section.height, segment.height) - .12;
      const cuts = seam ? [...section.openings, seam] : section.openings;
      return [...(high.length ? [{ ...section, footprints: high, openings: cuts }] : []),
        ...(low.length ? [{ height: segment.height, footprints: low, openings: cuts }] : [])];
    });
  }
  // A stair above a room replaces only the local roof, leaving the room floor
  // and the rest of its tall enclosure intact. Shared edges stay open below
  // the lower roof rather than becoming new floor-to-ceiling partitions.
  for (const cutout of feature.ceilingCutouts || []) {
    if (!Number.isFinite(cutout.height) || cutout.height <= 0) continue;
    sections = sections.flatMap(section => {
      if (cutout.height >= section.height) return [section];
      const polygons = section.footprints.map(shape => [shape.outer, ...shape.holes]);
      const zone = [cutout.footprint.outer, ...cutout.footprint.holes];
      const shapes = (value: polygonClipping.MultiPolygon): Shape[] => value.map(([outer, ...holes]) => ({ outer, holes }));
      const low = shapes(polygonClipping.intersection(polygons, zone)), high = shapes(polygonClipping.difference(polygons, zone));
      if (!low.length) return [section];
      const seams: PassageOpening[] = low.flatMap(shape => [shape.outer, ...shape.holes].flatMap(ring => ring.slice(1).flatMap((to, i) => {
        const from = ring[i], dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
        if (length < 1e-7) return [];
        const at = (p: Point) => ((p[0] - from[0]) * dx + (p[1] - from[1]) * dz) / length;
        const across = (p: Point) => Math.abs((p[0] - from[0]) * dz - (p[1] - from[1]) * dx) / length;
        return high.flatMap(shape => [shape.outer, ...shape.holes].flatMap(ring => ring.slice(1).flatMap((b, j) => {
          const a = ring[j];
          if (across(a) > 1e-5 || across(b) > 1e-5) return [];
          const start = Math.max(0, Math.min(at(a), at(b))), end = Math.min(length, Math.max(at(a), at(b)));
          if (end - start < 1e-7) return [];
          const seam = [start, end].map(t => [from[0] + dx / length * t, from[1] + dz / length * t]) as PassageOpening;
          seam.height = cutout.height - .12;
          return [seam];
        })));
      })));
      const cuts = [...section.openings, ...seams];
      return [...(high.length ? [{ ...section, footprints: high, openings: cuts }] : []),
        { height: cutout.height, footprints: low, openings: cuts }];
    });
  }
  return sections;
}

export function undergroundLayout(features: Feature[]) {
  const aligned = new Map<string, Shape>(), openings = new Map<string, PassageOpening[]>();
  for (const exit of features.filter(f => f.type === 'tunnelJunction' && f.points && f.points.length >= 2)) {
    const tunnel = features.find(f => f.type === 'tunnel' && f.points && f.points.length >= 2 && exit.connectedTo?.includes(f.id)
      && Math.abs(undergroundFloorElevation(f, f.points.at(-1)!) - undergroundFloorElevation(exit, exit.points![0])) < 1e-7);
    if (!tunnel) continue;
    const join = joinedPassages(tunnel, exit);
    if (!join) continue;
    aligned.set(tunnel.id, join.incoming); aligned.set(exit.id, join.outgoing);
    openings.set(tunnel.id, [join.incomingOpening]); openings.set(exit.id, [join.outgoingOpening]);
  }
  const underground = features.filter(f => ['tunnel', 'tunnelJunction', 'undergroundCorridor', 'undergroundRoom', 'undergroundTrack'].includes(f.type)
    && (f.outer || f.points && f.points.length >= 2));
  const connections = new Map(underground.filter(f => f.type === 'undergroundCorridor' && f.outer)
    .map(area => [area.id, undergroundConnections(features, area)]));
  const merged = new Set([...connections.values()].flatMap(items => items.map(item => item.id)));
  const areas = new Map<string, UndergroundAreaLayout>(), locations = new Map<string, Shape[]>();
  for (const feature of underground) {
    locations.set(feature.id, undergroundFootprints(feature, [], aligned));
    if (merged.has(feature.id)) continue;
    const joined = connections.get(feature.id) || [];
    const stairs = undergroundEntranceStairs(feature);
    areas.set(feature.id, { feature, connections: joined, footprints: undergroundFootprints(feature, joined, aligned),
      openings: [...[feature, ...joined].flatMap(item => openings.get(item.id) || []),
        ...stairs.map(stair => stair.opening)] });
  }
  // A garage's driveway notch ends at the basement floor. Retain its narrow
  // sidewalls but open the end cap so the slope actually reaches the room.
  for (const area of areas.values()) if (area.feature.roomUse === 'garage') {
    const entrance=features.find(feature=>feature.type==='garageEntrance'&&area.feature.connectedTo?.includes(feature.id));
    if (!entrance?.ramp || !entrance.points || Math.abs(entrance.ramp.bottomHeight-(area.feature.height??-3))>1e-6) continue;
    const [from,to]=entrance.points,dx=to[0]-from[0],dz=to[1]-from[1],length=Math.hypot(dx,dz),width=entrance.width??4.5;
    const opening=[-1,1].map(side=>[to[0]-dz/length*width/2*side,to[1]+dx/length*width/2*side]) as PassageOpening;
    opening.height=Math.min(2.5,area.feature.wallHeight??2.7);
    area.openings.push(opening);
  }
  for (const area of areas.values()) if (area.feature.type === 'undergroundTrack') {
    const neighbors = [...areas.values()].filter(other => area.feature.connectedTo?.includes(other.feature.id)
      && (area.feature.height ?? -3) === (other.feature.height ?? -3));
    if (neighbors.length) area.footprints = polygonClipping.difference(area.footprints.map(shape => [shape.outer, ...shape.holes]),
      ...neighbors.map(other => other.footprints.map(shape => [shape.outer, ...shape.holes])))
      .map(([outer, ...holes]) => ({ outer, holes }));
  }
  // The sports hall and practice strip meet the side passages at their ends.
  // A shared floor must have real door openings, while the taller hall retains
  // its wall above each door rather than losing an entire high boundary.
  const list = [...areas.values()];
  // The curved entrance meets the tunnel at its lower landing. Its real stair
  // opening must also cut the tunnel end cap; an overlay-only stair previously
  // concealed this closed wall when viewed from the photographed bottom step.
  for (const entrance of features.filter(feature => feature.type === 'tunnelEntrance' && feature.curvedStair)) {
    const stair=entrance.curvedStair!,angle=stair.startAngle+stair.sweep;
    const landing:Point=[stair.center[0]+Math.cos(angle)*stair.radius,stair.center[1]+Math.sin(angle)*stair.radius];
    for(const area of list.filter(area=>entrance.connectedTo?.includes(area.feature.id)))for(const footprint of area.footprints) {
      for(let i=1;i<footprint.outer.length;i++) {
        const from=footprint.outer[i-1],to=footprint.outer[i],dx=to[0]-from[0],dz=to[1]-from[1],length=Math.hypot(dx,dz);
        const along=((landing[0]-from[0])*dx+(landing[1]-from[1])*dz)/length,across=Math.abs((landing[0]-from[0])*dz-(landing[1]-from[1])*dx)/length;
        if(across>.02 || along<-.02 || along>length+.02)continue;
        const width=Math.min(stair.width,length-.1),start=Math.max(.05,along-width/2),end=Math.min(length-.05,along+width/2);
        area.openings.push([start,end].map(t=>[from[0]+dx/length*t,from[1]+dz/length*t]) as PassageOpening);
      }
    }
  }
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const a = list[i], b = list[j];
    if (!(a.feature.connectedTo?.includes(b.feature.id) || b.feature.connectedTo?.includes(a.feature.id))
      || (a.feature.height ?? -3) !== (b.feature.height ?? -3)
      || ![a.feature.type, b.feature.type].some(type => ['undergroundRoom', 'undergroundTrack'].includes(type))) continue;
    for (const first of a.footprints) for (const second of b.footprints) {
      for (let edge = 1; edge < first.outer.length; edge++) {
        const from = first.outer[edge - 1], to = first.outer[edge], dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
        if (length < 1e-7) continue;
        const at = (p: Point) => ((p[0] - from[0]) * dx + (p[1] - from[1]) * dz) / length;
        const off = (p: Point) => Math.abs((p[0] - from[0]) * dz - (p[1] - from[1]) * dx) / length;
        for (let other = 1; other < second.outer.length; other++) {
          const p = second.outer[other - 1], q = second.outer[other];
          if (off(p) > 1e-6 || off(q) > 1e-6) continue;
          const start = Math.max(0, Math.min(at(p), at(q))), end = Math.min(length, Math.max(at(p), at(q)));
          if (end - start < 1) continue;
          const width = Math.min(4, end - start - .2), center = (start + end) / 2;
          const opening = [center - width / 2, center + width / 2].map(distance => [from[0] + dx / length * distance, from[1] + dz / length * distance]) as PassageOpening;
          opening.height = Math.min(2.7, a.feature.wallHeight || 2.4, b.feature.wallHeight || 2.4);
          a.openings.push(opening); b.openings.push(opening);
        }
      }
    }
  }
  return { areas, locations };
}

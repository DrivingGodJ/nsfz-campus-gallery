import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { passageFootprint, undergroundFootprints, undergroundEntranceStairs, undergroundRiseStair, undergroundFloorElevation, undergroundSkylights, undergroundCeilingSections, type PassageOpening } from './underground-geometry.ts';
import { undergroundWallPanels } from './underground-mesh.ts';
import { undergroundRailGeometry } from './underground-rail-geometry.ts';
import { pointOnStairTread } from './structure-geometry.ts';
import { confirmedFacade } from './teaching-classrooms.ts';
import { insideShape } from './terrain-height.ts';
import type { Feature, Point, Shape } from './types';

type Kind = 'floor' | 'walls' | 'podium' | 'tiles' | 'metal' | 'rails' | 'lights' | 'pipes' | 'glass' | 'skylights' | 'green' | 'wood' | 'paint' | 'nets' | 'ceiling' | 'fittings';
type Vector = [number, number, number];
export const UNDERGROUND_COLORS: Record<Kind, string> = { floor: '#7a9799', walls: '#b6beb8', podium: '#bdc9ac', tiles: '#546566', metal: '#777d78', rails: '#a8adae', lights: '#f4eccc', pipes: '#a45342', glass: '#abc9cb', skylights: '#abc9cb', green: '#278778', wood: '#c89e66', paint: '#ede8d2', nets: '#a3afa2', ceiling: '#525d5b', fittings: '#56819a' };

export function undergroundRoomFrame(feature: Feature) {
  const ring = feature.outer!, origin = ring[0], short = ring[1], long = ring.at(-2)!;
  const width = Math.hypot(short[0] - origin[0], short[1] - origin[1]), length = Math.hypot(long[0] - origin[0], long[1] - origin[1]);
  const across: Point = [(short[0] - origin[0]) / width, (short[1] - origin[1]) / width], along: Point = [(long[0] - origin[0]) / length, (long[1] - origin[1]) / length];
  const at = (u: number, v: number): Point => [origin[0] + across[0] * u + along[0] * v, origin[1] + across[1] * u + along[1] * v];
  return { at, across, along, width, length };
}

export function undergroundBadmintonLayout({ width, length }: ReturnType<typeof undergroundRoomFrame>) {
  // The photographed courts run across the hall in two rows. Keep the end
  // timber bay clear and a central aisle between the full 13.4 m courts.
  const rows = Math.max(1, Math.floor(width / 15.4)), cols = Math.max(1, Math.floor((length - 15) / 7.2));
  const margin = (width - rows * 15.4) / 2;
  const centers: Point[] = Array.from({ length: rows * cols }, (_, i) => [margin + Math.floor(i / cols) * 15.4 + 7.7, 2 + i % cols * 7.2 + 3.6]);
  return { rows, cols, centers };
}

// Structure and recognizable fittings are retained; exact unseen court counts
// and service routing are estimates, documented alongside the 13 source views.
export function undergroundDetailGeometry(feature: Feature, footprints = undergroundFootprints(feature), openings: PassageOpening[] = [], connections: Feature[] = []) {
  const parts = Object.fromEntries(Object.keys(UNDERGROUND_COLORS).map(kind => [kind, [] as THREE.BufferGeometry[]])) as Record<Kind, THREE.BufferGeometry[]>;
  const floor = feature.height ?? -3, clear = feature.wallHeight || 2.4, top = floor + clear;
  const hallWindowEdges = feature.id === 'local/underground-badminton' && feature.outer
    ? feature.outer.slice(1).map((to, i) => ({ from: feature.outer![i], to })) : null;
  const sections = undergroundCeilingSections(feature, footprints, openings, connections);
  const stairs = undergroundEntranceStairs(feature);
  const ceilingOpenings = feature.ceilingOpenings || [];
  const openRoofAt = (point: Point) => ceilingOpenings.some(shape => insideShape(point, shape));
  const rise = undergroundRiseStair(feature);
  const floorAt = (p: Point) => undergroundFloorElevation(feature, p);
  const walkingSegments = (from: Point, to: Point) => {
    const cuts = [0, 1];
    if (rise) {
      const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
      for (let i = 0; i <= rise.steps; i++) {
        const p = rise.at(rise.length * i / rise.steps);
        const t = ((p[0] - from[0]) * dx + (p[1] - from[1]) * dz) / (length * length);
        if (t > 0 && t < 1) cuts.push(t);
      }
    }
    const ordered = [...new Set(cuts)].sort((a,b) => a-b), at = (t: number): Point => [from[0] + (to[0]-from[0])*t, from[1] + (to[1]-from[1])*t];
    return ordered.slice(1).map((end,i) => ({from:at(ordered[i]),to:at(end),height:floorAt(at((ordered[i]+end)/2))}));
  };
  const sectionAt = (p: Point) => sections.find(section => section.footprints.some(shape => pointOnStairTread(p, shape.outer)
    && !shape.holes.some(hole => pointOnStairTread(p, hole))));
  const heightAt = (p: Point) => sectionAt(p)?.height ?? clear;
  const roofSegments = (from: Point, to: Point) => {
    const dx = to[0] - from[0], dz = to[1] - from[1], cuts = [0, 1];
    for (const shape of [...sections.flatMap(section => section.footprints), ...ceilingOpenings]) for (const ring of [shape.outer, ...shape.holes]) for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i], ex = b[0] - a[0], ez = b[1] - a[1], cross = dx * ez - dz * ex;
      if (Math.abs(cross) < 1e-8) continue;
      const x = a[0] - from[0], z = a[1] - from[1], t = (x * ez - z * ex) / cross, u = (x * dz - z * dx) / cross;
      if (t > 1e-7 && t < 1 - 1e-7 && u >= -1e-7 && u <= 1 + 1e-7) cuts.push(t);
    }
    const ordered = [...new Set(cuts.map(t => Math.round(t * 1e9) / 1e9))].sort((a, b) => a - b);
    const at = (t: number): Point => [from[0] + dx * t, from[1] + dz * t];
    // A straight fitting can cross the diagonal end of a mitered passage.
    // Keep only the pieces under this passage's actual roof, never a fallback
    // low beam or pipe hanging in the adjoining raised landing.
    return ordered.slice(1).flatMap((end, i) => {
      const middle = at((ordered[i] + end) / 2), section = sectionAt(middle);
      return section && !openRoofAt(middle) ? [{ from: at(ordered[i]), to: at(end), height: section.height }] : [];
    });
  };
  const point = ([x, z]: Point, height: number): Vector => [x, height, z];
  const box = (p: Point, bottom: number, height: number, length: number, width: number, angle: number, kind: Kind) => {
    if (height <= 0 || length <= 0 || width <= 0) return;
    parts[kind].push(new THREE.BoxGeometry(length, height, width).rotateY(angle).translate(p[0], bottom + height / 2, p[1]));
  };
  const segment = (from: Point, to: Point, bottom: number, height: number, width: number, kind: Kind) => {
    const dx = to[0] - from[0], dz = to[1] - from[1];
    box([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], bottom, height, Math.hypot(dx, dz), width, -Math.atan2(dz, dx), kind);
  };
  const bar = (from: Vector, to: Vector, radius: number, kind: Kind, sides = 5) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), direction = b.clone().sub(a), length = direction.length();
    if (length < 1e-5) return;
    const geometry = new THREE.CylinderGeometry(radius, radius, length, sides);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
    parts[kind].push(geometry.translate(...a.add(b).multiplyScalar(.5).toArray()));
  };
  const flat = (shape: Shape, height: number, kind: Kind, thickness = 0) => {
    const outline = new THREE.Shape(shape.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    outline.holes = shape.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    const geometry = thickness ? new THREE.ExtrudeGeometry(outline, { depth: thickness, bevelEnabled: false }) : new THREE.ShapeGeometry(outline);
    parts[kind].push(geometry.rotateX(-Math.PI / 2).translate(0, height, 0));
  };
  for (const shape of footprints) {
    const platform = rise ? passageFootprint([rise.to, rise.at(rise.length + 20)], feature.width || rise.width) : null;
    const cuts = [...stairs.filter(stair => !stair.openUnderneath).flatMap(stair => [[stair.footprint.outer],
      ...(stair.landing ? [[stair.landing.footprint.outer]] : [])]), ...(rise ? [[rise.footprint.outer], [platform!.outer]] : [])];
    const floors = cuts.length ? polygonClipping.difference([shape.outer, ...shape.holes], ...cuts) : [[shape.outer, ...shape.holes]];
    for (const [outer, ...holes] of floors) flat({ outer, holes }, floor + .045, feature.type === 'undergroundRoom' && feature.roomUse !== 'garage' ? 'green' : 'floor');
    if (platform) for (const [outer, ...holes] of polygonClipping.intersection([shape.outer, ...shape.holes], [platform.outer]))
      flat({ outer, holes }, rise!.topHeight + .045, 'floor');
  }
  for (const section of sections) for (const shape of section.footprints) {
    const clear = section.height, top = floor + clear;
    // Windows cut through the high wall band; lower panels keep the sports hall
    // enclosure, and door heads are retained above each real connection.
    const panels = undergroundWallPanels(shape, clear, section.openings);
    for (const panel of panels) {
      const length = Math.hypot(panel.to[0] - panel.from[0], panel.to[1] - panel.from[1]);
      // Doors and the stair roof split a photographed exterior wall into short
      // panels; they must not erase its high windows or glaze internal seams.
      const highWindows = feature.type === 'undergroundRoom' && feature.roomUse !== 'garage' && clear > 5
        && (hallWindowEdges ? confirmedFacade(panel.from, panel.to, hallWindowEdges) : length > 16);
      if (highWindows) {
        const bottom = Math.max(panel.bottom, clear - .95), windowTop = Math.min(panel.top, clear - .2);
        segment(panel.from, panel.to, floor + panel.bottom, Math.min(panel.top, clear - .95) - panel.bottom, .2, 'walls');
        segment(panel.from, panel.to, floor + Math.max(panel.bottom, clear - .2), panel.top - Math.max(panel.bottom, clear - .2), .2, 'walls');
        if (windowTop > bottom) {
          segment(panel.from, panel.to, floor + bottom, windowTop - bottom, .055, 'glass');
          const angle = -Math.atan2(panel.to[1] - panel.from[1], panel.to[0] - panel.from[0]);
          // Thin sash profiles use double-sided strips instead of hundreds of
          // closed boxes; the glass and structural walls retain their depth.
          for (const y of [bottom, windowTop]) parts.metal.push(new THREE.PlaneGeometry(length, .05).rotateY(angle)
            .translate((panel.from[0] + panel.to[0]) / 2, floor + y, (panel.from[1] + panel.to[1]) / 2));
          const bays = Math.ceil(length / (hallWindowEdges ? 1.25 : 3.4));
          for (let i = 0; i <= bays; i++) {
            const p: Point = panel.from.map((n, j) => n + (panel.to[j] - n) * i / bays) as Point;
            parts.metal.push(new THREE.PlaneGeometry(.035, windowTop - bottom).rotateY(angle)
              .translate(p[0], floor + (bottom + windowTop) / 2, p[1]));
          }
        }
      } else {
        const entranceFace = stairs.some(stair => [panel.from, panel.to].every(p => Math.abs(
          (p[0] - stair.from[0]) * (stair.to[0] - stair.from[0]) + (p[1] - stair.from[1]) * (stair.to[1] - stair.from[1])) / stair.length < 1e-5));
        segment(panel.from, panel.to, floor + panel.bottom, panel.top - panel.bottom, .2, entranceFace ? 'podium' : 'walls');
      }
      const trimHeight = feature.roomUse === 'garage' ? 0 : feature.type === 'undergroundTrack' ? 1.55 : feature.type === 'undergroundCorridor' ? 1.1 : clear - 1;
      // Trim belongs to the solid panel, including the low wall buried beneath
      // a raised landing; it must never span the opening above that panel.
      for (let y = .55; y < trimHeight; y += .55) if (y > panel.bottom && y + .018 <= panel.top) segment(panel.from, panel.to, floor + y, .018, .215, 'tiles');
      if (panel.bottom < 1.1) {
        const bottom = Math.max(.08, panel.bottom), top = Math.min(trimHeight, panel.top);
        const count = Math.ceil(length / (feature.type === 'undergroundTrack' ? .55 : 2.4));
        for (let i = 1; top > bottom && i < count; i++) {
          const p = panel.from.map((n, j) => n + (panel.to[j] - n) * i / count) as Point;
          bar(point(p, floor + bottom), point(p, floor + top), .008, 'tiles', 4);
        }
      }
    }
  }
  for (const stair of stairs) {
    for (const tread of stair.treads) {
      const bottom = stair.openUnderneath ? tread.height - .14 : floor;
      segment(tread.from, tread.to, bottom, tread.height - bottom, stair.width, 'floor');
    }
    if (stair.openUnderneath) for (const side of [-1, 1]) {
      const offset = side * (stair.width / 2 - .08);
      bar(point(stair.at(0, offset), stair.topHeight - .23), point(stair.at(stair.length, offset), stair.bottomHeight - .23), .06, 'metal');
    }
    if (stair.landing) {
      flat(stair.landing.footprint, stair.bottomHeight - .12, 'floor', .12);
      parts.rails.push(undergroundRailGeometry(stair.landing.railEdges.map(edge => edge.map(p => point(p, stair.bottomHeight))), 1.045));
    }
    for (const side of [-1, 1]) {
      const offset = side * (stair.width / 2 - .09);
      parts.rails.push(undergroundRailGeometry([[0, stair.length].map(distance => point(stair.at(distance, offset),
        stair.topHeight + (stair.bottomHeight - stair.topHeight) * distance / stair.length))], 1.045));
    }
  }
  if (rise) {
    for (const tread of rise.treads) segment(tread.from, tread.to, rise.bottomHeight + .045, tread.height - rise.bottomHeight, rise.width, 'floor');
    for (const side of [-1, 1]) {
      const offset = side * (rise.width / 2 - .09);
      const chain = [-1, 0, rise.length, rise.length + 1].map(distance => point(rise.at(distance, offset),
        rise.bottomHeight + .045 + (rise.topHeight - rise.bottomHeight) * Math.max(0, Math.min(1, distance / rise.length))));
      parts.rails.push(undergroundRailGeometry([chain], 1.045));
    }
  }
  const roofOpenings = undergroundSkylights(feature);
  const routes = feature.points ? [feature.points, ...(feature.branches || [])] : [];
  for (const route of routes) for (let edge = 1; edge < route.length; edge++) {
    const a = route[edge - 1], b = route[edge], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz), width = feature.width || 4;
    const routeHeight = route === feature.points ? feature.ceilingSegments?.find(segment => segment.edge === edge - 1)?.height ?? clear : clear;
    const top = floor + routeHeight;
    if (length < 1e-6) continue;
    const at = (distance: number, side = 0): Point => [a[0] + dx / length * distance + dz / length * side, a[1] + dz / length * distance - dx / length * side];
    const lightwell = feature.type === 'undergroundCorridor' && edge === 1;
    const positions = Math.max(1, Math.floor(length / 4.8));
    for (let i = 0; i <= positions; i++) {
      const distance = Math.min(length - .4, .4 + i * (length - .8) / positions), p = at(distance);
      for (const piece of roofSegments(at(distance, -width / 2 + .12), at(distance, width / 2 - .12)))
        segment(piece.from, piece.to, floor + piece.height - .34, .28, .18, 'metal');
      const light = at(distance, lightwell ? width / 4 : 0);
      if (!openRoofAt(light)) box(light, floor + heightAt(light) - .45, .06, lightwell ? 1.2 : .95, .32, -Math.atan2(dz, dx), 'lights');
      for (const side of [-1, 1]) {
        const wallLight = at(distance, side * (width / 2 - .17));
        box(wallLight, floorAt(wallLight) + 1.85, .22, .22, .08, -Math.atan2(dz, dx), 'lights');
        if (i % 3 === 0) box(wallLight, floorAt(wallLight) + .15, .16, .34, .09, -Math.atan2(dz, dx), 'green');
      }
      if (lightwell && i % 2 === 0 && i > 0 && i < positions) {
        const pillar = at(distance, .15);
        bar(point(pillar, floor), point(pillar, floor + heightAt(pillar) - .2), .28, 'walls', 10);
        bar(point(pillar, floor), point(pillar, floor + .18), .31, 'metal', 10);
        // The long corridor photographs show black steel window bays on the
        // building side of a glazed open lightwell, not a closed low tunnel.
        segment(at(distance - 1.65, width / 2 - .16), at(distance + 1.65, width / 2 - .16), floor + 1.45, 1.5, .06, 'glass');
        for (const d of [-1.65, 0, 1.65]) bar(point(at(distance + d, width / 2 - .19), floor + 1.45), point(at(distance + d, width / 2 - .19), floor + 2.95), .035, 'metal');
      }
      if (feature.type === 'undergroundTrack' && i % 4 === 2) {
        const center = at(distance), sideA = at(distance, -width / 2 + .25), sideB = at(distance, width / 2 - .25);
        for (const post of [sideA, sideB]) { bar(point(post, floor + .05), point(post, floor + 1.55), .035, 'fittings'); box(post, floor + .04, .05, .45, .35, -Math.atan2(dz, dx), 'fittings'); }
        segment(sideA, sideB, floor + 1.45, .025, .025, 'pipes');
        segment(sideA, sideB, floor + .8, .65, .013, 'nets');
        box(at(distance, width / 2 - .65), floor + .04, .43, .36, .35, 0, 'fittings');
        // Center stays navigable underneath the hanging practice net; no lane
        // barrier is written into the route or photo placement geometry.
        void center;
      }
    }
    for (const side of [width / 2 - .32, -width / 2 + .32]) {
      const from = at(.35, side), to = at(length - .35, side);
      for (const piece of roofSegments(from, to))
        bar(point(piece.from, floor + piece.height - .58), point(piece.to, floor + piece.height - .58), .035, 'pipes');
      for (const piece of walkingSegments(from, to)) segment(piece.from, piece.to, piece.height + .065, .025, .2, 'tiles');
    }
    if (feature.type === 'tunnel') {
      // Orange guiding strip, suspended red service pipe and bright rectangular
      // ceiling panels are visible in _DSC8295 and the two exit-stair photos.
      for (const piece of walkingSegments(at(.2,-.8),at(length-.2,-.8))) segment(piece.from,piece.to,piece.height+.07,.015,.12,'wood');
      for (const piece of roofSegments(at(.3, .7), at(length - .3, .7)))
        bar(point(piece.from, floor + piece.height - .45), point(piece.to, floor + piece.height - .45), .055, 'pipes');
    }
    if (feature.type === 'undergroundTrack') {
      for (const side of [-width / 3, 0, width / 3]) segment(at(.3, side), at(length - .3, side), floor + .07, .013, .03, 'paint');
      // End high windows bring daylight into the photographed practice strip.
      for (const distance of [.12, length - .12]) for (const piece of roofSegments(at(distance, -width / 2 + .25), at(distance, width / 2 - .25)))
        segment(piece.from, piece.to, floor + piece.height - 1.4, .95, .045, 'glass');
    }
  }
  for (const opening of roofOpenings) for (const section of sections)
    for (const [outer, ...holes] of polygonClipping.difference(
      polygonClipping.intersection(section.footprints.map(shape => [shape.outer, ...shape.holes]), [opening.outer, ...opening.holes]),
      ...ceilingOpenings.map(shape => [shape.outer, ...shape.holes])))
      flat({ outer, holes }, floor + section.height - .05, 'skylights', .045);
  if (feature.type !== 'undergroundRoom' || feature.roomUse === 'garage') {
    // The full enclosure includes merged return passages and corner seams;
    // Skylights and the real folded stairwell cut through the opaque roof.
    for (const section of sections) {
      const polygons = section.footprints.map(shape => [shape.outer, ...shape.holes]);
      const cuts = [...roofOpenings, ...ceilingOpenings];
      const roofs = cuts.length ? polygonClipping.difference(polygons, ...cuts.map(shape => [shape.outer, ...shape.holes])) : polygons;
      for (const [outer, ...holes] of roofs) flat({ outer, holes }, floor + section.height - .12, 'ceiling', .08);
    }
  }
  if (feature.type === 'undergroundRoom' && feature.roomUse !== 'garage' && feature.outer) {
    const frame = undergroundRoomFrame(feature), { at, width, length, along, across } = frame, angle = -Math.atan2(across[1], across[0]);
    const roomPoint = (u: number, v: number, y: number) => point(at(u, v), y);
    const courtAngle = -Math.atan2(along[1], along[0]);
    for (const [u, v] of undergroundBadmintonLayout(frame).centers) {
      const courtAt = (x: number, z: number) => at(u + z, v + x);
      const line = (x0: number, z0: number, x1: number, z1: number) => segment(courtAt(x0, z0), courtAt(x1, z1), floor + .07, .012, .04, 'paint');
      for (const x of [-3.05, 3.05, -2.59, 2.59]) line(x, -6.7, x, 6.7);
      for (const z of [-6.7, -5.94, -1.98, 1.98, 5.94, 6.7]) line(-3.05, z, 3.05, z);
      for (const sign of [-1, 1]) line(0, sign * 1.98, 0, sign * 6.7);
      for (const x of [-3.2, 3.2]) { bar(point(courtAt(x, 0), floor + .06), point(courtAt(x, 0), floor + 1.55), .035, 'wood'); box(courtAt(x, 0), floor + .05, .07, .55, .35, courtAngle, 'wood'); }
      segment(courtAt(-3.2, 0), courtAt(3.2, 0), floor + 1.51, .026, .025, 'paint');
      segment(courtAt(-3.2, 0), courtAt(3.2, 0), floor + .78, .72, .014, 'nets');
      for (const y of [.8, 1.05, 1.3]) segment(courtAt(-3.2, 0), courtAt(3.2, 0), floor + y, .006, .018, 'tiles');
    }
    // The pale timber multipurpose bay in DSC01480 is confined to the far end;
    // it does not turn the green badminton hall into an all-wood basketball hall.
    box(at(width / 2, length - 8), floor + .075, .015, Math.min(15, width - 6), 10, angle, 'wood');
    for (const u of [.8, width - .8]) {
      for (const piece of roofSegments(at(u, .3), at(u, length - .3)).filter(piece => piece.height > 5.3)) {
        segment(piece.from, piece.to, floor + 4.25, .16, 1.1, 'metal');
        for (const y of [4.75, 5.25]) bar(point(piece.from, floor + y), point(piece.to, floor + y), .025, 'paint');
      }
      for (let v = .3; v < length; v += 1.25) if (heightAt(at(u, v)) > 5.3)
        bar(roomPoint(u, v, floor + 4.4), roomPoint(u, v, floor + 5.3), .023, 'paint');
    }
    const bays = Math.max(2, Math.round(length / 8));
    for (let i = 0; i <= bays; i++) {
      const v = .7 + (length - 1.4) * i / bays;
      for (const u of [.35, width * .5, width - .35]) {
        const top = floor + heightAt(at(u, v));
        bar(roomPoint(u, v, floor + .05), roomPoint(u, v, top - .25), .26, 'walls', 8);
        box(at(u, v), top - .55, .4, .55, .6, angle, 'metal');
      }
      for (const piece of roofSegments(at(.35, v), at(width - .35, v)))
        segment(piece.from, piece.to, floor + piece.height - .5, .28, .25, 'metal');
      for (const u of [width * .25, width * .75]) {
        for (const piece of roofSegments(at(u - .75, v), at(u + .75, v)))
          segment(piece.from, piece.to, floor + piece.height - .6, .08, .6, 'lights');
        const top = floor + heightAt(at(u, v));
        bar(roomPoint(u, v, top - .65), roomPoint(u, v, top - 1.1), .015, 'pipes');
      }
    }
    for (const u of [1.5, width * .33, width * .66, width - 1.5]) for (const piece of roofSegments(at(u, .4), at(u, length - .4)))
      bar(point(piece.from, floor + piece.height - .7), point(piece.to, floor + piece.height - .7), .05, 'pipes');
    for (const piece of roofSegments(at(width * .5, .4), at(width * .5, length - .4)))
      segment(piece.from, piece.to, floor + piece.height - .6, .24, .75, 'metal');
    for (const section of sections) for (const shape of section.footprints) flat(shape, floor + section.height - .06, 'ceiling');
    // Retractable ceiling frames are photographed above the timber bay.
    const boardV = length - 9.5, boardU = width * .5;
    for (const piece of roofSegments(at(boardU - .9, boardV), at(boardU + .9, boardV)))
      segment(piece.from, piece.to, floor + 3.1, Math.min(1.05, piece.height - 3.22), .045, 'glass');
    bar(roomPoint(boardU, boardV, floor + 3.1), roomPoint(boardU, boardV, floor + heightAt(at(boardU, boardV)) - .4), .05, 'metal');
    const rim = new THREE.TorusGeometry(.225, .021, 5, 14).rotateX(Math.PI / 2); const p = at(boardU, boardV - .36); parts.pipes.push(rim.translate(p[0], floor + 3.05, p[1]));
    void along;
  }
  const merge = (geometries: THREE.BufferGeometry[]) => {
    const plain = geometries.map(part => { const data = part.index ? part.toNonIndexed() : part.clone(); data.deleteAttribute('uv'); return data; });
    const result = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    geometries.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
    result.userData.photoOcclusionMask = new Uint8Array(result.getAttribute('position').count / 3);
    return result;
  };
  return Object.fromEntries(Object.entries(parts).map(([kind, list]) => [kind, merge(list)])) as Record<Kind, THREE.BufferGeometry>;
}

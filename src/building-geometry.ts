import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { passageFootprint } from './underground-geometry.ts';
import { stairwellShaft } from './teaching-stairs.ts';
import { classroomWallFootprint, classroomWindowLayout, solidCoreWindowLayout, type ClassroomWindow } from './teaching-classrooms.ts';
import type { BuildingPart, BuildingSolidCore, BuildingStairwell, ClassroomWindows, FloorCorridor, GroundPassage, Point, Shape } from './types';

const CORRIDOR_SLAB_THICKNESS = .25;
type Section = Shape & Pick<BuildingPart, 'openEdges' | 'openEdgesStartFloor' | 'openEdgesEndFloor'>;

export function buildingSectionWindows(section: Section, core: polygonClipping.MultiPolygon, config: ClassroomWindows, height: number, floorHeight: number, groundOpenings: polygonClipping.Polygon[] = [], solidCores: polygonClipping.Polygon[] = [], groundRecesses: polygonClipping.Polygon[] = []) {
  const edges = (section.openEdges || []).map(edge => ({ from: section.outer[edge], to: section.outer[edge + 1] }));
  if (!edges.length) return classroomWindowLayout(core, config, height, floorHeight, groundOpenings, solidCores, [], groundRecesses);
  const inOpening = (window: ClassroomWindow) => window.bottom >= ((section.openEdgesStartFloor ?? 1) - 1) * floorHeight && window.bottom < (section.openEdgesEndFloor ?? Infinity) * floorHeight;
  const opened = classroomWindowLayout(core, config, height, floorHeight, groundOpenings, solidCores, edges, groundRecesses);
  const closed = classroomWindowLayout(core, config, height, floorHeight, groundOpenings, solidCores, [], groundRecesses);
  return [...opened.filter(inOpening), ...closed.filter(window => !inOpening(window))];
}

export function snapFootprint(polygons: polygonClipping.MultiPolygon): polygonClipping.MultiPolygon {
  return polygons.flatMap(polygon => {
    const rings = polygon.map(ring => {
      const points = ring.map(([x, z]): Point => [Math.round(x * 1e5) / 1e5, Math.round(z * 1e5) / 1e5])
        .filter((p, i, all) => !i || p[0] !== all[i - 1][0] || p[1] !== all[i - 1][1]);
      const first = points[0], last = points.at(-1);
      if (first && last && (first[0] !== last[0] || first[1] !== last[1])) points.push(first);
      return points;
    }).filter(ring => ring.length >= 4 && Math.abs(ring.slice(1).reduce((area, p, i) => area + ring[i][0] * p[1] - p[0] * ring[i][1], 0)) > 1e-8);
    return rings.length ? [rings] : [];
  });
}

function makeShape(data: Shape) {
  const outer = data.outer.map(([x, z]) => new THREE.Vector2(x, -z));
  if (!THREE.ShapeUtils.isClockWise(outer)) outer.reverse();
  const shape = new THREE.Shape(outer);
  shape.holes = data.holes.map(ring => {
    const points = ring.map(([x, z]) => new THREE.Vector2(x, -z));
    // Extrusion does not normalize hole winding when the outer ring is already
    // clockwise. Keep courtyard walls facing inward across passage floor splits.
    if (THREE.ShapeUtils.isClockWise(points)) points.reverse();
    return new THREE.Path(points);
  });
  return shape;
}

// Corridor caps are built separately. Emit only the polygon's side walls,
// avoiding a complete extrusion (and discarded cap triangulation) per layer.
export function buildingWallTriangles(shape: Shape, depth: number) {
  const points = makeShape(shape).extractPoints(12);
  const positions: number[] = [], top = Math.fround(depth);
  for (const ring of [points.shape, ...points.holes]) {
    // Match ExtrudeGeometry's adjacent-point tolerance and winding, including
    // its removal of the repeated closing vertex before emitting side faces.
    let previous = ring[0];
    for (let i = 1; i <= ring.length; i++) {
      const index = i % ring.length, point = ring[index];
      const scale = Math.max(Math.abs(point.x), Math.abs(point.y), Math.abs(previous.x), Math.abs(previous.y));
      if (point.distanceToSquared(previous) <= 1e-20 * scale * scale) { ring.splice(index, 1); i--; }
      else previous = point;
    }
    for (let i = ring.length - 1; i >= 0; i--) {
      const a = ring[i], b = ring[(i + ring.length - 1) % ring.length];
      const ax = Math.fround(a.x), ay = Math.fround(a.y), bx = Math.fround(b.x), by = Math.fround(b.y);
      positions.push(ax, ay, 0, bx, by, 0, ax, ay, top, bx, by, 0, bx, by, top, ax, ay, top);
    }
  }
  return positions;
}

export function passageShape(passage: GroundPassage) {
  const points = passage.points.map(point => [...point] as Point);
  // Extend past the facade so a road endpoint on a wall cannot leave a thin cap.
  for (const [end, next] of [[0, 1], [points.length - 1, points.length - 2]]) {
    const dx = points[end][0] - points[next][0], dz = points[end][1] - points[next][1];
    const scale = passage.width / Math.hypot(dx, dz);
    points[end] = [points[end][0] + dx * scale, points[end][1] + dz * scale];
  }
  return passageFootprint(points, passage.width);
}

function splitFacade(section: Shape, corners: Point[]): Shape {
  const split = (ring: Point[]) => {
    const vertices = ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
    const result: Point[] = [];
    for (let i = 0; i < vertices.length; i++) {
      const from = vertices[i], to = vertices[(i + 1) % vertices.length];
      const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
      const minX = Math.min(from[0], to[0]) - 1e-7, maxX = Math.max(from[0], to[0]) + 1e-7;
      const minZ = Math.min(from[1], to[1]) - 1e-7, maxZ = Math.max(from[1], to[1]) + 1e-7;
      const cuts: { point: Point; t: number }[] = [];
      for (const point of corners) {
        if (point[0] < minX || point[0] > maxX || point[1] < minZ || point[1] > maxZ) continue;
        const t = ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / length ** 2;
        if (t > 1e-8 && t < 1 - 1e-8 && Math.abs((point[0] - from[0]) * dz - (point[1] - from[1]) * dx) / length < 1e-7) cuts.push({ point, t });
      }
      cuts.sort((a, b) => a.t - b.t);
      result.push(from);
      for (const { point } of cuts) if (Math.hypot(point[0] - result.at(-1)![0], point[1] - result.at(-1)![1]) > 1e-7) result.push(point);
    }
    result.push(result[0]);
    return result;
  };
  return { outer: split(section.outer), holes: section.holes.map(split) };
}

function corridorFootprint(section: Shape, corridor: FloorCorridor, passages: GroundPassage[]): Shape {
  // A calibrated outside walkway has its own boundary. Buffering its facade
  // centreline on both sides would cut through the adjacent classrooms.
  if (corridor.footprint) return corridor.footprint;
  // Explicit routes follow the facade: cut the stated depth into the building
  // and across the outer edge, including small imported facade protrusions.
  if ('points' in corridor) return passageFootprint(corridor.points, corridor.depth * 2);
  if ('passageIndex' in corridor) {
    // Open the connector on every floor, rather than only recessing its facade.
    return passageShape({ ...passages[corridor.passageIndex], width: corridor.depth });
  }
  if ('edges' in corridor) {
    const points = corridor.edges.map(edge => section.outer[edge]);
    points.push(section.outer[corridor.edges.at(-1)! + 1]);
    // A shared miter joins both sides of the recessed return corner, without
    // leaving a wall plug between two separately cut facade strips.
    return passageFootprint(points, corridor.depth * 2);
  }
  if ('holeIndex' in corridor) {
    const ring = section.holes[corridor.holeIndex];
    const vertices = ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
    const area = vertices.reduce((sum, p, i) => { const q = vertices[(i + 1) % vertices.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0);
    const direction = area >= 0 ? 1 : -1;
    const normals = vertices.map((p, i): Point => {
      const q = vertices[(i + 1) % vertices.length], dx = q[0] - p[0], dz = q[1] - p[1], length = Math.hypot(dx, dz);
      return [dz / length * direction, -dx / length * direction];
    });
    const outer = vertices.map((p, i): Point => {
      const before = normals[(i + normals.length - 1) % normals.length], after = normals[i];
      const nx = before[0] + after[0], nz = before[1] + after[1];
      const scale = corridor.depth / (nx * after[0] + nz * after[1]);
      return [p[0] + nx * scale, p[1] + nz * scale];
    });
    return { outer: [...outer, outer[0]], holes: [] };
  }
  const ring = section.outer, from = ring[corridor.edge], to = ring[corridor.edge + 1];
  const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
  const area = ring.slice(1).reduce((sum, point, i) => sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0);
  const direction = area >= 0 ? 1 : -1;
  const nx = -dz / length * direction, nz = dx / length * direction;
  // OSM part boundaries are not quite perpendicular to this facade. Extend
  // the ends across that small skew so no thin but full-height end wall remains.
  const extension = corridor.depth * .05;
  const start: Point = [from[0] - dx / length * extension, from[1] - dz / length * extension];
  const end: Point = [to[0] + dx / length * extension, to[1] + dz / length * extension];
  // Cross the original facade very slightly so no coplanar wall survives the cut.
  const point = (p: Point, distance: number): Point => [p[0] + nx * distance, p[1] + nz * distance];
  const outer = [point(start, -.001), point(end, -.001), point(end, corridor.depth), point(start, corridor.depth)];
  return { outer: [...outer, outer[0]], holes: [] };
}

export function buildingCoreFootprint(section: Shape, passages: GroundPassage[], corridors: FloorCorridor[], stairs: BuildingStairwell[], solidCores: (Shape & { partition?: boolean })[] = [], cutouts: Shape[] = []) {
  // Storey-specific rooms can share the same facade. Join their cuts
  // before subtracting them so nested, coincident boundaries stay stable.
  // Interior partitions add a wall only on their active storeys. Removing their
  // footprint would also invent a surrounding shell on every inactive storey.
  const solids = solidCores.filter(core => !core.partition).map(core => [core.outer, ...core.holes]);
  const solidCuts = solids.length ? polygonClipping.union(solids[0], ...solids.slice(1)) : [];
  const cuts = [...corridors.map(corridor => { const shape = corridorFootprint(section, corridor, passages); return [shape.outer, ...shape.holes]; }), ...stairs.map(stair => [stair.opening.outer, ...stair.opening.holes]), ...solidCuts, ...cutouts.map(cut => [cut.outer, ...cut.holes])];
  const polygon = [section.outer, ...section.holes];
  return cuts.length ? polygonClipping.difference(polygon, cuts[0], ...cuts.slice(1)) : [polygon];
}

function corridorGeometry(section: Section, height: number, floorHeight: number, passages: GroundPassage[], corridors: FloorCorridor[], stairs: BuildingStairwell[], windows?: ClassroomWindows, solidCores: BuildingSolidCore[] = [], cutouts: Shape[] = [], cutaway = false, windowLayout?: ClassroomWindow[]) {
  const polygon = [section.outer, ...section.holes];
  const corridorCuts = corridors.map(corridor => { const shape = corridorFootprint(section, corridor, passages); return [shape.outer, ...shape.holes]; });
  const infills = corridors.flatMap(corridor => corridor.slabInfill ? [[corridor.slabInfill.outer, ...corridor.slabInfill.holes]] : []);
  const stairCuts = stairs.map(stair => [stair.opening.outer, ...stair.opening.holes]);
  const openings = [...corridorCuts, ...stairCuts];
  const solids = solidCores.map(core => [core.outer, ...core.holes]);
  const solidStarts = solidCores.map(core => Math.max(0, ((core.startFloor ?? 1) - 1) * floorHeight));
  const solidEnds = solidCores.map(core => Math.min(height, (core.endFloor ?? Infinity) * floorHeight));
  const coreShells = solids.map((solid, index) => cutaway || solidCores[index].classroomWindows
    ? snapFootprint(classroomWallFootprint([solid], solidCores[index].classroomWindows?.wallThickness ?? .25, snapFootprint,
      (solidCores[index].openEdges || []).map(edge => ({ from: solidCores[index].outer[edge], to: solidCores[index].outer[edge + 1] })))) : []);
  const doorShells = solids.map((solid, index) => solidCores[index].doors?.length
    ? snapFootprint(classroomWallFootprint([solid], solidCores[index].classroomWindows?.wallThickness ?? .25, snapFootprint,
      [...(solidCores[index].openEdges || []), ...solidCores[index].doors!.map(door => door.edge)].map(edge => ({ from: solidCores[index].outer[edge], to: solidCores[index].outer[edge + 1] })))) : coreShells[index]);
  const openArea = openings.length ? polygonClipping.union(openings[0], ...openings.slice(1), ...infills) : [];
  const corridorArea = solids.length ? polygonClipping.difference(openArea, solids[0], ...solids.slice(1)) : openArea;
  // Stitch the small imported facade notch at slab levels only. The open
  // corridor and courtyard remain hollow between floors.
  const additions = [...infills, ...solids];
  const originalSlabs = additions.length ? polygonClipping.union(polygon, ...additions) : [polygon];
  // Removed volumes disappear through the roof and every slab as well as walls.
  const removed = cutouts.map(cut => [cut.outer, ...cut.holes]);
  const slabFootprint = removed.length ? polygonClipping.difference(originalSlabs, removed[0], ...removed.slice(1)) : originalSlabs;
  const core = buildingCoreFootprint(section, passages, corridors, stairs, solidCores, cutouts);
  // A room joined to the main body shares its open root with that body shell.
  // Otherwise the ordinary classroom facade would seal the dedicated bay.
  const solidOpenEdges = solidCores.flatMap(core => (core.openEdges || []).map(edge => ({ from: core.outer[edge], to: core.outer[edge + 1] })));
  const partOpenEdges = (section.openEdges || []).map(edge => ({ from: section.outer[edge], to: section.outer[edge + 1] }));
  const coreOpenEdges = [...solidOpenEdges, ...partOpenEdges], openBottom = ((section.openEdgesStartFloor ?? 1) - 1) * floorHeight, openTop = (section.openEdgesEndFloor ?? Infinity) * floorHeight;
  const hasShell = !!windows || partOpenEdges.length > 0;
  const classrooms = hasShell ? snapFootprint(classroomWallFootprint(core, windows?.wallThickness ?? .25, snapFootprint, coreOpenEdges)) : core;
  const closes = openBottom > 0 || openTop < height;
  const closedClassrooms = closes && hasShell ? snapFootprint(classroomWallFootprint(core, windows?.wallThickness ?? .25, snapFootprint, solidOpenEdges)) : classrooms;
  // Simple massing has no modelled interior. Open just the selected storey as
  // an exterior wall shell so removing its ceiling reveals a usable floor.
  const cutawayBottom = Math.max(0, (Math.ceil(height / floorHeight - 1e-8) - 1) * floorHeight);
  const cutawayWalls = cutaway && !windows ? snapFootprint(classroomWallFootprint(core, .25, snapFootprint, coreOpenEdges)) : undefined;
  const closedCutawayWalls = closes && cutawayWalls ? snapFootprint(classroomWallFootprint(core, .25, snapFootprint, solidOpenEdges)) : cutawayWalls;
  // Imported corridor boundaries can leave a millimetre-wide concrete sliver
  // behind the new glass. Clear that seam while retaining the adjoining walls.
  const elevatorSeams = solidCores.filter(core => core.elevator).flatMap(core => core.outer.slice(1).map((to, i) => [passageFootprint([core.outer[i], to], .1).outer]));
  const walls = elevatorSeams.length ? polygonClipping.difference(classrooms, elevatorSeams[0], ...elevatorSeams.slice(1)) : classrooms;
  const closedWalls = elevatorSeams.length ? polygonClipping.difference(closedClassrooms, elevatorSeams[0], ...elevatorSeams.slice(1)) : closedClassrooms;
  const shafts = [...stairs.map(stair => [stairwellShaft(stair).outer]), ...solidCores.filter(core => core.elevator).map(core => [core.outer, ...core.holes])];
  const roofStairs = cutaway ? [] : stairs.filter(stair => stair.roofAccess);
  const roofShafts = roofStairs.map(stair => [stairwellShaft(stair).outer]);
  const passageCuts = passages.map(passage => {
    const shape = passageShape(passage);
    return [shape.outer, ...shape.holes];
  });
  const groundCuts = [...passageCuts, ...corridorCuts.filter((_, i) => corridors[i].removeGroundFloor)];
  const groundRecesses = passageCuts.filter((_, i) => passages[i].recessClassrooms);
  const groundCore = groundRecesses.length ? polygonClipping.difference(core, groundRecesses[0], ...groundRecesses.slice(1)) : undefined;
  const groundClassrooms = groundCore && (hasShell || cutaway
    ? snapFootprint(classroomWallFootprint(groundCore, windows?.wallThickness ?? .25, snapFootprint, coreOpenEdges)) : groundCore);
  const groundWalls = groundClassrooms && (elevatorSeams.length
    ? polygonClipping.difference(groundClassrooms, elevatorSeams[0], ...elevatorSeams.slice(1)) : groundClassrooms);
  const closedGroundClassrooms = groundCore && closes && (hasShell || cutaway
    ? snapFootprint(classroomWallFootprint(groundCore, windows?.wallThickness ?? .25, snapFootprint, solidOpenEdges)) : groundCore);
  const closedGroundWalls = closedGroundClassrooms ? elevatorSeams.length
    ? polygonClipping.difference(closedGroundClassrooms, elevatorSeams[0], ...elevatorSeams.slice(1)) : closedGroundClassrooms : groundWalls;
  const windowExclusions = [...solids.filter((_, i) => !solidCores[i].partition), ...stairs.filter(stair => stair.internal).map(stair => [stair.opening.outer, ...stair.opening.holes])];
  const glazing = [...(windows ? windowLayout ?? buildingSectionWindows(section, core, windows, height, floorHeight, passageCuts, windowExclusions, groundRecesses) : []),
    ...solidCoreWindowLayout(solidCores, height, floorHeight)];
  const slabThickness = Math.min(CORRIDOR_SLAB_THICKNESS, floorHeight * .1, height * .1);
  const slabs = [[0, slabThickness], ...(!cutaway ? [[height - slabThickness, height]] : [])];
  for (let level = 1; level * floorHeight < height - 1e-8; level++) {
    const bottom = level * floorHeight;
    slabs.push([bottom, Math.min(bottom + slabThickness, height)]);
  }
  const doorTops = solidCores.flatMap((core, index) => Array.from({ length: Math.ceil(solidEnds[index] / floorHeight) }, (_, floor) =>
    (core.doors || []).map(door => floor * floorHeight + door.height)).flat().filter(top => top > solidStarts[index] && top < solidEnds[index]));
  const levels = [...new Set([0, height, Math.min(floorHeight, height), openBottom, openTop, ...solidStarts, ...solidEnds, ...doorTops, ...slabs.flat(), ...glazing.flatMap(window => [window.bottom, window.top])])].filter(level => level >= 0 && level <= height).sort((a, b) => a - b);
  // Repeated storeys share identical XY wall/window cuts. Keep this cache local
  // to one build, so editor geometry changes never reuse an old footprint.
  const footprints = new Map<string, polygonClipping.MultiPolygon>();
  const layers = levels.slice(0, -1).map((bottom, i) => {
    const top = levels[i + 1], middle = (bottom + top) / 2;
    const slab = slabs.some(([a, b]) => middle >= a && middle <= b);
    // Upper-storey rooms leave the entrance beneath them open.
    const activeSolids = solids.flatMap((solid, index) => solidCores[index].elevator || middle < solidStarts[index] || middle >= solidEnds[index] ? [] :
      solidCores[index].doors?.some(door => middle % floorHeight < door.height) ? doorShells[index] :
      solidCores[index].classroomWindows || cutaway && middle >= cutawayBottom ? coreShells[index] : [solid]);
    const opened = middle >= openBottom && middle < openTop;
    const storeyWalls = middle < floorHeight && groundWalls ? opened ? groundWalls : closedGroundWalls! : cutawayWalls && middle >= cutawayBottom ? opened ? cutawayWalls : closedCutawayWalls! : opened ? walls : closedWalls;
    const openWindows = !slab && snapFootprint(glazing.filter(window => middle > window.bottom && middle < window.top).map(window => window.cut));
    const stairOpening = slab && middle > slabThickness && middle < height - slabThickness && shafts.length > 0;
    const roofOpening = slab && middle >= height - slabThickness && roofShafts.length > 0;
    const groundOpening = middle < floorHeight && groundCuts.length > 0;
    const key = JSON.stringify([slab, storeyWalls, activeSolids, openWindows, stairOpening, roofOpening, groundOpening]);
    const cached = footprints.get(key);
    if (cached) return { bottom, top, footprint: cached, slab };
    let footprint = slab ? slabFootprint : activeSolids.length ? polygonClipping.union(storeyWalls, activeSolids[0], ...activeSolids.slice(1)) : storeyWalls;
    if (openWindows && openWindows.length) footprint = polygonClipping.difference(footprint, openWindows[0], ...openWindows.slice(1));
    // Retain the base and roof; stairs and glass elevator shafts remain open
    // through intermediate slabs so they can connect the floors.
    if (stairOpening) footprint = polygonClipping.difference(footprint, shafts[0], ...shafts.slice(1));
    if (roofOpening) footprint = polygonClipping.difference(footprint, roofShafts[0], ...roofShafts.slice(1));
    // Ground roads and removed balcony strips stay clear, including base slabs.
    if (groundOpening) footprint = polygonClipping.difference(footprint, groundCuts[0], ...groundCuts.slice(1));
    // Window jambs and wall shells share the same boundary. Weld microscopic
    // clipping differences before subtracting adjacent layers for their caps.
    footprint = hasShell || cutaway ? snapFootprint(footprint) : footprint;
    footprints.set(key, footprint);
    return { bottom, top, footprint, slab };
  });
  // A separately calibrated top room may reach the building edge while its
  // ordinary storeys and the last flight retain their original stair opening.
  const accesses = roofStairs.map(stair => {
    const access = stair.roofAccess!, footprint = access.footprint ?? stair.opening;
    const polygon = [footprint.outer, ...footprint.holes];
    const openEdges = access.openEdges.map(edge => ({ from: footprint.outer[edge], to: footprint.outer[edge + 1] }));
    const shell = snapFootprint(classroomWallFootprint([polygon], .28, snapFootprint, openEdges));
    return { polygon, shell, shaft: [stairwellShaft(stair).outer], top: height + access.height };
  });
  const roofLevels = [...new Set(accesses.flatMap(access => [height, height + slabThickness, access.top - slabThickness, access.top]))].sort((a, b) => a - b);
  for (let i = 0; i < roofLevels.length - 1; i++) {
    const bottom = roofLevels[i], top = roofLevels[i + 1], middle = (bottom + top) / 2;
    const pieces = accesses.filter(access => middle < access.top).map(access => middle < height + slabThickness
      ? polygonClipping.difference(access.polygon, access.shaft)
      : middle >= access.top - slabThickness ? [access.polygon] : access.shell);
    if (pieces.length) layers.push({ bottom, top, footprint: snapFootprint(polygonClipping.union(pieces[0], ...pieces.slice(1))), slab: middle < height + slabThickness || accesses.every(access => middle >= access.top - slabThickness) });
  }
  const positions: number[] = [], occlusionMask: number[] = [];
  const corners = [...new Map(layers.flatMap(layer => layer.footprint.flat(2)).map(point => [point.join(','), point])).values()];
  const contours = new WeakMap<polygonClipping.MultiPolygon, Shape[]>();
  const caps = new WeakMap<polygonClipping.MultiPolygon, Map<polygonClipping.MultiPolygon, polygonClipping.MultiPolygon>>();
  const exposedCap = (footprint: polygonClipping.MultiPolygon, neighbor?: polygonClipping.MultiPolygon) => {
    if (!neighbor) return footprint;
    let differences = caps.get(footprint);
    if (!differences) { differences = new Map(); caps.set(footprint, differences); }
    let difference = differences.get(neighbor);
    if (!difference) { difference = polygonClipping.difference(footprint, neighbor); differences.set(neighbor, difference); }
    return difference;
  };
  const insideRing = (point: Point, ring: Point[]) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  };
  const insideCorridor = (point: Point) => corridorArea.some(([outer, ...holes]) => insideRing(point, outer) && !holes.some(hole => insideRing(point, hole)));
  const addHorizontal = (footprint: polygonClipping.MultiPolygon, y: number, upward: boolean, blocking: boolean) => {
    for (const [outer, ...holes] of footprint) {
      const geometry = new THREE.ShapeGeometry(makeShape({ outer, holes }));
      const vertices = geometry.getAttribute('position'), indices = geometry.getIndex()!;
      for (let i = 0; i < indices.count; i += 3) {
        for (const offset of upward ? [0, 1, 2] : [2, 1, 0]) {
          const index = indices.getX(i + offset);
          positions.push(vertices.getX(index), vertices.getY(index), y);
        }
        occlusionMask.push(blocking ? 1 : 0);
      }
      geometry.dispose();
    }
  };
  const corridorCaps = new WeakMap<polygonClipping.MultiPolygon, [polygonClipping.MultiPolygon, polygonClipping.MultiPolygon]>();
  const addCap = (footprint: polygonClipping.MultiPolygon, y: number, upward: boolean) => {
    // Keep classroom roofs and passage ceilings blocking; only the recessed
    // corridor's slab surfaces are transparent to photo-marker visibility rays.
    if (!footprint.length) return;
    let split = corridorCaps.get(footprint);
    if (!split) {
      split = [polygonClipping.difference(footprint, corridorArea), polygonClipping.intersection(footprint, corridorArea)];
      corridorCaps.set(footprint, split);
    }
    addHorizontal(split[0], y, upward, true);
    addHorizontal(split[1], y, upward, false);
  };
  for (const [i, layer] of layers.entries()) {
    let walls = contours.get(layer.footprint);
    if (!walls) { walls = layer.footprint.map(([outer, ...holes]) => splitFacade({ outer, holes }, corners)); contours.set(layer.footprint, walls); }
    for (const wall of walls) {
      // Identical subdivisions keep intact walls free of false seams at slab levels.
      const vertices = buildingWallTriangles(wall, layer.top - layer.bottom);
      for (let j = 0; j < vertices.length; j += 9) {
        for (let k = 0; k < 3; k++) positions.push(vertices[j + k * 3], vertices[j + k * 3 + 1], vertices[j + k * 3 + 2] + layer.bottom);
        const middle: Point = [0, 1, 2].reduce((sum, k) => [sum[0] + vertices[j + k * 3] / 3, sum[1] - vertices[j + k * 3 + 1] / 3] as Point, [0, 0] as Point);
        occlusionMask.push(layer.slab && insideCorridor(middle) ? 0 : 1);
      }
    }
    // Only exposed floors/ceilings get caps. Shared slab/core interfaces are
    // removed instead of overlapping, so the open corridors do not flicker.
    const previous = layers[i - 1]?.footprint, next = layers[i + 1]?.footprint;
    if (previous !== layer.footprint) addCap(exposedCap(layer.footprint, previous), layer.bottom, false);
    if (next !== layer.footprint) addCap(exposedCap(layer.footprint, next), layer.top, true);
  }
  const geometry = new THREE.BufferGeometry();
  // Clipped jamb corners may produce slivers narrower than the snapping grid.
  // Drop them before rendering or raycasting, keeping the face mask aligned.
  const clean: number[] = [], masks: number[] = [], faces = new Set<string>(), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const coordinates = new Map<number, string>();
  const coordinateKey = (value: number) => {
    const rounded = Math.fround(value);
    let key = coordinates.get(rounded);
    if (key === undefined) { key = rounded.toFixed(5); coordinates.set(rounded, key); }
    return key;
  };
  for (let i = 0; i < positions.length; i += 9) {
    a.fromArray(positions, i); b.fromArray(positions, i + 3); c.fromArray(positions, i + 6);
    b.sub(a); c.sub(a);
    const longestEdge = Math.max(b.lengthSq(), c.lengthSq(), b.distanceToSquared(c));
    if (b.cross(c).lengthSq() < longestEdge * 1e-10) continue;
    const face = [0, 3, 6].map(offset => coordinateKey(positions[i + offset]) + ',' + coordinateKey(positions[i + offset + 1]) + ',' + coordinateKey(positions[i + offset + 2])).sort().join(';');
    if (faces.has(face)) continue;
    faces.add(face);
    for (let k = 0; k < 9; k++) clean.push(positions[i + k]);
    masks.push(occlusionMask[i / 9]);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(clean, 3));
  geometry.userData.photoOcclusionMask = new Uint8Array(masks);
  geometry.computeVertexNormals();
  return geometry;
}

// Geometry stays in the same local extrusion coordinates as ordinary buildings:
// x / -map z on the footprint, and local z for height above the building base.
export function buildingGeometry(section: Section, height: number, floorHeight: number, passages: GroundPassage[] = [], corridors: FloorCorridor[] = [], stairs: BuildingStairwell[] = [], windows?: ClassroomWindows, solidCores: BuildingSolidCore[] = [], cutouts: Shape[] = [], cutaway = false, windowLayout?: ClassroomWindow[]) {
  if (cutaway || corridors.length || stairs.length || windows || solidCores.length || cutouts.length || section.openEdges?.length) return corridorGeometry(section, height, floorHeight, passages, corridors, stairs, windows, solidCores, cutouts, cutaway, windowLayout);
  const polygon = [section.outer, ...section.holes];
  const cuts = passages.map(passage => {
    const shape = passageShape(passage);
    return [shape.outer, ...shape.holes];
  });
  if (!cuts.length || !polygonClipping.intersection(polygon, polygonClipping.union(cuts[0], ...cuts.slice(1))).length) {
    return new THREE.ExtrudeGeometry(makeShape(section), { depth: height, bevelEnabled: false });
  }

  const lower = polygonClipping.difference(polygon, cuts[0], ...cuts.slice(1));
  const clearance = Math.min(floorHeight, height), hasUpper = height > clearance;
  const positions: number[] = [];
  const addExtrusion = (shape: Shape, depth: number, bottom: number, omitBottom = false, omitTop = false) => {
    const geometry = new THREE.ExtrudeGeometry(makeShape(shape), { depth, bevelEnabled: false });
    const vertices = geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i += 3) {
      const heights = [0, 1, 2].map(j => vertices.getZ(i + j));
      if ((omitBottom && heights.every(z => Math.abs(z) < 1e-5)) || (omitTop && heights.every(z => Math.abs(z - depth) < 1e-5))) continue;
      for (let j = 0; j < 3; j++) positions.push(vertices.getX(i + j), vertices.getY(i + j), vertices.getZ(i + j) + bottom);
    }
    geometry.dispose();
  };
  for (const [outer, ...holes] of lower) addExtrusion({ outer, holes }, clearance, 0, false, hasUpper);
  if (hasUpper) {
    // Match wall vertices across the floor boundary so edge outlines do not
    // mistake partially shared facade segments for an exposed horizontal seam.
    addExtrusion(splitFacade(section, lower.flat(2)), height - clearance, clearance, true);
    // Only the passage ceiling is exposed. Removing the internal floor caps
    // keeps the remaining facade continuous, without a new line at every floor.
    const ceiling = polygonClipping.difference(polygon, lower);
    for (const [outer, ...holes] of ceiling) {
      const geometry = new THREE.ShapeGeometry(makeShape({ outer, holes }));
      const vertices = geometry.getAttribute('position'), indices = geometry.getIndex()!;
      for (let i = 0; i < indices.count; i += 3) {
        for (const j of [2, 1, 0]) {
          const vertex = indices.getX(i + j);
          positions.push(vertices.getX(vertex), vertices.getY(vertex), clearance);
        }
      }
      geometry.dispose();
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { architectureBar, architectureBatch, classroomGlazingGeometry } from './architecture-geometry.ts';
import { buildingCoreFootprint, buildingGeometry, buildingSectionWindows, passageShape } from './building-geometry.ts';
import { straightStairTreads } from './structure-geometry.ts';
import { passageFootprint } from './underground-geometry.ts';
import { confirmedFacade } from './teaching-classrooms.ts';
import type { ClassroomWindow } from './teaching-classrooms.ts';
import type { Building, BuildingPart, Point, Shape } from './types';

type Section = BuildingPart & { height: number; floors: number };
const BASE = .12;
const shifted = (p: Point, axis: Point, distance: number): Point => [p[0] + axis[0] * distance, p[1] + axis[1] * distance];

// The recessed door follows the same building axis as the symmetric straight walls.
export function theatreEntranceLayout(building: Building, floorHeight: number) {
  const terrace = building.parts!.find(part => part.id === 'curved-terrace')!, edge = terrace.roofTerrace!.railEdges[0];
  const outer = terrace.outer[edge.length], inner = terrace.outer[edge.length + 1], length = Math.hypot(outer[0] - inner[0], outer[1] - inner[1]);
  const axis: Point = [(outer[0] - inner[0]) / length, (outer[1] - inner[1]) / length], outward: Point = [axis[1], -axis[0]];
  const center: Point = [(inner[0] + outer[0]) / 2, (inner[1] + outer[1]) / 2], width = Math.min(3, length - .6);
  const from = shifted(center, axis, -width / 2), to = shifted(center, axis, width / 2);
  const wallFrom = building.outer[10], wallTo = building.outer[11], wallLength = Math.hypot(wallTo[0] - wallFrom[0], wallTo[1] - wallFrom[1]);
  const flightAxis: Point = [(wallTo[0] - wallFrom[0]) / wallLength, (wallTo[1] - wallFrom[1]) / wallLength];
  const flightNormal: Point = [flightAxis[1], -flightAxis[0]];
  const flightTop = shifted(shifted(wallFrom, flightNormal, width / 2), flightAxis, .03), bottom = shifted(flightTop, flightAxis, 8.5);
  const turn = shifted(center, outward, .65), landing = shifted(flightTop, flightAxis, -width / 2);
  const route = [shifted(center, outward, -.65), turn, landing, flightTop];
  const passagePolygons = polygonClipping.union([passageFootprint(route.slice(0,-1), width).outer], [passageFootprint([shifted(flightTop, flightAxis, -width), flightTop], width).outer]);
  const [passageOuter, ...passageHoles] = passagePolygons[0], passage: Shape = { outer: passageOuter as Point[], holes: passageHoles as Point[][] };
  const floor = floorHeight + .25, top = Math.min(floorHeight * 2 - .35, floor + 2.8);
  const landingPolygons = polygonClipping.difference([passage.outer], [building.outer, ...building.holes]);
  const rightNorth = terrace.outer[edge.length + 4], rightArc = terrace.outer[edge.length + 5], rightLength = Math.hypot(rightArc[0] - rightNorth[0], rightArc[1] - rightNorth[1]);
  const innerAxis: Point = [(rightArc[0] - rightNorth[0]) / rightLength, (rightArc[1] - rightNorth[1]) / rightLength];
  const doorStation = (65.6 - rightNorth[0]) * innerAxis[0] + (-31.5 - rightNorth[1]) * innerAxis[1] - 5, innerCenter = shifted(rightNorth, innerAxis, doorStation);
  const innerDoor = { center: innerCenter, from: shifted(innerCenter, innerAxis, -1.1), to: shifted(innerCenter, innerAxis, 1.1), inward: [-innerAxis[1], innerAxis[0]] as Point };
  return { innerDoor, center, from, to, axis, outward, width, route, passage, floor, top, landing, flightTop, bottom, flightAxis, flightNormal,
    landingFootprints: landingPolygons.map(([outer, ...holes]) => ({ outer: outer as Point[], holes: holes as Point[][] })),
    treads: straightStairTreads(flightTop, bottom, BASE + floor, BASE) };
}

// Open the recessed entrance, vestibule exit and separate auditorium doorway only on 2F.
// Ordinary facade glazing and the confirmed 5F art/glass walls remain separate.
function ordinaryTheatreWindows(building: Building, section: Section, height: number, floorHeight: number): ClassroomWindow[] {
  const config = section.classroomWindows ?? building.classroomWindows;
  const solids = (building.solidCores || []).filter(core => core.partId === section.id);
  const corridors = (building.floorCorridors || []).filter(corridor => corridor.partId === section.id);
  const stairs = (building.stairwells || []).filter(stair => stair.partId === section.id);
  const core = buildingCoreFootprint(section, building.groundPassages || [], corridors, stairs, solids, (building.cutouts || []).filter(cut => cut.partId === section.id));
  const groundOpenings = (building.groundPassages || []).map(passage => { const shape = passageShape(passage); return [shape.outer, ...shape.holes]; });
  const windows = config ? buildingSectionWindows(section, core, config, height, floorHeight, groundOpenings, solids.filter(core => !core.partition).map(core => [core.outer, ...core.holes])) : [];
  return windows;
}

export function theatreBodyWindows(building: Building, section: Section, height: number, floorHeight: number): ClassroomWindow[] {
  const windows = ordinaryTheatreWindows(building, section, height, floorHeight);
  // The imported east notch is narrower than one wall leaf. Its confirmed
  // pane straddles the adjoining main cap; clear that backing leaf as well.
  if ((section.id === 'main' || section.id === 'theatre-entry-vestibule') && building.classroomWindows) {
    const terrace = building.parts!.find(part => part.id === 'curved-terrace')!;
    const panes = buildingSectionWindows(terrace,
      [[terrace.outer, ...terrace.holes]], building.classroomWindows, Math.min(height, (terrace.floors ?? 4) * floorHeight), floorHeight);
    for (const pane of panes) if (polygonClipping.intersection(pane.cut, [section.outer, ...section.holes]).length) windows.push({
      ...pane, cut: [passageFootprint([pane.from, pane.to], .95).outer],
    });
  }
  const entrance = theatreEntranceLayout(building, floorHeight), top = Math.min(height, entrance.top);
  if ((section.id === 'main' || section.id === 'curved-terrace' || section.id === 'theatre-entry-vestibule') && top > entrance.floor) windows.push({
    from: entrance.from, to: entrance.to, cut: [entrance.passage.outer], bottom: entrance.floor, top,
  });
  if ((section.id === 'main' || section.id === 'curved-terrace') && top > entrance.floor) windows.push({ from: entrance.innerDoor.from, to: entrance.innerDoor.to, cut: [passageFootprint([entrance.innerDoor.from, entrance.innerDoor.to], .9).outer], bottom: entrance.floor, top });
  if (section.id === 'theatre-entry-vestibule' && height > entrance.floor) windows.push({
    from: entrance.from, to: entrance.to, cut: [section.outer, ...section.holes], bottom: entrance.floor, top: Math.min(height, 2 * floorHeight),
  });
  return windows;
}

// The small slanted return in front of the main door is now an open forecourt.
export function theatreFacadeWindows(building: Building, section: Section, height: number, floorHeight: number) {
  const forecourt = building.parts!.find(part => part.id === 'theatre-entry-vestibule')!;
  return ordinaryTheatreWindows(building, section, height, floorHeight).filter(pane =>
    pane.bottom < floorHeight || pane.bottom >= 2 * floorHeight || !polygonClipping.intersection(pane.cut, [forecourt.outer, ...forecourt.holes]).length);
}

export function theatreGlazingGeometry(building: Building, sections: Section[], floorHeight: number, cutawayHeight?: number) {
  const batches = sections.map(section => classroomGlazingGeometry(theatreFacadeWindows(building, section,
    Math.min(section.height, cutawayHeight ?? Infinity), floorHeight), section.classroomWindows ?? building.classroomWindows));
  return { glass: architectureBatch(batches.map(batch => batch.glass), false), frames: architectureBatch(batches.map(batch => batch.frames), false) };
}

export function theatreEntranceGeometry(building: Building, floorHeight: number, cutawayHeight?: number) {
  const layout = theatreEntranceLayout(building, floorHeight), shown = BASE + (cutawayHeight ?? Infinity);
  const concrete: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
  const point = (p: Point, y: number): [number, number, number] => [p[0], y, p[1]];
  const solid = (shape: Shape, low: number, high: number) => {
    high = Math.min(high, shown); if (high <= low) return;
    const geometry = buildingGeometry(shape, high - low, floorHeight); geometry.rotateX(-Math.PI / 2); geometry.translate(0, low, 0); concrete.push(geometry);
  };
  for (const shape of layout.landingFootprints) solid(shape, BASE + layout.floor - .2, BASE + layout.floor);
  for (const tread of layout.treads) solid(passageFootprint([tread.from, tread.to], layout.width), BASE, tread.height);
  const guard = (from: Point, to: Point, a: number, b: number) => {
    if (Math.min(a, b) >= shown) return;
    for (const rise of [.5, 1.05]) rails.push(architectureBar(point(from, Math.min(a + rise, shown)), point(to, Math.min(b + rise, shown)), .055));
    const count = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 1.8));
    for (let i = 0; i <= count; i++) {
      const p: Point = [from[0] + (to[0] - from[0]) * i / count, from[1] + (to[1] - from[1]) * i / count], y = a + (b - a) * i / count;
      rails.push(architectureBar(point(p, Math.min(y, shown)), point(p, Math.min(y + 1.075, shown)), .055));
    }
  };
  const edge = layout.landingFootprints.flatMap(shape => shape.outer.slice(1).map((to, i) => [shape.outer[i], to] as [Point, Point]));
  for (const [a, b] of edge) {
    // Do not fence the joint where the landing meets the open theatre exit.
    if (confirmedFacade(a, b, building.outer.slice(1).map((to, i) => ({ from: building.outer[i], to })))) continue;
    // The stair mouth stays open, while all other exposed landing sides close.
    const mid: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (Math.abs((mid[0] - layout.flightTop[0]) * layout.flightAxis[0] + (mid[1] - layout.flightTop[1]) * layout.flightAxis[1]) < .01) {
      const station = (p: Point) => (p[0] - layout.flightTop[0]) * layout.flightNormal[0] + (p[1] - layout.flightTop[1]) * layout.flightNormal[1];
      const left = shifted(layout.flightTop, layout.flightNormal, -layout.width / 2), right = shifted(layout.flightTop, layout.flightNormal, layout.width / 2);
      for (const p of [a, b]) if (station(p) < -layout.width / 2 - .01) guard(p, left, BASE + layout.floor, BASE + layout.floor);
      else if (station(p) > layout.width / 2 + .01) guard(right, p, BASE + layout.floor, BASE + layout.floor);
      continue;
    }
    guard(a, b, BASE + layout.floor, BASE + layout.floor);
  }
  for (const side of [-1, 1]) guard(shifted(layout.flightTop, layout.flightNormal, side * layout.width / 2), shifted(layout.bottom, layout.flightNormal, side * layout.width / 2), BASE + layout.floor, BASE);
  const doorBottom = BASE + layout.floor, doorTop = Math.min(BASE + layout.top, shown);
  if (doorTop > doorBottom) {
    const vertical = (p: Point, low: number, high: number, width = .065) => frames.push(architectureBar(point(p, low), point(p, high), width));
    for (const p of [layout.from, layout.center, layout.to]) vertical(p, doorBottom, doorTop);
    for (const y of [doorBottom, doorTop]) frames.push(architectureBar(point(layout.from, y), point(layout.to, y), .065));
    for (const p of [layout.innerDoor.from, layout.innerDoor.to]) vertical(p, doorBottom, doorTop);
    frames.push(architectureBar(point(layout.innerDoor.from, doorTop), point(layout.innerDoor.to, doorTop), .065));
    for (const side of [-1, 1]) {
      const center = shifted(layout.center, layout.axis, side * layout.width / 4), pane = new THREE.BoxGeometry(layout.width / 2 - .07, doorTop - doorBottom - .07, .04);
      pane.rotateY(-Math.atan2(layout.axis[1], layout.axis[0])); pane.translate(center[0], (doorTop + doorBottom) / 2, center[1]); glass.push(pane);
      if (doorTop - doorBottom > 1.3) vertical(shifted(shifted(layout.center, layout.axis, side * .13), layout.outward, .055), doorBottom + .85, doorBottom + 1.25, .025);
    }
  }
  return { concrete: architectureBatch(concrete), glass: architectureBatch(glass, false), frames: architectureBatch(frames, false), rails: architectureBatch(rails, false) };
}

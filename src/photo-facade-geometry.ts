import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import { cafeteriaLowerProfile, cafeteriaStairStrip, dormitoryProfile } from './facade-geometry.ts';
import { classroomWindowLayout } from './teaching-classrooms.ts';
import type { Building, BuildingPart, Point, Shape } from './types';

type Section = BuildingPart & { floors: number; height: number };
export const PHOTO_FACADE_COLORS = { stone: '#d4d1c7', accent: '#a87362', glass: '#8caeaf', frame: '#748786' };
type Kind = keyof typeof PHOTO_FACADE_COLORS;
const BASE = .12;

function reduceDetailLine(ring: Point[]): Point[] {
  if (ring.length <= 2) return ring;
  const a = ring[0], b = ring.at(-1)!, dx = b[0] - a[0], dz = b[1] - a[1], square = dx * dx + dz * dz;
  let maximum = .015, index = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const p = ring[i], t = square ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / square)) : 0;
    const distance = Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
    if (distance > maximum) { maximum = distance; index = i; }
  }
  if (index < 0) return [a, b];
  return [...reduceDetailLine(ring.slice(0, index + 1)).slice(0, -1), ...reduceDetailLine(ring.slice(index))];
}

function detailOutline(shape: Shape): Shape {
  // Millimetre-dense source splines are useful for the main silhouette but
  // every point need not start another cornice box. Approximate only these
  // shallow details to 15 mm, retaining the actual footprint for the body.
  const points = shape.outer.slice(0, -1);
  if (points.length < 5) return shape;
  const split = Math.floor(points.length / 2), first = reduceDetailLine(points.slice(0, split + 1)), second = reduceDetailLine([...points.slice(split), points[0]]);
  return { ...shape, outer: [...first.slice(0, -1), ...second] };
}

// The three retained anchors are the ends and centre chord of the approved
// rounded west stair bay. Fit its own circle so rooftop framing follows edits
// to the building instead of an independent fixed world-space coordinate.
export function teachingRoundCanopyAnchor(section: Section) {
  const [a, b, c] = [section.outer[12], section.outer[15], section.outer[18]];
  if (!a || !b || !c) return;
  const denominator = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(denominator) < 1e-6) return;
  const square = (p: Point) => p[0] ** 2 + p[1] ** 2;
  const center: Point = [
    (square(a) * (b[1] - c[1]) + square(b) * (c[1] - a[1]) + square(c) * (a[1] - b[1])) / denominator,
    (square(a) * (c[0] - b[0]) + square(b) * (a[0] - c[0]) + square(c) * (b[0] - a[0])) / denominator,
  ];
  const inner = Math.hypot(a[0] - center[0], a[1] - center[1]), chord = Math.hypot(c[0] - a[0], c[1] - a[1]);
  return { center, inner, radius: inner + 1.15, tangent: [(c[0] - a[0]) / chord, (c[1] - a[1]) / chord] as Point };
}

// Roof and sill measurements are estimated from the photographed repeated
// bays. All anchors come from the approved wall/part outlines, never a new box.
export function photoFacadeDetailGeometry(building: Building, sections: Section[], floorHeight: number, cutawayHeight?: number) {
  const parts: Record<Kind, THREE.BufferGeometry[]> = { stone: [], accent: [], glass: [], frame: [] };
  const append = (kind: Kind, geometry: THREE.BufferGeometry) => parts[kind].push(geometry);
  const bar = (kind: Kind, from: Point, to: Point, bottom: number, top: number, thickness: number, offset = .07, sign = 1) => {
    top = Math.min(top, BASE + (cutawayHeight ?? Infinity));
    if (top <= bottom || Math.hypot(to[0] - from[0], to[1] - from[1]) < 1e-5) return;
    const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz), n: Point = [dz / length * sign, -dx / length * sign];
    append(kind, new THREE.BoxGeometry(length, top - bottom, thickness).rotateY(-Math.atan2(dz, dx))
      .translate((from[0] + to[0]) / 2 + n[0] * offset, (bottom + top) / 2, (from[1] + to[1]) / 2 + n[1] * offset));
  };
  const band = (shape: Shape, y: number, thickness: number, depth = .14) => {
    shape = detailOutline(shape);
    const area = shape.outer.slice(1).reduce((sum, p, i) => sum + shape.outer[i][0] * p[1] - p[0] * shape.outer[i][1], 0), sign = area >= 0 ? 1 : -1;
    for (let i = 1; i < shape.outer.length; i++) bar('stone', shape.outer[i - 1], shape.outer[i], y, y + thickness, depth, depth / 2, sign);
  };
  const outlines = building.facade?.type === 'dormitory' ? [{ ...sections[0], ...dormitoryProfile(building).shape }]
    : building.facade?.type === 'cafeteria' ? [
      { ...sections[0], ...cafeteriaLowerProfile(building).shape, height: Math.min(sections[0].height, 2 * floorHeight) },
      { ...sections[0], bottom: 2 * floorHeight },
    ] : sections;
  const banded = building.facade?.type === 'dormitory' || building.facade?.type === 'cafeteria' || building.id === 'way/855459419' || building.id === 'way/1233313430';
  if (banded) for (const section of outlines) {
    const bottom = 'bottom' in section ? section.bottom as number : 0;
    for (let y = bottom + floorHeight; y <= Math.min(section.height, cutawayHeight ?? Infinity) + 1e-5; y += floorHeight) band(section, BASE + y - .25, .12);
    if (cutawayHeight === undefined) {
      // Double cornices and a low inset parapet give the observed stepped roof
      // silhouette while leaving the same footprint and floor heights intact.
      band(section, BASE + section.height - .18, .18, .42);
      band(section, BASE + section.height + .01, .32, .2);
    }
  }
  if (building.facade?.type === 'dormitory' && building.classroomWindows) {
    const shape = dormitoryProfile(building).shape;
    const visible = Math.min(sections[0].height, cutawayHeight ?? Infinity), area = shape.outer.slice(1).reduce((sum, p, i) => sum + shape.outer[i][0] * p[1] - p[0] * shape.outer[i][1], 0), sign = area >= 0 ? 1 : -1;
    const windows = classroomWindowLayout([[shape.outer, ...shape.holes]], building.classroomWindows, visible, floorHeight), groups: (typeof windows)[] = [];
    for (const window of windows) {
      const previous = groups.at(-1)?.at(-1);
      if (previous && previous.top === window.top && Math.hypot(previous.to[0] - window.from[0], previous.to[1] - window.from[1]) < .025) groups.at(-1)!.push(window);
      else groups.push([window]);
    }
    for (const group of groups) {
      // Red brick lintel caps seen in 000013410013 / DSC2479 / DSC2481.
      // Put them outside the wall, leaving the actual window aperture clear.
      const line = reduceDetailLine([group[0].from, ...group.map(window => window.to)]);
      for (let i = 1; i < line.length; i++) bar('accent', line[i - 1], line[i], BASE + group[0].top + .015, BASE + group[0].top + .22, .045, .18, sign);
    }
  }
  if (building.facade?.type === 'cafeteria') {
    const edge = 3, a = building.outer[edge], b = building.outer[edge + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const axis: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const area = building.outer.slice(1).reduce((sum, p, i) => sum + building.outer[i][0] * p[1] - p[0] * building.outer[i][1], 0), sign = area > 0 ? 1 : -1;
    const normal: Point = [axis[1] * sign, -axis[0] * sign];
    // The central stone arch and glazed stair strip are visible in the upward
    // entry photograph DJI_20231101172343_0047_D, not a guessed side entrance.
    const yLimit = BASE + (cutawayHeight ?? Infinity), half = Math.min(1.55, length * .3), spring = BASE + Math.min(2.2, floorHeight * .62);
    const arch = (h: number, bottom = BASE, springY = spring, rise = h * .6) => {
      const result = [new THREE.Vector2(-h, bottom), new THREE.Vector2(h, bottom)];
      for (let i = 0; i <= 24; i++) result.push(new THREE.Vector2(Math.cos(i * Math.PI / 24) * h, springY + Math.sin(i * Math.PI / 24) * rise));
      return result;
    };
    const transform = new THREE.Matrix4().makeBasis(new THREE.Vector3(axis[0], 0, axis[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(normal[0], 0, normal[1]));
    transform.setPosition((a[0] + b[0]) / 2 + normal[0] * .15, 0, (a[1] + b[1]) / 2 + normal[1] * .15);
    if (spring + (half + .23) * .6 <= yLimit) {
      const shape = new THREE.Shape(arch(half + .23)); shape.holes.push(new THREE.Path(arch(half)));
      append('stone', new THREE.ExtrudeGeometry(shape, { depth: .22, bevelEnabled: false }).applyMatrix4(transform));
    }
    const stair = cafeteriaStairStrip(building), base = BASE + 2 * floorHeight + .3, roof = BASE + sections[0].height;
    if (base < Math.min(roof - .7, yLimit)) {
      const upperSpring = roof - .7, upperHalf = stair.width / 2, at = (along: number): Point => [stair.center[0] + axis[0] * along, stair.center[1] + axis[1] * along];
      if (cutawayHeight === undefined) {
        const frame = new THREE.Shape(arch(upperHalf + .28, base - .08, upperSpring, upperHalf * .5 + .18));
        frame.holes.push(new THREE.Path(arch(upperHalf, base, upperSpring, upperHalf * .5)));
        append('stone', new THREE.ExtrudeGeometry(frame, { depth: .2, bevelEnabled: false }).applyMatrix4(transform));
      } else for (const side of [-1, 1]) bar('stone', at(side * (upperHalf + .02)), at(side * (upperHalf + .3)), base, Math.min(roof - .7, yLimit), .18, .17, sign);
      // Red brick window-between-floor panels flank the central light strip.
      for (let y = BASE + 3 * floorHeight; y < roof - .1; y += floorHeight) for (const side of [-1, 1]) {
        bar('accent', at(side * (upperHalf + .34)), at(side * (upperHalf + 1.3)), y - .3, y + .3, .07, .1, sign);
      }
    }
    if (cutawayHeight === undefined) {
      const center: Point = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], roof = BASE + sections[0].height;
      const left: Point = [center[0] - axis[0] * 2, center[1] - axis[1] * 2], right: Point = [center[0] + axis[0] * 2, center[1] + axis[1] * 2];
      bar('stone', left, right, roof + .32, roof + .75, .45, .16, sign);
    }
  }
  if (building.id === 'way/855459420' && cutawayHeight === undefined) {
    const wing = sections.find(section => section.id === 'sixth-floor-wing');
    const anchor = wing && teachingRoundCanopyAnchor(wing);
    if (wing && anchor) {
      // DSC2504 shows the round stair bay's broad radial canopy and hoop above
      // its glazing. The bay itself remains in its existing classroom footprint.
      const { center, inner, radius, tangent } = anchor, roof = BASE + wing.height;
      const annulus = new THREE.RingGeometry(inner, radius, 40).rotateX(-Math.PI / 2).translate(center[0], roof + .15, center[1]);
      append('glass', annulus);
      for (const r of [inner, radius]) append('stone', new THREE.TorusGeometry(r, .075, 4, 40).rotateX(Math.PI / 2).translate(center[0], roof + .18, center[1]));
      for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI / 8, point = (r: number): [number, number, number] => [center[0] + Math.cos(angle) * r, roof + .18, center[1] + Math.sin(angle) * r];
        append('stone', architectureBar(point(inner), point(radius), .075));
      }
      const hoop = new THREE.EllipseCurve(0, 0, inner, 1.3, 0, Math.PI, false, 0).getPoints(28)
        .map(point => new THREE.Vector3(center[0] + point.x * tangent[0], roof + .26 + point.y, center[1] + point.x * tangent[1]));
      for (let i = 1; i < hoop.length; i++) append('frame', architectureBar(hoop[i - 1].toArray(), hoop[i].toArray(), .055));
    }
  }
  return Object.fromEntries(Object.entries(parts).map(([kind, geometries]) => [kind, architectureBatch(geometries, false)])) as Record<Kind, THREE.BufferGeometry>;
}

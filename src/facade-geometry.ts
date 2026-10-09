import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingGeometry, passageShape, snapFootprint } from './building-geometry.ts';
import { classroomWindowLayout, type ClassroomWindow } from './teaching-classrooms.ts';
import type { Building, ClassroomWindows, Point, Shape } from './types';

export const FACADE_BASE = .12;
export const FACADE_COLORS = { glass: '#647b7e', frame: '#566663', stone: '#dddacb', metal: '#adb7ae', emblem: '#68766a' };
type Material = keyof typeof FACADE_COLORS;
type Edge = { from: Point; axis: Point; normal: Point; length: number; station: number };
type ProfilePoint = { point: Point; normal: Point; projecting: boolean; station: number };

function outline(building: Shape) {
  const ring = building.outer;
  return ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1] ? ring.slice(0, -1) : ring;
}
function edgesOf(ring: Point[]): Edge[] {
  const area = ring.reduce((sum, point, i) => sum + point[0] * ring[(i + 1) % ring.length][1] - ring[(i + 1) % ring.length][0] * point[1], 0);
  let station = 0;
  return ring.map((from, i) => {
    const to = ring[(i + 1) % ring.length], length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const axis: Point = [(to[0] - from[0]) / length, (to[1] - from[1]) / length], sign = area > 0 ? 1 : -1;
    const edge: Edge = { from, axis, normal: [axis[1] * sign, -axis[0] * sign], length, station };
    station += length;
    return edge;
  });
}
const shifted = (point: Point, direction: Point, distance: number): Point => [point[0] + direction[0] * distance, point[1] + direction[1] * distance];

// Blend both shoulders into the existing forward bay, keeping its centre and
// tangent so the entrance, plaque and observatory stay on the same facade.
export function dormitoryProfile(building: Building) {
  const ring = outline(building), edges = edgesOf(ring), model = building.facade!;
  if (!model.frontCurve || !model.entry) return { shape: building as Shape, curve: [] as Point[] };
  const { start, end } = model.frontCurve, first = edges[start.edge], last = edges[end.edge], middle = edges[model.entry.edge];
  const a = shifted(first.from, first.axis, first.length * start.at), b = shifted(last.from, last.axis, last.length * end.at);
  const center = shifted(middle.from, middle.axis, middle.length * model.entry.at);
  const left = Math.hypot(center[0] - a[0], center[1] - a[1]), right = Math.hypot(b[0] - center[0], b[1] - center[1]);
  const handle = Math.min(left, right) / 3;
  const curve: Point[] = [];
  const addCurve = (from: Point, c1: Point, c2: Point, to: Point, length: number) => {
    const count = Math.max(24, Math.ceil(length / .25));
    for (let i = curve.length ? 1 : 0; i <= count; i++) {
      const t = i / count, u = 1 - t;
      curve.push([u ** 3 * from[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * to[0], u ** 3 * from[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * to[1]]);
    }
  };
  addCurve(a, shifted(a, first.axis, left / 3), shifted(center, middle.axis, -handle), center, left);
  addCurve(center, shifted(center, middle.axis, handle), shifted(b, last.axis, -right / 3), b, right);
  const outer = [...ring.slice(0, start.edge + 1), ...curve, ...ring.slice(end.edge + 1)];
  outer.push(outer[0]);
  return { shape: { outer, holes: building.holes }, curve };
}

export function dormitoryObservatory(building: Building, floorHeight: number) {
  const entry=building.facade?.entry;
  if(!entry)return undefined;
  const edge=edgesOf(outline(building))[entry.edge];
  return {center:shifted(shifted(edge.from,edge.axis,edge.length*entry.at),edge.normal,-3.1),radius:floorHeight*.77,drumRise:floorHeight*.4};
}

const dormitoryDoorArch = (floorHeight: number) => ({ half: floorHeight * .42, bottom: .04, spring: floorHeight * .57, rise: floorHeight * .42 * .66 });

export function dormitoryBodyGeometry(building: Building, height: number, floorHeight: number, cutaway = false) {
  const { shape, curve } = dormitoryProfile(building);
  const observatory=!cutaway && height>=(building.floors??6)*floorHeight-.001?dormitoryObservatory(building,floorHeight):undefined;
  const config = building.classroomWindows;
  const windows = config && classroomWindowLayout([[shape.outer, ...shape.holes]], config, height, floorHeight,
    (building.groundPassages ?? []).map(passage => { const opening = passageShape(passage); return [opening.outer, ...opening.holes]; }));
  const entry = building.facade?.entry;
  if (windows && entry) {
    const edge = edgesOf(outline(building))[entry.edge], center = shifted(edge.from, edge.axis, edge.length * entry.at), arch = dormitoryDoorArch(floorHeight);
    // Use the same one-storey arch as the existing door pane. Thin stepped
    // cuts stay behind its stone surround, rather than opening a whole passage.
    const levels = [arch.bottom, arch.spring, ...Array.from({ length: 8 }, (_, i) => arch.spring + arch.rise * (i + 1) / 8)];
    for (let i = 0; i < levels.length - 1; i++) {
      const bottom = levels[i], top = Math.min(height, levels[i + 1]);
      if (top <= bottom) continue;
      const half = arch.half * Math.sqrt(1 - Math.max(0, (bottom - arch.spring) / arch.rise) ** 2);
      const from = shifted(center, edge.axis, -half), to = shifted(center, edge.axis, half), move = (point: Point, depth: number) => shifted(point, edge.normal, depth);
      windows.push({ from, to, bottom, top, cut: [[move(from, .2), move(to, .2), move(to, -config!.wallThickness - .3), move(from, -config!.wallThickness - .3), move(from, .2)]] });
    }
  }
  const body = buildingGeometry(shape, height, floorHeight, building.groundPassages, [], [], config, [], [], cutaway||!!observatory, windows);
  let geometry=body;
  if(observatory) {
    // The telescope room rises into the existing dome. A generic top-floor
    // slab and a solid plinth used to cut straight across that real cavity.
    const {center,radius}=observatory,opening=Array.from({length:48},(_,i):Point=>[center[0]+Math.cos(i*Math.PI/24)*(radius-.22),center[1]+Math.sin(i*Math.PI/24)*(radius-.22)]);opening.push(opening[0]);
    const roof=polygonClipping.difference(snapFootprint([[shape.outer,...shape.holes]]),snapFootprint([[opening]]));
    const plates=roof.map(([outer,...holes])=>{const slab=buildingGeometry({outer:outer as Point[],holes:holes as Point[][]},.25,floorHeight);slab.translate(0,0,height-.25);slab.deleteAttribute('uv');return slab;});
    geometry=mergeGeometries([body,...plates])!;
    geometry.userData.photoOcclusionMask=new Uint8Array([...body.userData.photoOcclusionMask,...plates.flatMap(plate=>Array(plate.attributes.position.count/3).fill(1))]);
    body.dispose();plates.forEach(plate=>plate.dispose());
  }
  return smoothSideNormals(geometry, shape, curve);
}

function smoothSideNormals(geometry: THREE.BufferGeometry, shape: Shape, points: Point[], maxHeight = Infinity) {
  if (!points.length) return geometry;
  const ring = outline(shape), edges = edgesOf(ring);
  const normals = points.map(point => {
    const i = ring.indexOf(point), previous = edges[(i + edges.length - 1) % edges.length], next = edges[i];
    const length = Math.hypot(previous.normal[0] + next.normal[0], previous.normal[1] + next.normal[1]);
    return { point, normal: [(previous.normal[0] + next.normal[0]) / length, (previous.normal[1] + next.normal[1]) / length] as Point };
  });
  const positions = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  for (let i = 0; i < positions.count; i++) {
    if (Math.abs(normal.getZ(i)) > .5 || positions.getZ(i) > maxHeight + 1e-5) continue;
    const sample = normals.find(({ point }) => Math.hypot(point[0] - positions.getX(i), point[1] + positions.getY(i)) < 1e-4);
    if (sample) normal.setXYZ(i, sample.normal[0], -sample.normal[1], 0);
  }
  return geometry;
}

// Only the lower two storeys acquire a curved, projecting bay. Rounding
// the lower perimeter lets the bay blend into the rear wall without a cap or
// acute corner. The upper storeys retain the original building shape.
export function cafeteriaLowerProfile(building: Building) {
  const ring = outline(building), edges = edgesOf(ring), bay = building.facade!.lowerBay!;
  const perimeter = edges.at(-1)!.station + edges.at(-1)!.length;
  const start = edges[bay.start.edge].station + edges[bay.start.edge].length * bay.start.at;
  const endStation = edges[bay.end.edge].station + edges[bay.end.edge].length * bay.end.at;
  const end = endStation <= start ? endStation + perimeter : endStation;
  const sign = edges[0].axis[1] * edges[0].normal[0] - edges[0].axis[0] * edges[0].normal[1];
  const corners = ring.map((point, i) => {
    const previous = edges[(i + edges.length - 1) % edges.length], next = edges[i];
    const radius = Math.min(3.2, previous.length * .25, next.length * .25);
    return { before: shifted(point, previous.axis, -radius), after: shifted(point, next.axis, radius), point, radius, station: next.station };
  });
  const samples: { point: Point; station: number }[] = [];
  const add = (point: Point, station: number) => samples.push({ point, station: (station + perimeter) % perimeter });
  for (let i = 0; i < ring.length; i++) {
    const corner = corners[i], next = corners[(i + 1) % ring.length], edge = edges[i];
    for (let j = 0; j < 12; j++) {
      const t = j / 12, u = 1 - t;
      add([u * u * corner.before[0] + 2 * u * t * corner.point[0] + t * t * corner.after[0], u * u * corner.before[1] + 2 * u * t * corner.point[1] + t * t * corner.after[1]], corner.station - corner.radius + 2 * corner.radius * t);
    }
    const from = edge.station + corner.radius, to = edge.station + edge.length - next.radius;
    const count = Math.max(1, Math.ceil((to - from) / .6));
    const stations = Array.from({ length: count }, (_, j) => from + (to - from) * j / count);
    for (const boundary of [start, end]) if (boundary > from && boundary < to) stations.push(boundary);
    stations.sort((a, b) => a - b);
    for (const station of stations.filter((s, j) => j === 0 || s - stations[j - 1] > 1e-7)) add(shifted(edge.from, edge.axis, station - edge.station), station);
  }
  // One curve spans the corner and the forward face. Keeping one set of
  // control points avoids a separate small fillet followed by a second bulge.
  const first = edges[bay.start.edge], last = edges[bay.end.edge];
  const a = shifted(first.from, first.axis, first.length * bay.start.at), b = shifted(last.from, last.axis, last.length * bay.end.at);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]), axis: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
  const outward: Point = [axis[1] * sign, -axis[0] * sign];
  // Equal handles preserve both adjoining wall tangents. Scale them to the
  // requested projection rather than adding another hump at the midpoint.
  let unitProjection = 0;
  for (let i = 1; i < 128; i++) {
    const t = i / 128, u = 1 - t;
    const offset: Point = [3 * u * u * t * first.axis[0] - 3 * u * t * t * last.axis[0], 3 * u * u * t * first.axis[1] - 3 * u * t * t * last.axis[1]];
    unitProjection = Math.max(unitProjection, offset[0] * outward[0] + offset[1] * outward[1]);
  }
  const handle = bay.projection / Math.max(unitProjection, 1e-6);
  const c1 = shifted(a, first.axis, handle), c2 = shifted(b, last.axis, -handle);
  const baySamples: { point: Point; station: number }[] = [];
  const count = Math.max(64, Math.ceil((length + handle * 2) / .2));
  let peak = a, maximumDepth = 0;
  for (let i = 0; i <= count; i++) {
    const t = i / count, u = 1 - t;
    const point: Point = [u ** 3 * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * b[0], u ** 3 * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * b[1]];
    const depth = (point[0] - a[0]) * outward[0] + (point[1] - a[1]) * outward[1];
    if (depth > maximumDepth) { maximumDepth = depth; peak = point; }
    baySamples.push({ point, station: start + (end - start) * t });
  }
  const remaining = samples.map(sample => ({ ...sample, station: sample.station < start ? sample.station + perimeter : sample.station }))
    .filter(sample => sample.station > end + 1e-8).sort((a, b) => a.station - b.station);
  const profile: ProfilePoint[] = [...baySamples.map(p => ({ ...p, normal: [0, 0] as Point, projecting: true })),
    ...remaining.map(p => ({ ...p, normal: [0, 0] as Point, projecting: false }))];
  for (let i = 0; i < profile.length; i++) {
    const a = profile[(i + profile.length - 1) % profile.length].point, b = profile[(i + 1) % profile.length].point;
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    profile[i].normal = [dz / length * sign, -dx / length * sign];
  }
  const outer = profile.map(p => p.point); outer.push(outer[0]);
  return { profile, shape: { outer, holes: building.holes }, start, end, peak };
}

export function cafeteriaLowerWindowsConfig(building: Building, floorHeight: number): ClassroomWindows | undefined {
  if (!building.classroomWindows) return undefined;
  // The photographed curtain wall is the projecting front curve only. Keep
  // its real profile chords so glass and wall apertures use identical faces.
  const front = cafeteriaLowerProfile(building).profile.filter(point => point.projecting).map(point => point.point);
  return { ...building.classroomWindows, facadeLines: [front], pierWidth: .08, bayWidth: 2.5, windowWidth: 2.42,
    columns: 1, sill: .2, top: floorHeight - .35, startFloor: 1, endFloor: 2 };
}

function flatCap(shape: Shape, height: number, downward: boolean) {
  const s = new THREE.Shape(shape.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  s.holes = shape.holes.map(r => new THREE.Path(r.map(([x, z]) => new THREE.Vector2(x, -z))));
  const indexed = new THREE.ShapeGeometry(s), geometry = indexed.toNonIndexed(); indexed.dispose();
  const position = geometry.getAttribute('position'), result: number[] = [];
  for (let i = 0; i < position.count; i += 3) for (const j of downward ? [2, 1, 0] : [0, 1, 2]) result.push(position.getX(i + j), position.getY(i + j), height);
  geometry.dispose(); return result;
}
const polygonArea = (ring: Point[]) => Math.abs(ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0)) / 2;

export function cafeteriaStairStrip(building: Building) {
  const edge = edgesOf(outline(building))[3], center = shifted(edge.from, edge.axis, edge.length / 2), width = Math.min(2.35, edge.length * .24);
  return { ...edge, center, width, from: shifted(center, edge.axis, -width / 2), to: shifted(center, edge.axis, width / 2) };
}

// Photo DJI_20231101172343_0047_D shows a central glazed stair strip above
// the entrance. Use this same layout for its holes and panes; decorative glass
// must not be pasted over an opaque masonry wall.
export function cafeteriaUpperWindows(building: Building, height: number, floorHeight: number): ClassroomWindow[] {
  const config = building.classroomWindows;
  if (!config || height <= .6) return [];
  const strip = cafeteriaStairStrip(building), normal = strip.normal.map(n => -n) as Point;
  const move = (p: Point, amount: number) => shifted(p, normal, amount);
  const cut = [[move(strip.from, -.04), move(strip.to, -.04), move(strip.to, config.wallThickness + .04), move(strip.from, config.wallThickness + .04), move(strip.from, -.04)]];
  const regular = classroomWindowLayout(snapFootprint([[building.outer, ...building.holes]]), config, height, floorHeight)
    .filter(window => !polygonClipping.intersection(window.cut, cut).length);
  const central: ClassroomWindow[] = [];
  for (let floor = 0; floor * floorHeight < height; floor++) {
    const bottom = floor * floorHeight + .3, top = Math.min((floor + 1) * floorHeight - .3, height - .3);
    if (top > bottom) central.push({ from: move(strip.from, config.wallThickness / 2), to: move(strip.to, config.wallThickness / 2), cut, bottom, top, mullions: [0, .5, 1] });
  }
  return [...regular, ...central];
}

export function cafeteriaBodyGeometry(building: Building, height: number, floorHeight: number, cutaway = false) {
  const lower = cafeteriaLowerProfile(building).shape, boundary = Math.min(height, 2 * floorHeight);
  const lowerWindows = cafeteriaLowerWindowsConfig(building, floorHeight);
  if (height <= boundary) return smoothSideNormals(buildingGeometry(lower, height, floorHeight, [], [], [], lowerWindows, [], [], cutaway), lower, outline(lower));
  const positions: number[] = [];
  const append = (shape: Shape, depth: number, bottom: number, skipBottom: boolean, skipTop: boolean, openTop = false) => {
    const geometry = buildingGeometry(shape, depth, floorHeight, [], [], [], shape === lower ? lowerWindows : building.classroomWindows, [], [], openTop,
      shape === lower ? undefined : cafeteriaUpperWindows(building, depth, floorHeight)), p = geometry.getAttribute('position');
    for (let i = 0; i < p.count; i += 3) {
      if (skipBottom && [0, 1, 2].every(j => Math.abs(p.getZ(i + j)) < 1e-5) || skipTop && [0, 1, 2].every(j => Math.abs(p.getZ(i + j) - depth) < 1e-5)) continue;
      for (let j = 0; j < 3; j++) positions.push(p.getX(i + j), p.getY(i + j), p.getZ(i + j) + bottom);
    }
    geometry.dispose();
  };
  append(lower, boundary, 0, false, true);
  append(building, height - boundary, boundary, true, false, cutaway);
  const original = snapFootprint([[building.outer, ...building.holes]])[0], rounded = snapFootprint([[lower.outer, ...lower.holes]])[0];
  for (const [outer, ...holes] of polygonClipping.difference(rounded, original)) if (polygonArea(outer) > 1e-6) positions.push(...flatCap({ outer, holes }, boundary, false));
  for (const [outer, ...holes] of polygonClipping.difference(original, rounded)) if (polygonArea(outer) > 1e-6) positions.push(...flatCap({ outer, holes }, boundary, true));
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals(); return smoothSideNormals(geometry, lower, outline(lower), boundary);
}

// Only the dormitory entry, plaque and observatory have local details. The
// cafeteria uses its body geometry alone, with no glass or facade frames.
export function facadeGeometry(building: Building, floors: number, floorHeight: number, visibleHeight = floors * floorHeight, cutaway = false) {
  const model = building.facade!, height = floors * floorHeight, top = FACADE_BASE + Math.min(height, visibleHeight);
  const complete = visibleHeight >= height - 1e-6, edges = edgesOf(outline(building));
  const vertices: Record<Material, number[]> = { glass: [], frame: [], stone: [], metal: [], emblem: [] };
  const append = (kind: Material, geometry: THREE.BufferGeometry, transform?: THREE.Matrix4) => {
    if (transform) geometry.applyMatrix4(transform);
    const p = geometry.getAttribute('position'), index = geometry.index;
    for (let i = 0; i < (index?.count ?? p.count); i++) {
      const j = index ? index.getX(i) : i;
      vertices[kind].push(p.getX(j), p.getY(j), p.getZ(j));
    }
    geometry.dispose();
  };
  const box = (kind: Material, center: [number, number, number], size: [number, number, number], axis: Point = [1, 0]) => {
    const matrix = new THREE.Matrix4().makeBasis(new THREE.Vector3(axis[0], 0, axis[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-axis[1], 0, axis[0]));
    matrix.setPosition(...center); append(kind, new THREE.BoxGeometry(...size), matrix);
  };
  const at = (edge: Edge, along: number, y: number, offset: number): [number, number, number] => [edge.from[0] + edge.axis[0] * along + edge.normal[0] * offset, y, edge.from[1] + edge.axis[1] * along + edge.normal[1] * offset];
  const panel = (kind: Material, edge: Edge, along: number, y: number, width: number, panelHeight: number, offset = .1, depth = .07) => box(kind, at(edge, along, y, offset), [width, panelHeight, depth], edge.axis);
  let dome: { center: Point; base: number; peak: number; radius: number } | undefined;
  let plaque: { center: [number, number, number]; width: number; height: number } | undefined;
  let crown: { line: Point[]; base: number; height: number; thickness: number } | undefined;

  if (model.type === 'dormitory' && model.entry) {
    const edge = edges[model.entry.edge], along = edge.length * model.entry.at;
    const arch = (half: number, base: number, spring: number) => {
      const points = [new THREE.Vector2(-half, base), new THREE.Vector2(half, base)];
      for (let i = 0; i <= 24; i++) {
        const theta = i * Math.PI / 24;
        points.push(new THREE.Vector2(Math.cos(theta) * half, spring + Math.sin(theta) * half * .66));
      }
      return points;
    };
    const opening = dormitoryDoorArch(floorHeight), inner = arch(opening.half, FACADE_BASE + opening.bottom, FACADE_BASE + opening.spring);
    const transform = new THREE.Matrix4().makeBasis(new THREE.Vector3(edge.axis[0], 0, edge.axis[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(edge.normal[0], 0, edge.normal[1]));
    transform.setPosition(...at(edge, along, 0, .08));
    const frame = new THREE.Shape(arch(floorHeight * .56, FACADE_BASE, FACADE_BASE + floorHeight * .59));
    frame.holes.push(new THREE.Path(inner));
    append('stone', new THREE.ExtrudeGeometry(frame, { depth: .18, bevelEnabled: false }), transform);
    const door = transform.clone(); door.setPosition(...at(edge, along, 0, .1));
    append('glass', new THREE.ShapeGeometry(new THREE.Shape(inner)), door);
    panel('frame', edge, along, FACADE_BASE + floorHeight * .34, .075, floorHeight * .65, .15, .045);
    if (complete && !cutaway) {
      // 000013410013 shows five ordinary rows above the ground arcade. The
      // opaque crest wall is a separate roof crown, not the sixth-storey wall.
      const { curve } = dormitoryProfile(building), path = curve.length ? curve : [edge.from, shifted(edge.from, edge.axis, edge.length)];
      const anchor = at(edge, along, 0, 0), stations = [0];
      for (let i = 1; i < path.length; i++) stations.push(stations[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
      const centerIndex = path.reduce((nearest, point, i) => Math.hypot(point[0] - anchor[0], point[1] - anchor[2]) < Math.hypot(path[nearest][0] - anchor[0], path[nearest][1] - anchor[2]) ? i : nearest, 0);
      const halfWidth = floorHeight * .77 * 1.9, start = stations[centerIndex] - halfWidth, end = stations[centerIndex] + halfWidth;
      const line = path.slice(1).flatMap((to, i) => {
        const first = Math.max(start, stations[i]), last = Math.min(end, stations[i + 1]);
        if (last <= first) return [];
        const length = stations[i + 1] - stations[i], direction: Point = [(to[0] - path[i][0]) / length, (to[1] - path[i][1]) / length];
        return [shifted(path[i], direction, first - stations[i]), shifted(path[i], direction, last - stations[i])];
      }).filter((point, i, points) => !i || Math.hypot(point[0] - points[i - 1][0], point[1] - points[i - 1][1]) > 1e-6);
      const sign = edge.axis[1] * edge.normal[0] - edge.axis[0] * edge.normal[1], thickness = .28, rise = floorHeight * .42;
      const inner = line.map((point, i) => {
        const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return shifted(point, [(b[1] - a[1]) / length * sign, -(b[0] - a[0]) / length * sign], -thickness);
      });
      const outer = [...line, ...inner.reverse(), line[0]];
      append('stone', buildingGeometry({ outer, holes: [] }, rise, floorHeight).rotateX(-Math.PI / 2).translate(0, top, 0));
      crown = { line, base: top, height: rise, thickness };
      const plaqueHeight = floorHeight * .5, plaqueWidth = floorHeight * .4, plaqueY = top + floorHeight * .53;
      // The taller central crest has masonry behind its whole height, joined
      // to the roof and curved crown; its upper half must not float in the air.
      const backingTop = plaqueY + plaqueHeight / 2 + .11;
      panel('stone', edge, along, (top + backingTop) / 2, plaqueWidth + .22, backingTop - top, -.1, .32);
      panel('stone', edge, along, plaqueY, plaqueWidth + .22, plaqueHeight + .22, .12, .18);
      panel('metal', edge, along, plaqueY, plaqueWidth, plaqueHeight, .23, .06);
      panel('stone', edge, along, plaqueY, plaqueWidth - .16, plaqueHeight - .16, .27, .04);
      const shield = new THREE.Shape();
      shield.moveTo(-.34 * plaqueWidth, .28 * plaqueHeight); shield.lineTo(.34 * plaqueWidth, .28 * plaqueHeight);
      shield.lineTo(.31 * plaqueWidth, -.08 * plaqueHeight);
      shield.quadraticCurveTo(.26 * plaqueWidth, -.26 * plaqueHeight, 0, -.36 * plaqueHeight);
      shield.quadraticCurveTo(-.26 * plaqueWidth, -.26 * plaqueHeight, -.31 * plaqueWidth, -.08 * plaqueHeight); shield.closePath();
      const crest = new THREE.Matrix4().makeBasis(new THREE.Vector3(edge.axis[0], 0, edge.axis[1]), new THREE.Vector3(0, 1, 0), new THREE.Vector3(edge.normal[0], 0, edge.normal[1]));
      crest.setPosition(...at(edge, along, plaqueY, .3));
      append('emblem', new THREE.ExtrudeGeometry(shield, { depth: .035, bevelEnabled: false, curveSegments: 12 }), crest);
      panel('stone', edge, along, plaqueY + plaqueHeight * .03, plaqueWidth * .38, plaqueHeight * .045, .35, .02);
      panel('stone', edge, along, plaqueY - plaqueHeight * .11, plaqueWidth * .28, plaqueHeight * .045, .35, .02);
      plaque = { center: at(edge, along, plaqueY, .3), width: plaqueWidth + .22, height: plaqueHeight + .22 };
      if (!cutaway) {
        const center = at(edge, along, 0, -3.1), radius = floorHeight * .77;
        const base = top + floorHeight * .4 + .01, domeRise = floorHeight * .73;
        const drum=new THREE.Shape(Array.from({length:49},(_,i)=>new THREE.Vector2(Math.cos(i*Math.PI/24)*radius,Math.sin(i*Math.PI/24)*radius)));
        drum.holes.push(new THREE.Path(Array.from({length:49},(_,i)=>new THREE.Vector2(Math.cos(-i*Math.PI/24)*(radius-.22),Math.sin(-i*Math.PI/24)*(radius-.22)))));
        const support=new THREE.ExtrudeGeometry(drum,{depth:floorHeight*.4+.01,bevelEnabled:false});support.rotateX(-Math.PI/2);support.translate(center[0],top,center[2]);append('stone',support);
        const sphere = new THREE.SphereGeometry(radius, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
        sphere.scale(1, domeRise / radius, 1); sphere.translate(center[0], base, center[2]); append('stone', sphere);
        for (let i = 0; i < 20; i++) {
          const theta = i * Math.PI / 10;
          const curve = new THREE.CurvePath<THREE.Vector3>();
          for (let j = 0; j < 12; j++) {
            const p = (s: number) => new THREE.Vector3(center[0] + (radius + .025) * Math.sin(s) * Math.cos(theta), base + domeRise * Math.cos(s) + .025, center[2] + (radius + .025) * Math.sin(s) * Math.sin(theta));
            curve.add(new THREE.LineCurve3(p(j * Math.PI / 24), p((j + 1) * Math.PI / 24)));
          }
          append('metal', new THREE.TubeGeometry(curve, 24, .023, 4, false));
        }
        dome = { center: [center[0], center[2]], base, peak: base + domeRise + .05, radius };
      }
    }
  }
  const geometries = Object.entries(vertices).filter(([, p]) => p.length).map(([kind, positions]) => {
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere(); return { kind: kind as Material, geometry };
  });
  return { geometries, dome, plaque, crown, height, visibleHeight: Math.min(height, visibleHeight) };
}

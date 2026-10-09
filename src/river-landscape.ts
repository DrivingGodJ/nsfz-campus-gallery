import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { passageFootprint } from './underground-geometry.ts';
import type { Feature, Point, Shape } from './types';

export const RIVER_IDS = ['way/1277839749', 'way/1277839748', 'local/lake-water-link'];
export const RIVER_COLORS = { bank: '#a6a18e', rock: '#7e8274', paths: '#b3a58c', timber: '#795e46', stone: '#c4bdab', leaves: '#648064', shrubs: '#67805e' };
const BASE = .12;
const inside = (point: Point, ring: Point[]) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i][1] > point[1]) !== (ring[j][1] > point[1]) && point[0] < (ring[j][0] - ring[i][0]) * (point[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
  }
  return hit;
};
const merge = (parts: THREE.BufferGeometry[]) => {
  const plain = parts.map(part => { const geometry = part.index ? part.toNonIndexed() : part.clone(); geometry.deleteAttribute('uv'); return geometry; });
  const geometry = plain.length ? mergeGeometries(plain)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
  geometry.userData.photoOcclusionMask = new Uint8Array(geometry.getAttribute('position').count / 3);
  return geometry;
};
export function riverWaterFootprints(features: Feature[]): Shape[] {
  const waters = features.filter(feature => RIVER_IDS.includes(feature.id) && feature.outer);
  if (!waters.length) return [];
  const [first, ...rest] = waters.map(feature => [feature.outer!, ...(feature.holes ?? [])]);
  return polygonClipping.union(first, ...rest).map(polygon => ({ outer: polygon[0], holes: polygon.slice(1) }));
}
// The OSM water outlines are retained. Join them before tracing banks so the
// small water link never gains a false stone dam at its internal seam.
export function riverBankSamples(features: Feature[], spacing = 1.35) {
  const samples: { position: Point; normal: Point; distance: number }[] = [];
  for (const footprint of riverWaterFootprints(features)) {
    const ring = footprint.outer, area = ring.slice(1).reduce((sum, p, i) => sum + ring[i][0] * p[1] - p[0] * ring[i][1], 0);
    let walked = 0, next = spacing / 2;
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < 1e-7) continue;
      const u: Point = [(b[0] - a[0]) / length, (b[1] - a[1]) / length], normal: Point = area > 0 ? [u[1], -u[0]] : [-u[1], u[0]];
      while (next <= walked + length) {
        const t = (next - walked) / length;
        samples.push({ position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], normal, distance: next }); next += spacing;
      }
      walked += length;
    }
  }
  return samples;
}
export function riverLandscapeGeometry(features: Feature[], buildings: Shape[] = []) {
  const parts = Object.fromEntries(Object.keys(RIVER_COLORS).map(key => [key, [] as THREE.BufferGeometry[]])) as Record<keyof typeof RIVER_COLORS, THREE.BufferGeometry[]>;
  const waters = riverWaterFootprints(features), roads = features.filter(feature => ['path', 'bridge'].includes(feature.type) && feature.points).map(feature => passageFootprint(feature.points!, feature.width ?? 2));
  const onLand = (point: Point) => !waters.some(water => inside(point, water.outer)) && !buildings.some(building => inside(point, building.outer)) && !roads.some(road => inside(point, road.outer));
  const box = (key: keyof typeof parts, size: [number, number, number], position: [number, number, number], angle = 0) => parts[key].push(new THREE.BoxGeometry(...size).rotateY(angle).translate(...position));
  const shrub = (position: Point, seed: number) => {
    for (let i = 0; i < 3; i++) parts.shrubs.push(new THREE.IcosahedronGeometry(1, 0).scale(.5 + seed % 3 * .12, .42 + (seed % 2) * .12, .45)
      .translate(position[0] + Math.cos(i * 2.1) * .3, BASE + .42, position[1] + Math.sin(i * 2.1) * .3));
  };
  for (const [i, sample] of riverBankSamples(features).entries()) {
    const { position: p, normal: n } = sample;
    const bank: Point = [p[0] + n[0] * .26, p[1] + n[1] * .26];
    if (!onLand(bank)) continue;
    // DSC06898 / IMG_9803: irregular rounded stones rather than a canal wall.
    const size = .38 + Math.abs(Math.sin(i * 8.13)) * .37;
    parts.rock.push(new THREE.IcosahedronGeometry(1, 1).scale(size, .24 + size * .24, size * .75).rotateY(i * .73).translate(bank[0], .15, bank[1]));
    const soil: Point = [p[0] + n[0] * .6, p[1] + n[1] * .6];
    if (onLand(soil)) box('bank', [1.4, .07, .55], [soil[0], .09, soil[1]], -Math.atan2(-n[0], n[1]));
    if (i % 5 === 0) {
      const plant: Point = [p[0] + n[0] * .8, p[1] + n[1] * .8];
      if (onLand(plant)) shrub(plant, i);
    }
    // IMG_9799 / IMG_9803: clumps of upright broad water leaves along the bank.
    if (i % 3 === 0) for (let j = 0; j < 7; j++) {
      const angle = j * Math.PI * 2 / 7 + i, height = .8 + (j % 3) * .18, width = .14 + (j % 2) * .04;
      const center: Point = [p[0] - n[0] * .12 + Math.cos(angle) * .22, p[1] - n[1] * .12 + Math.sin(angle) * .22];
      // Leaf blade creases into two halves; no alpha textures or extra meshes.
      const leaf = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([
        0,0,0, -.5*width,.55*height,.02, 0,.6*height,.08,
        0,0,0, 0,.6*height,.08, .5*width,.55*height,.02,
        -.5*width,.55*height,.02, 0,height,.18, 0,.6*height,.08,
        0,.6*height,.08, 0,height,.18, .5*width,.55*height,.02,
      ],3)); leaf.computeVertexNormals(); leaf.rotateY(angle).translate(center[0], BASE, center[1]); parts.leaves.push(leaf);
    }
  }
  // Small garden paths and the seats surrounding the old tree are visible in
  // _DSC2471 / _DSC1493; only this photographed northern bank gets furniture.
  const gardenPaths: Point[][] = [
    [[57.7, 30.3], [61.2, 24.6], [63.4, 18.1], [67, 12.6], [72, 9.1], [77.7, 6.7]],
    [[66.1, 16.1], [70.2, 14.2], [74.7, 14.3], [79.4, 14.4]],
    [[91, 10.9], [99.2, 9.8], [109.6, 7.6], [119.3, 5.5]],
  ];
  const excluded = [...waters, ...buildings, ...roads].map(shape => [shape.outer, ...shape.holes]);
  for (const route of gardenPaths) {
    const points = new THREE.CatmullRomCurve3(route.map(([x,z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal').getSpacedPoints(route.length * 5).map(p => [p.x,p.z] as Point);
    const footprint = passageFootprint(points, 1.2);
    for (const polygon of polygonClipping.difference([footprint.outer], ...excluded)) {
      const shape = new THREE.Shape(polygon[0].map(([x,z]) => new THREE.Vector2(x,-z))); shape.holes = polygon.slice(1).map(ring => new THREE.Path(ring.map(([x,z]) => new THREE.Vector2(x,-z))));
      parts.paths.push(new THREE.ShapeGeometry(shape).rotateX(-Math.PI/2).translate(0,.126,0));
    }
  }
  for (const center of [[68.65, 9.35], [102.6, 8.1]] as Point[]) {
    for (const side of [-1,1]) {
      // Benches on opposite sides of the tree, with open approaches between.
      const x = center[0], z = center[1] + side * 1.85;
      if (!onLand([x,z])) continue;
      for (let plank = 0; plank < 3; plank++) box('timber', [3.25,.07,.16], [x,.49,z+(plank-1)*.19]);
      for (const dx of [-1.3,1.3]) box('stone', [.28,.44,.58], [x+dx,.25,z]);
    }
  }
  // The low bridge edge in DSC03644 is a single broad timber beam, not a fence.
  const crossing = features.find(feature => feature.id === 'local/lake-bridge');
  if (crossing?.points) {
    const a = crossing.points[0], b = crossing.points.at(-1)!, length = Math.hypot(b[0]-a[0],b[1]-a[1]), u: Point = [(b[0]-a[0])/length,(b[1]-a[1])/length], n: Point = [-u[1],u[0]], angle = -Math.atan2(u[1],u[0]);
    for (const side of [-1,1]) {
      const offset = (crossing.width ?? 4)/2+.02, mid: Point = [(a[0]+b[0])/2+n[0]*side*offset,(a[1]+b[1])/2+n[1]*side*offset];
      box('timber',[length,.12,.16],[mid[0],.72,mid[1]],angle);
      for (let at = 0; at <= length; at += 2.6) box('timber',[.12,.68,.12],[a[0]+u[0]*at+n[0]*side*offset,.38,a[1]+u[1]*at+n[1]*side*offset]);
    }
  }
  return Object.fromEntries(Object.entries(parts).map(([key, geometry]) => [key, merge(geometry)])) as Record<keyof typeof RIVER_COLORS, THREE.BufferGeometry>;
}

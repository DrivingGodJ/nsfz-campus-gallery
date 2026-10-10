import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { passageFootprint } from './underground-geometry.ts';
import type { Feature, Point } from './types';

const BASE = .12, PATH_WIDTH = 1.15;
const routes: Point[][] = [
  [[116.9, 67.22], [116.9, 69], [115.5, 74.8], [118.1, 80.6], [125, 82.4], [132, 79.9], [138.3, 73.4], [142.5, 70.7]],
  [[118.1, 80.6], [112.8, 85.2], [109.8, 91], [107.8, 99.3]],
  [[125, 82.4], [127.8, 88.2], [125.1, 96.4], [121, 101.2]],
];
const lamps: Point[] = [[118.45, 68.2], [114.1, 71.9], [117.7, 77.1], [121.9, 83.7], [128.9, 80.3], [133.4, 77], [139.5, 72.8], [111.5, 87.9], [129, 90.2]];
const rocks: [number, number, number, number][] = [[122.8, 77.8, 1.25, 1.3], [130.2, 74.4, 1.45, .65], [110.9, 83.2, 1, .7], [125.1, 91.3, 1.2, .9], [139.8, 79.8, .8, .6]];
const planting: Point[] = [[120.8, 75.4], [123.5, 77.1], [128.3, 74], [135.3, 82.1], [139.9, 78.5], [113.6, 88.7], [129.1, 92.8], [118.1, 93.7], [103.2, 82.2], [105.7, 97.3]];

const merge = (parts: THREE.BufferGeometry[]) => {
  const geometry = parts.length ? mergeGeometries(parts)! : new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
  parts.forEach(part => part.dispose()); return geometry;
};

export function specimenPaths() {
  return routes.map(route => new THREE.CatmullRomCurve3(route.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal')
    .getSpacedPoints(route.length * 7).map(point => [point.x, point.z] as Point));
}

const inside = (point: Point, ring: Point[]) => {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    if ((ring[i][1] > point[1]) !== (ring[j][1] > point[1]) && point[0] < (ring[j][0] - ring[i][0]) * (point[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) hit = !hit;
  }
  return hit;
};
const distance = (point: Point, paths: Point[][]) => Math.min(...paths.flatMap(path => path.slice(1).map((to, i) => {
  const from = path[i], dx = to[0] - from[0], dz = to[1] - from[1];
  const t = Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(point[0] - from[0] - dx * t, point[1] - from[1] - dz * t);
})));

// The supplied grove positions were an estimated grid. Move only trunks crossing
// the photographed narrow paths; avenue data and calibrated photo positions stay fixed.
export function specimenTrees(feature: Feature) {
  const paths = specimenPaths();
  return feature.trees?.map(tree => {
    if (distance(tree.position, paths) > PATH_WIDTH / 2 + .45) return tree;
    const candidates = Array.from({ length: 16 }, (_, i): Point => [tree.position[0] + Math.cos(i * Math.PI / 8) * 1.65, tree.position[1] + Math.sin(i * Math.PI / 8) * 1.65])
      .filter(point => inside(point, feature.outer!) && distance(point, paths) > PATH_WIDTH / 2 + .45);
    return candidates.length ? { ...tree, position: candidates.sort((a, b) => distance(b, paths) - distance(a, paths))[0] } : tree;
  });
}

export function specimenGroveGeometry(feature: Feature) {
  const parts = { paths: [] as THREE.BufferGeometry[], edging: [] as THREE.BufferGeometry[], stone: [] as THREE.BufferGeometry[], metal: [] as THREE.BufferGeometry[], fitness: [] as THREE.BufferGeometry[], lattice: [] as THREE.BufferGeometry[], plants: [] as THREE.BufferGeometry[], lamps: [] as THREE.BufferGeometry[] };
  const box = (key: keyof typeof parts, size: [number, number, number], position: [number, number, number]) => parts[key].push(new THREE.BoxGeometry(size[0], size[1], size[2]).translate(...position));
  const bar = (key: keyof typeof parts, from: [number, number, number], to: [number, number, number], radius: number) => {
    const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), vector = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(radius, radius, vector.length(), 6);
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vector.normalize()));
    geometry.translate(...a.add(b).multiplyScalar(.5).toArray()); parts[key].push(geometry);
  };
  const pathShapes = (width: number) => {
    const [first, ...rest] = specimenPaths().map(path => [passageFootprint(path, width).outer]);
    return polygonClipping.intersection(polygonClipping.union(first, ...rest), [feature.outer!]);
  };
  for (const [key, width, y] of [['edging', PATH_WIDTH + .2, BASE - .005], ['paths', PATH_WIDTH, BASE + .003]] as const) {
    for (const polygon of pathShapes(width)) {
      const shape = new THREE.Shape(polygon[0].map(([x, z]) => new THREE.Vector2(x, -z)));
      shape.holes = polygon.slice(1).map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
      parts[key].push(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, y, 0));
    }
  }
  for (const [x, z] of lamps) {
    box('metal', [.38, .05, .38], [x, BASE + .5, z]); box('metal', [.38, .05, .38], [x, BASE + .025, z]);
    box('lamps', [.32, .43, .32], [x, BASE + .26, z]);
    for (const dx of [-.155, .155]) for (const dz of [-.155, .155]) box('metal', [.025, .47, .025], [x + dx, BASE + .26, z + dz]);
  }
  // DSC06142 and the marked row: three bars share a line in the clearing east of the grove.
  const barScale = 1.15;
  for (let i = 0; i < 3; i++) {
    const z = 66.25 + i * 2.55 * barScale, top = BASE + (2.1 + (i % 2) * .2) * barScale;
    for (const end of [z, z + 2.2 * barScale]) bar('fitness', [147, BASE, end], [147, top, end], .065 * barScale);
    bar('fitness', [147, top, z], [147, top, z + 2.2 * barScale], .048 * barScale);
  }
  // DSC2434: a low, open orange lattice enclosure, rather than a solid hut.
  const fence: Point[] = [[116.6, 84.4], [120.4, 84.4], [120.4, 86.9], [116.6, 86.9], [116.6, 84.4]];
  for (let i = 1; i < fence.length; i++) {
    const from = fence[i - 1], to = fence[i], length = Math.hypot(to[0] - from[0], to[1] - from[1]), count = Math.ceil(length / .55);
    for (const y of [.42, .95, 1.5]) bar('lattice', [from[0], BASE + y, from[1]], [to[0], BASE + y, to[1]], .032);
    for (let j = 0; j <= count; j++) {
      const x = from[0] + (to[0] - from[0]) * j / count, z = from[1] + (to[1] - from[1]) * j / count;
      bar('lattice', [x, BASE, z], [x, BASE + 1.5, z], .036);
    }
  }
  for (const [i, [x, z, radius, height]] of rocks.entries()) {
    const geometry = new THREE.IcosahedronGeometry(1, 1), positions = geometry.getAttribute('position');
    for (let j = 0; j < positions.count; j++) {
      const px = positions.getX(j), py = positions.getY(j), pz = positions.getZ(j);
      const scale = .85 + Math.sin(px * 4.2 + pz * 5.3 + i) * .15;
      positions.setXYZ(j, px * scale * radius, (py + 1) * height / 2, pz * scale * radius * .7);
    }
    geometry.computeVertexNormals(); geometry.translate(x, BASE, z); parts.stone.push(geometry);
  }
  for (const [i, [x, z]] of planting.entries()) for (let n = 0; n < 3; n++) {
    const angle = n * Math.PI * 2 / 3 + i, height = .3 + (i % 3) * .08;
    parts.plants.push(new THREE.IcosahedronGeometry(1, 1).scale(.65, height, .5)
      .translate(x + Math.cos(angle) * .35, BASE + height, z + Math.sin(angle) * .35));
  }
  return Object.fromEntries(Object.entries(parts).map(([key, geometries]) => [key, merge(geometries)])) as Record<keyof typeof parts, THREE.BufferGeometry>;
}

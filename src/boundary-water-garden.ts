import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import type { Feature, Point } from './types';

export const BOUNDARY_WATER_COLORS = {
  water: '#244b42', stone: '#858779', lightStone: '#a2a192', wetRock: '#515d51',
  bamboo: '#586b45', nodes: '#80916c', leaves: '#42634c', fall: '#b9d1ce', foam: '#e2eeeb',
};
type Vector = [number, number, number];

// DSC06618 / DSC06872: a small rock-backed cascade and rounded pool stones.
// Only the photographed north/east bamboo bank is planted; the viewing side stays open.
export function boundaryWaterGardenGeometry(feature: Feature) {
  const parts = Object.fromEntries(Object.keys(BOUNDARY_WATER_COLORS).map(key => [key, [] as THREE.BufferGeometry[]])) as Record<keyof typeof BOUNDARY_WATER_COLORS, THREE.BufferGeometry[]>;
  const surface = (positions: number[]) => {
    const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals(); return geometry;
  };
  const random = (i: number) => { const value = Math.sin(i * 12.9898 + 7.13) * 43758.5453; return value - Math.floor(value); };
  const stone = (key: 'stone' | 'lightStone' | 'wetRock', p: Vector, size: Vector, seed: number) =>
    parts[key].push(new THREE.IcosahedronGeometry(1, 1).scale(...size).rotateY(seed * .73).translate(...p));
  const ring = feature.outer, cascade = feature.waterfall;
  if (ring?.length && cascade) {
    const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = (feature.holes ?? []).map(hole => new THREE.Path(hole.map(([x, z]) => new THREE.Vector2(x, -z))));
    parts.water.push(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2).translate(0, .13, 0));

    const edgeLengths = ring.slice(1).map((p, i) => Math.hypot(p[0] - ring[i][0], p[1] - ring[i][1]));
    const perimeter = edgeLengths.reduce((sum, length) => sum + length, 0), spacing = Math.max(.87, perimeter / 56);
    const minX = Math.min(...ring.map(p => p[0])), maxX = Math.max(...ring.map(p => p[0]));
    let walked = 0, next = spacing / 2, index = 0;
    for (let edge = 0; edge < edgeLengths.length; edge++) {
      const a = ring[edge], b = ring[edge + 1], length = edgeLengths[edge];
      while (length > 1e-8 && next < walked + length) {
        const t = (next - walked) / length;
        const p: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        const radius = p[0] < minX + (maxX - minX) * .28 ? .56 + random(index) * .12 : .36 + random(index) * .18;
        stone(index % 3 === 0 ? 'lightStone' : 'stone', [p[0], .29, p[1]], [radius, .3 + radius * .28, radius * (.8 + random(index + 23) * .28)], index++);
        next += spacing;
      }
      walked += length;
    }

    const [cx, cz] = cascade.center, length = Math.hypot(...cascade.axis) || 1;
    const forward: Point = [cascade.axis[0] / length, cascade.axis[1] / length], across: Point = [-forward[1], forward[0]];
    const height = cascade.height, width = cascade.width;
    const at = (u: number, y: number, v: number): Vector => [cx + across[0] * u + forward[0] * v, y, cz + across[1] * u + forward[1] * v];
    // Low-poly boulders make a narrow, irregular stone face behind the water,
    // rather than a broad architectural wall or a second lake.
    const rows = Math.max(2, Math.min(12, Math.ceil(height / .57)));
    for (let row = 0; row < rows; row++) for (let column = -1; column <= 1; column++) {
      const r = .36 + random(row * 3 + column + 74) * .12;
      stone('wetRock', at(column * width * .55 + (row % 2) * .07, .26 + row * (height - .18) / rows, -.2 - random(row + column + 91) * .16),
        [r, .4 + random(row + 5) * .12, r * .8], row * 3 + column + 74);
    }
    stone('wetRock', at(0, height - .1, -.16), [width * .69, .23, .43], 101);
    stone('wetRock', at(.22, .26, .72), [.46, .24, .34], 102);
    const ledge = height * .38;
    // Align the shallow shelf across the flow. Its front edge ends before the
    // joined ribbons, so the second drop does not disappear inside a boulder.
    parts.wetRock.push(new THREE.IcosahedronGeometry(1, 1).scale(width * .84, .16, .25)
      .rotateY(-Math.atan2(across[1], across[0])).translate(...at(.06, ledge - .1, .45)));

    const ribbon = (offset: number, ribbonWidth: number, advance: number) => {
      const stages = [
        [at(offset, height + .02, -.1 + advance), at(offset - .025, height * .71, .03 + advance),
          at(offset + .025, ledge + .2, .35 + advance), at(offset, ledge + .12, .73 + advance)],
        [at(offset, ledge + .12, .73 + advance), at(offset + .02, ledge * .64, .84 + advance),
          at(offset - .02, .29, .9 + advance), at(offset, .15, 1.2 + advance)],
      ];
      const vertices: number[] = [], segments = 12;
      for (const stage of stages) {
        const curve = new THREE.CatmullRomCurve3(stage.map(p => new THREE.Vector3(...p)), false, 'centripetal');
        for (let i = 0; i < segments; i++) {
          const a = curve.getPoint(i / segments), b = curve.getPoint((i + 1) / segments);
          const half = ribbonWidth * (.48 + .1 * Math.sin(i * 1.7)), n = new THREE.Vector3(across[0], 0, across[1]).multiplyScalar(half);
          vertices.push(...a.clone().sub(n).toArray(), ...b.clone().sub(n).toArray(), ...b.clone().add(n).toArray(),
            ...a.clone().sub(n).toArray(), ...b.clone().add(n).toArray(), ...a.clone().add(n).toArray());
        }
      }
      return surface(vertices);
    };
    parts.fall.push(ribbon(0, width, 0));
    for (let i = 0; i < 5; i++) parts.foam.push(ribbon((i - 2) * width / 6, width * (.06 + random(i + 134) * .05), .018));
    // A few thin splash arcs at the basin remain static: no frame loop or particles.
    for (let i = 0; i < 4; i++) {
      const p = at(0, .151 + i * .002, 1.16 + i * .14);
      parts.foam.push(new THREE.TorusGeometry(.19 + i * .14, .009, 3, 16, Math.PI * 1.35).rotateX(-Math.PI / 2)
        .scale(1.15, 1, .62).rotateY(i * 1.24).translate(...p));
    }

    for (const [clump, root] of cascade.bamboo.slice(0, 12).entries()) for (let stalk = 0; stalk < 3; stalk++) {
      const seed = clump * 3 + stalk, angle = seed * 2.399, tall = 4.2 + random(seed + 200) * 1.3;
      const base = new THREE.Vector3(root[0] + Math.cos(angle) * .18, .12, root[1] + Math.sin(angle) * .18);
      const lean = new THREE.Vector3(Math.cos(angle) * .24, tall, Math.sin(angle) * .24), tip = base.clone().add(lean);
      const direction = tip.clone().sub(base), rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
      const radius = .034 + random(seed + 247) * .018;
      parts.bamboo.push(new THREE.CylinderGeometry(radius * .7, radius, direction.length(), 6, 1).applyQuaternion(rotation).translate(...base.clone().add(tip).multiplyScalar(.5).toArray()));
      for (let y = .55; y < tall; y += .53) parts.nodes.push(new THREE.CylinderGeometry(radius * 1.09, radius * 1.09, .035, 6, 1, true)
        .applyQuaternion(rotation).translate(...base.clone().addScaledVector(direction, y / tall).toArray()));
      const levels = root[1] < cz - .75 && Math.hypot(root[0] - cx, root[1] - cz) > 1.5 ? [.26, .5, .67, .84] : [.5, .67, .84];
      for (const [level, fraction] of levels.entries()) {
        const branchAngle = angle + level * 2.1, branch = new THREE.Vector3(Math.cos(branchAngle) * .57, .13, Math.sin(branchAngle) * .57);
        const start = base.clone().addScaledVector(direction, fraction), end = start.clone().add(branch);
        parts.bamboo.push(architectureBar(start.toArray() as Vector, end.toArray() as Vector, .016));
        for (let blade = 0; blade < 7; blade++) {
          const leafStart = start.clone().lerp(end, .16 + blade * .11), leafAngle = branchAngle + (blade % 2 ? 1 : -1) * (.7 + blade * .07);
          const leafLength = .32 + random(seed * 21 + level * 7 + blade + 300) * .24;
          const leafTip = leafStart.clone().add(new THREE.Vector3(Math.cos(leafAngle) * leafLength, -.13, Math.sin(leafAngle) * leafLength));
          const middle = leafStart.clone().lerp(leafTip, .42), side = new THREE.Vector3(-Math.sin(leafAngle), 0, Math.cos(leafAngle)).multiplyScalar(.034);
          const crease = middle.clone().add(new THREE.Vector3(0, .025, 0)), left = middle.clone().sub(side), right = middle.clone().add(side);
          parts.leaves.push(surface([...leafStart.toArray(), ...left.toArray(), ...crease.toArray(), ...leafStart.toArray(), ...crease.toArray(), ...right.toArray(),
            ...left.toArray(), ...leafTip.toArray(), ...crease.toArray(), ...crease.toArray(), ...leafTip.toArray(), ...right.toArray()]));
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(parts).map(([key, geometries]) => [key, architectureBatch(geometries, false)])) as Record<keyof typeof BOUNDARY_WATER_COLORS, THREE.BufferGeometry>;
}

import * as THREE from 'three';
import type { GateLandmark, Point } from './types';

export type LandmarkBox = { position: [number, number, number]; size: [number, number, number]; color: string; rotation?: number };
const stone = '#c8bea7', trim = '#aaa18b', dark = '#586454';

export const landmarkRotation = (model: GateLandmark) => Math.atan2(-model.axis[1], model.axis[0]);
export function landmarkWorldPoint(model: GateLandmark, [x, y, z]: [number, number, number]): [number, number, number] {
  return [model.center[0] + model.axis[0] * x - model.axis[1] * z, y,
    model.center[1] + model.axis[1] * x + model.axis[0] * z];
}

export function monumentLayout(model: GateLandmark) {
  const scale = model.totalHeight / 6.8;
  const radius = model.width - 1.6 * scale, halfAngle = Math.PI / 6, sag = radius * (1 - Math.cos(halfAngle)) / 2;
  const base = .36 * scale, beamBottom = model.totalHeight - 1.05 * scale;
  const at = (angle: number, r = radius): Point => [r * Math.sin(angle), radius - r * Math.cos(angle) - sag];
  const outer = Array.from({ length: 33 }, (_, i) => at(-halfAngle + 2 * halfAngle * i / 32, radius + .42 * scale));
  const inner = Array.from({ length: 33 }, (_, i) => at(halfAngle - 2 * halfAngle * i / 32, radius - .42 * scale));
  const ring = [...outer, ...inner, outer[0]];
  const boxes: LandmarkBox[] = [
    { position: [0, .12 * scale, 0], size: [model.width, .24 * scale, model.depth], color: '#b7a486' },
    { position: [0, .3 * scale, 0], size: [model.width - .25 * scale, .12 * scale, model.depth - .25 * scale], color: '#c8b392' }
  ];
  const pillars = Array.from({ length: 6 }, (_, i) => {
    const angle = -halfAngle + 2 * halfAngle * i / 5, [x, z] = at(angle);
    boxes.push({ position: [x, (base + beamBottom) / 2, z], size: [1.2 * scale, beamBottom - base, .95 * scale], rotation: -angle, color: stone });
    boxes.push({ position: [x, base + .14 * scale, z], size: [1.32 * scale, .28 * scale, 1.05 * scale], rotation: -angle, color: dark });
    boxes.push({ position: [x, beamBottom - .2 * scale, z], size: [1.4 * scale, .4 * scale, 1.06 * scale], rotation: -angle, color: stone });
    for (let j = 1; j <= 4; j++) boxes.push({ position: [x, base + (beamBottom - base) * j / 5, z], size: [1.22 * scale, .055 * scale, .97 * scale], rotation: -angle, color: trim });
    return { center: [x, (base + beamBottom) / 2, z] as [number, number, number], angle };
  });
  return { boxes, pillars, ring, beamBottom, beamHeight: model.totalHeight - beamBottom,
    sign: outer.map(([x, z]) => [x + x / (radius + .42 * scale) * .012 * scale, z - (radius - z - sag) / (radius + .42 * scale) * .012 * scale] as Point) };
}

export function monumentSignGeometry(model: GateLandmark) {
  const layout = monumentLayout(model), positions: number[] = [], uv: number[] = [], indices: number[] = [];
  for (let i = 0; i < layout.sign.length; i++) {
    const [x, z] = layout.sign[i];
    positions.push(x, layout.beamBottom, z, x, model.totalHeight, z);
    // The outward face is viewed from -Z, so its left edge is local +X.
    const u = 1 - i / (layout.sign.length - 1);
    uv.push(u, 0, u, 1);
    if (i) { const a = (i - 1) * 2, b = i * 2; indices.push(a, a + 1, b + 1, a, b + 1, b); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}

export function bellTowerLayout(model: GateLandmark) {
  const h = model.totalHeight, scale = h / 18, shaft = model.width * .53, base = .36 * scale;
  const chamberBottom = h * .69, chamberTop = h * .84, column = .42 * scale;
  const boxes: LandmarkBox[] = [
    { position: [0, .18 * scale, 0], size: [model.width, .36 * scale, model.depth], color: '#b7a486' },
    { position: [0, (base + h * .18) / 2, 0], size: [model.width - .2 * scale, h * .18 - base, model.depth - .2 * scale], color: stone },
    { position: [0, h * .18, 0], size: [model.width, .25 * scale, model.depth], color: trim },
    { position: [0, (base + chamberBottom) / 2, 0], size: [shaft, chamberBottom - base, shaft], color: stone },
    { position: [0, chamberBottom - .14 * scale, 0], size: [shaft + .3 * scale, .28 * scale, shaft + .3 * scale], color: trim },
    { position: [0, chamberTop + .15 * scale, 0], size: [shaft + .35 * scale, .3 * scale, shaft + .35 * scale], color: stone }
  ];
  for (const x of [-1, 1]) for (const z of [-1, 1]) boxes.push({
    position: [x * (shaft - column) / 2, (chamberBottom + chamberTop) / 2, z * (shaft - column) / 2],
    size: [column, chamberTop - chamberBottom, column], color: stone
  });
  for (let i = 1; i < 10; i++) {
    const y = base + (chamberBottom - base) * i / 10;
    boxes.push({ position: [0, y, 0], size: [shaft + .035 * scale, .06 * scale, shaft + .035 * scale], color: trim });
  }
  for (const side of [-1, 1]) {
    boxes.push({ position: [side * shaft * .12, (h * .18 + chamberBottom) / 2, -shaft / 2 - .012 * scale], size: [.045 * scale, chamberBottom - h * .18, .035 * scale], color: trim });
    boxes.push({ position: [-shaft / 2 - .012 * scale, (h * .18 + chamberBottom) / 2, side * shaft * .12], size: [.035 * scale, chamberBottom - h * .18, .045 * scale], color: trim });
  }
  return { boxes, shaft, chamberBottom, chamberTop, scale,
    doorway: { position: [0, 1.5 * scale, -(model.depth - .2 * scale) / 2 - .012 * scale] as [number, number, number], size: [2.05 * scale, 2.4 * scale] as [number, number] },
    bell: { bottom: chamberBottom + .38 * scale, height: (chamberTop - chamberBottom) * .54, radius: shaft * .24 },
    dome: { bottom: chamberTop + .3 * scale, radius: h * .065 },
    mast: { bottom: h * .94, top: h } };
}

export function bellGeometry(model: GateLandmark, segments = 48) {
  const { bell, scale } = bellTowerLayout(model);
  const r = bell.radius, h = bell.height, thickness = .05 * scale;
  const outline: Point[] = [[r, thickness / 2], [.98 * r, .1 * h], [.8 * r, .18 * h],
    [.61 * r, .5 * h], [.52 * r, .8 * h], [.33 * r, .96 * h], [0, h]];
  // A closed cross-section joins the outer shell, inner shell and rounded mouth.
  const profile: Point[] = [...outline, [0, h - thickness], [.33 * r - thickness, .96 * h - thickness],
    [.52 * r - thickness, .8 * h], [.61 * r - thickness, .5 * h], [.8 * r - thickness, .18 * h],
    [.98 * r - thickness, .1 * h], [r - thickness, thickness / 2]];
  for (let i = 1; i < 8; i++) {
    const angle = Math.PI + Math.PI * i / 8;
    profile.push([r - thickness / 2 + Math.cos(angle) * thickness / 2, thickness / 2 + Math.sin(angle) * thickness / 2]);
  }
  const positions: number[] = [], indices: number[] = [];
  const rings = profile.map(([radius, y]) => {
    if (radius === 0) {
      const pole = positions.length / 3;
      positions.push(0, y, 0);
      return Array<number>(segments).fill(pole);
    }
    return Array.from({ length: segments }, (_, i) => {
      const angle = Math.PI * 2 * i / segments, index = positions.length / 3;
      positions.push(radius * Math.sin(angle), y, radius * Math.cos(angle));
      return index;
    });
  });
  for (let j = 0; j < rings.length; j++) for (let i = 0; i < segments; i++) {
    const current = rings[j], next = rings[(j + 1) % rings.length], around = (i + 1) % segments;
    const a = current[i], b = current[around], c = next[around], d = next[i];
    if (a !== b && a !== d && b !== d) indices.push(a, b, d);
    if (c !== d && c !== b && d !== b) indices.push(c, d, b);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

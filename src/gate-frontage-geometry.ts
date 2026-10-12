import * as THREE from 'three';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import type { Feature, SecurityGateModel } from './types';

export function hedgeFenceGeometry(feature: Feature) {
  const pieces = { foliage: [] as THREE.BufferGeometry[], tips: [] as THREE.BufferGeometry[], rails: [] as THREE.BufferGeometry[], base: [] as THREE.BufferGeometry[] };
  const hedge = feature.hedge, base = feature.height ?? .12;
  if (hedge) for (let edge = 1; edge < hedge.points.length; edge++) {
    const a = hedge.points[edge - 1], b = hedge.points[edge], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    if (length < 1e-6) continue;
    const point = (t: number, height: number): [number, number, number] => [a[0] + dx * t, base + height, a[1] + dz * t];
    const angle = -Math.atan2(dz, dx);
    pieces.base.push(new THREE.BoxGeometry(length, .22, hedge.width + .14).rotateY(angle).translate(...point(.5, .11)));
    pieces.foliage.push(new THREE.BoxGeometry(length, hedge.height - .26, hedge.width - .08).rotateY(angle).translate(...point(.5, (hedge.height + .26) / 2)));
    for (const height of [hedge.height - .12, hedge.railHeight]) pieces.rails.push(architectureBar(point(0, height), point(1, height), .048));
    const slots = Math.ceil(length / .24);
    for (let i = 0; i <= slots; i++) {
      const post = i % 10 === 0 || i === slots;
      pieces.rails.push(architectureBar(point(i / slots, post ? .22 : hedge.height - .16), point(i / slots, hedge.railHeight), post ? .055 : .024));
    }
    const plants = Math.ceil(length / .3), rows = Math.ceil((hedge.height - .52) / .27);
    for (let i = 0; i <= plants; i++) for (let row = 0; row <= rows; row++) for (const side of [-1, 1]) {
      const y = .4 + row * (hedge.height - .52) / rows;
      const leaf = new THREE.IcosahedronGeometry(1, 0).scale(.18, .16, .11).rotateY(angle), p = point(i / plants, y);
      leaf.translate(p[0] - dz / length * side * (hedge.width / 2 - .035), p[1], p[2] + dx / length * side * (hedge.width / 2 - .035));
      pieces[(i * 13 + row * 7 + side) % 5 === 0 ? 'tips' : 'foliage'].push(leaf);
    }
  }
  return Object.fromEntries(Object.entries(pieces).map(([key, parts]) => [key, architectureBatch(parts)])) as Record<keyof typeof pieces, THREE.BufferGeometry>;
}

// Silver glass cabin and the photographed folded stainless accordion gate.
// Local +x runs from the hedge toward the entrance; +z faces the sports-ground entrance.
export function securityGateGeometry(model: SecurityGateModel) {
  const pieces = { metal: [] as THREE.BufferGeometry[], glass: [] as THREE.BufferGeometry[], roof: [] as THREE.BufferGeometry[], rubber: [] as THREE.BufferGeometry[], panel: [] as THREE.BufferGeometry[] };
  const w = model.width, d = model.depth, h = model.totalHeight;
  const box = (kind: keyof typeof pieces, x: number, y: number, z: number, width: number, height: number, depth: number) => pieces[kind].push(new THREE.BoxGeometry(width, height, depth).translate(x, y, z));
  const sill = .82, top = h - .26;
  box('metal', 0, .06, 0, w, .12, d);
  for (const z of [-d / 2, d / 2]) {
    // A full-height front door interrupts the lower opaque skirt.
    if (z < 0) box('metal', 0, sill / 2, z, w, sill, .06);
    else {
      box('metal', w * .2, sill / 2, z, w * .6, sill, .06);
      box('metal', -w * .3, .21, z, w * .4, .42, .06);
    }
    box('glass', 0, (sill + top) / 2, z, w - .09, top - sill, .025);
    if (z > 0) box('glass', -w * .3, (sill + .43) / 2, z, w * .4 - .07, sill - .43, .025);
    for (const x of [-w / 2, -w * .1, w / 2]) box('metal', x, top / 2, z, .055, top, .07);
    for (const y of [sill, top]) box('metal', 0, y, z, w, .055, .07);
  }
  for (const x of [-w / 2, w / 2]) {
    box('metal', x, sill / 2, 0, .06, sill, d);
    box('glass', x, (sill + top) / 2, 0, .025, top - sill, d - .09);
    box('metal', x, (sill + top) / 2, 0, .065, top - sill, .055);
    for (const y of [sill, top]) box('metal', x, y, 0, .07, .055, d);
  }
  box('metal', -w * .12, 1.1, d / 2 + .06, .025, .28, .035);
  const radius = .16, left = -w / 2 - .18, right = w / 2 + .18, near = -d / 2 - .18, far = d / 2 + .18;
  const roof = new THREE.Shape();
  roof.moveTo(left + radius, near); roof.lineTo(right - radius, near); roof.quadraticCurveTo(right, near, right, near + radius);
  roof.lineTo(right, far - radius); roof.quadraticCurveTo(right, far, right - radius, far);
  roof.lineTo(left + radius, far); roof.quadraticCurveTo(left, far, left, far - radius);
  roof.lineTo(left, near + radius); roof.quadraticCurveTo(left, near, left + radius, near);
  pieces.roof.push(new THREE.ExtrudeGeometry(roof, { depth: .18, bevelEnabled: false, curveSegments: 8 }).rotateX(Math.PI / 2).translate(0, h, 0));
  box('metal', 0, h - .18, 0, w, .15, d);
  const start = w / 2 + .09, end = start + model.gateLength, count = Math.ceil(model.gateLength / .3), step = model.gateLength / count;
  for (const z of [d / 2 - .2, d / 2 + .2]) {
    pieces.metal.push(architectureBar([start, .29, z], [end, .29, z], .035));
    for (let i = 0; i <= count; i++) {
      const x = start + i * step;
      pieces.metal.push(architectureBar([x, .23, z], [x, 1.65, z], .032));
      if (i < count) for (const side of [0, 1]) pieces.metal.push(architectureBar([x, side ? .33 : 1.53, z], [x + step, side ? 1.53 : .33, z], .026));
      if (i % 2 === 0) {
        pieces.rubber.push(new THREE.CylinderGeometry(.075, .075, .055, 10).rotateX(Math.PI / 2).translate(x, .075, z));
        pieces.metal.push(architectureBar([x, .075, z], [x, .28, z], .024));
      }
    }
  }
  box('metal', end + .12, .87, d / 2, .22, 1.74, .54);
  box('panel', end + .12, 1.33, d / 2 + .277, .14, .19, .012);
  box('rubber', end + .12, .035, d / 2, .3, .07, .55);
  const result = Object.fromEntries(Object.entries(pieces).map(([key, parts]) => [key, architectureBatch(parts, key !== 'glass')])) as Record<keyof typeof pieces, THREE.BufferGeometry>;
  for (const part of Object.values(result)) { part.computeBoundingBox(); part.computeBoundingSphere(); }
  return result;
}

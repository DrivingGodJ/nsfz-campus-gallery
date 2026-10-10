import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bridgeLayout } from './bridge-geometry.ts';
import type { Feature } from './types';

export function memorialGalleryGeometry(feature: Feature) {
  const base = feature.height ?? .3, width = feature.width ?? 2.6;
  const { postHeight, roofRise } = feature.gallery!;
  const eave = base + postHeight;
  const groups = { floor: [], frame: [], roof: [], walls: [], boards: [], paper: [], ink: [] } as Record<string, THREE.BufferGeometry[]>;
  const add = (key: string, geometry: THREE.BufferGeometry) => { groups[key].push(geometry); };
  const box = (key: string, x: number, y: number, z: number, sx: number, sy: number, sz: number, rotation = 0) => {
    const geometry = new THREE.BoxGeometry(sx, sy, sz); geometry.rotateY(rotation); geometry.translate(x, y, z); add(key, geometry);
  };
  for (const pad of bridgeLayout(feature, base).deck) {
    const shape = new THREE.Shape(pad.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = pad.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    const slab = new THREE.ExtrudeGeometry(shape, { depth: base - .06, bevelEnabled: false });
    slab.rotateX(-Math.PI / 2); slab.translate(0, .06, 0); add('floor', slab);
  }
  for (let leg = 1; leg < feature.points!.length; leg++) {
    const a = feature.points![leg - 1], b = feature.points![leg];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]), tx = (b[0] - a[0]) / length, tz = (b[1] - a[1]) / length;
    const yaw = Math.atan2(tx, tz), at = (u: number, v: number) => [a[0] + tx * u + tz * v, a[1] + tz * u - tx * v];
    const localBox = (key: string, u: number, v: number, y: number, across: number, high: number, along: number) => {
      const p = at(u, v); box(key, p[0], y, p[1], across, high, along, yaw);
    };
    const bar = (u: number, fromV: number, fromY: number, toV: number, toY: number, thickness: number) => {
      const p = at(u, fromV), q = at(u, toV), from = new THREE.Vector3(p[0], fromY, p[1]), to = new THREE.Vector3(q[0], toY, q[1]);
      const direction = to.clone().sub(from), geometry = new THREE.BoxGeometry(thickness, direction.length(), thickness);
      geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()));
      geometry.translate(...from.add(to).multiplyScalar(.5).toArray()); add('frame', geometry);
    };
    const half = width / 2 + .18;
    const profile = new THREE.Shape();
    profile.moveTo(-half, eave); profile.lineTo(0, eave + roofRise); profile.lineTo(half, eave);
    profile.lineTo(half, eave + .07); profile.lineTo(0, eave + roofRise + .07); profile.lineTo(-half, eave + .07); profile.closePath();
    const roof = new THREE.ExtrudeGeometry(profile, { depth: length, bevelEnabled: false });
    roof.rotateY(yaw); roof.translate(a[0], 0, a[1]); add('roof', roof);
    const bays = Math.max(1, Math.round(length / 2.7)), spacing = length / bays;
    for (let bay = 0; bay <= bays; bay++) {
      const u = bay * spacing;
      for (const side of [-1, 1]) {
        const p = at(u, side * (width / 2 - .12));
        // Keep the turn open: an end post must not land inside the other wing.
        const insideOtherWing = feature.points!.some((start, index, points) => {
          if (index === 0 || index === leg) return false;
          const before = points[index - 1], dx = start[0] - before[0], dz = start[1] - before[1], span = Math.hypot(dx, dz);
          const along = ((p[0] - before[0]) * dx + (p[1] - before[1]) * dz) / span;
          const across = ((p[0] - before[0]) * dz - (p[1] - before[1]) * dx) / span;
          return along > .15 && along < span - .15 && Math.abs(across) < width / 2 - .15;
        });
        if (insideOtherWing) continue;
        const post = new THREE.CylinderGeometry(.1, .1, postHeight, 10);
        post.translate(p[0], base + postHeight / 2, p[1]); add('frame', post);
      }
      bar(u, -width / 2, eave - .09, width / 2, eave - .09, .12);
      bar(u, -half, eave, 0, eave + roofRise, .075);
      bar(u, 0, eave + roofRise, half, eave, .075);
      bar(u, 0, eave - .09, 0, eave + roofRise, .06);
    }
    for (const side of [-1, 1]) localBox('frame', length / 2, side * (width / 2 - .1), eave - .02, .11, .14, length);
    localBox('frame', length / 2, 0, eave + roofRise, .09, .09, length);
    // Display bays stand on the outside edge; the courtyard side and entrance stay open.
    for (let bay = 0; bay < bays; bay++) {
      const u = (bay + .5) * spacing, panelWidth = Math.min(1.65, spacing - .45), v = width / 2 - .12;
      localBox('walls', u, v, base + .36, .11, .72, spacing - .24);
      localBox('boards', u, v, base + 1.37, .07, 1.22, panelWidth);
      localBox('paper', u, v - .048, base + 1.85, .015, .09, panelWidth * .86);
      for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) {
        const cellU = u + (col - 1) * panelWidth * .29, cellY = base + 1.08 + row * .37;
        localBox('paper', cellU, v - .047, cellY, .015, .32, panelWidth * .26);
        for (let line = 0; line < 3; line++) localBox('ink', cellU, v - .058, cellY - .025 + line * .055, .006, .012, panelWidth * .17);
      }
    }
  }
  const end = feature.points!.at(-1)!, previous = feature.points!.at(-2)!;
  const run = Math.hypot(end[0] - previous[0], end[1] - previous[1]), tx = (end[0] - previous[0]) / run, tz = (end[1] - previous[1]) / run;
  for (let step = 0; step < 2; step++) {
    const top = .06 + (base - .06) * (step + 1) / 3, distance = .3 * (1.5 - step);
    box('floor', end[0] + tx * distance, (.06 + top) / 2, end[1] + tz * distance, width, top - .06, .3, Math.atan2(tx, tz));
  }
  return Object.fromEntries(Object.entries(groups).map(([key, parts]) => {
    const plain = parts.map(part => { const g = part.index ? part.toNonIndexed() : part.clone(); g.deleteAttribute('uv'); return g; });
    const geometry = mergeGeometries(plain)!;
    parts.forEach(part => part.dispose()); plain.forEach(part => part.dispose());
    if (key === 'frame') geometry.userData.photoOcclusionMask = new Uint8Array(geometry.getAttribute('position').count / 3);
    return [key, geometry];
  })) as Record<keyof typeof groups, THREE.BufferGeometry>;
}

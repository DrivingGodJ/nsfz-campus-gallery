import * as THREE from 'three';
import type { Feature } from './types';
import type { RailPoint } from './bridge-geometry';

export function diamondNetGeometry(chains: RailPoint[][], height: number) {
  const positions: number[] = [];
  for (const chain of chains) for (let i = 1; i < chain.length; i++) {
    const from = chain[i - 1], to = chain[i], dx = to[0] - from[0], dz = to[2] - from[2], length = Math.hypot(dx, dz);
    if (length < .02) continue;
    // One static line batch replaces thousands of separate wire meshes.
    const lower = .08, upper = height - .08;
    const point = (u: number, v: number) => positions.push(from[0] + dx * u / length,
      from[1] + (to[1] - from[1]) * u / length + v, from[2] + dz * u / length);
    for (const slope of [-1, 1]) {
      const lo = slope > 0 ? lower - length : lower, hi = slope > 0 ? upper : upper + length;
      for (let intercept = Math.ceil(lo / .18) * .18; intercept <= hi; intercept += .18) {
        const a = Math.max(0, Math.min((lower - intercept) / slope, (upper - intercept) / slope));
        const b = Math.min(length, Math.max((lower - intercept) / slope, (upper - intercept) / slope));
        if (b - a < 1e-5) continue;
        point(a, slope * a + intercept); point(b, slope * b + intercept);
      }
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
}

// DSC06875 shows diamond wire on the field-facing edge. Fit it to the joined
// perimeter, so the gym doorway and stair exits remain open.
export function bridgeNetGeometry(feature: Feature, chains: RailPoint[][]) {
  const selected: RailPoint[][] = [], net = feature.sideNet;
  if (net) {
    const routes = [feature.points!, ...(feature.connections || []).filter(c => c.id === 'playground-stairs').map(c => c.points)];
    const faces = routes.flatMap(route => route.slice(1).map((to, i) => {
      const from = route[i], dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
      const sign = dz * (net.facing[0] - from[0]) - dx * (net.facing[1] - from[1]) >= 0 ? 1 : -1;
      return { from, length, axis: [dx / length, dz / length], normal: [sign * dz / length, -sign * dx / length] };
    }));
    for (const chain of chains) for (let i = 1; i < chain.length; i++) {
      const from = chain[i - 1], to = chain[i], dx = to[0] - from[0], dz = to[2] - from[2], length = Math.hypot(dx, dz);
      if (length < .02) continue;
      const matches = faces.some(face => [from, to].every(p => {
        const x = p[0] - face.from[0], z = p[2] - face.from[1], along = x * face.axis[0] + z * face.axis[1];
        return along >= -1e-5 && along <= face.length + 1e-5
          && Math.abs(x * face.normal[0] + z * face.normal[1] - (feature.width || 3.5) / 2) < 1e-4;
      }));
      if (matches) selected.push([from, to]);
    }
  }
  return diamondNetGeometry(selected, net?.height || 0);
}

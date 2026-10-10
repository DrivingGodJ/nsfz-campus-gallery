import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import { diamondNetGeometry } from './bridge-net-geometry.ts';
import type { RailPoint } from './bridge-geometry';
import type { Feature } from './types';

// DSC06150 and DSC03515: one continuous mesh fence behind the southern baskets.
export function basketballFenceGeometry(feature: Feature) {
  const height = feature.railHeight || 3.8;
  const chains: RailPoint[][] = (feature.railEdges || []).map(chain => chain.map(([x, z]) => [x, .16, z]));
  const frame = [];
  for (const chain of chains) for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1], b = chain[i], length = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const count = Math.max(1, Math.ceil(length / 3.4));
    for (let j = 0; j <= count; j++) {
      const x = a[0] + (b[0] - a[0]) * j / count, z = a[2] + (b[2] - a[2]) * j / count;
      frame.push(architectureBar([x, .16, z], [x, .16 + height, z], .075));
    }
    for (const y of [.16 + .12, .16 + height / 2, .16 + height]) {
      frame.push(architectureBar([a[0], y, a[2]], [b[0], y, b[2]], .055));
    }
  }
  return { frame: architectureBatch(frame), wire: diamondNetGeometry(chains, height) };
}

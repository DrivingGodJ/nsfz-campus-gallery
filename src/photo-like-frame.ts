import type { CSSProperties } from 'react';

export function photoLikeFrame(count = 0): CSSProperties {
  const likes = Number.isFinite(count) ? Math.max(0, count) : 0;
  return { '--photo-like-red': 100 * likes / (likes + 4) + '%' } as CSSProperties;
}

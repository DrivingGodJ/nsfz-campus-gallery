export type PhotoOverlayMode = 'off' | 'translucent' | 'entering' | 'shown' | 'exiting';

export function overlayProgress(elapsed: number, duration: number) {
  const t = Math.max(0, Math.min(1, elapsed / Math.max(1, duration)));
  return t * t * (3 - 2 * t);
}

// Both fronts advance from far to near. On exit the newly reached pixels belong
// to the model, rather than retracting the opening photo front in reverse.
export function overlayPhotoAlpha(phase: 'entering' | 'exiting', unreached: number, initial = 255) {
  return phase === 'entering' ? 255 - unreached : Math.round(initial * unreached / 255);
}

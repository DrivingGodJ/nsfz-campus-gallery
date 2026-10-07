export type PhotoOverlayMode = 'off' | 'translucent' | 'entering' | 'shown' | 'exiting';

export type OverlayClock = { elapsed: number; rate: number };
export const OVERLAY_INITIAL_PROGRESS = .1;
// Invert the smoothstep below: 10% elapsed time reveals only 2.8% of the photo.
const initialTime = .5 - Math.sin(Math.asin(1 - 2 * OVERLAY_INITIAL_PROGRESS) / 3);

// The thumbnail can start the sweep; incoming bytes set how far it may go.
// Decoding the display image releases the last part, always at normal speed.
export function advanceOverlayClock(clock: OverlayClock, delta: number, loaded: number, duration = 1600): OverlayClock {
  const time = Math.max(0, delta), progress = Number.isFinite(loaded) ? Math.max(0, Math.min(1, loaded)) : 0;
  const smoothing = 180, decay = Math.exp(-time / smoothing);
  const initial = duration * initialTime;
  const limit = progress === 1 ? Infinity : Math.max(clock.elapsed, initial, duration * progress * .95);
  const target = progress === 1 || clock.elapsed < initial ? 1 : Math.min(1, (limit - clock.elapsed) / smoothing);
  return {
    elapsed: Math.min(limit, clock.elapsed + target * time + (clock.rate - target) * smoothing * (1 - decay)),
    rate: target + (clock.rate - target) * decay,
  };
}

export function overlayProgress(elapsed: number, duration: number) {
  const t = Math.max(0, Math.min(1, elapsed / Math.max(1, duration)));
  return t * t * (3 - 2 * t);
}

// Both fronts advance from far to near. On exit the newly reached pixels belong
// to the model, rather than retracting the opening photo front in reverse.
export function overlayPhotoAlpha(phase: 'entering' | 'exiting', unreached: number, initial = 255) {
  return phase === 'entering' ? 255 - unreached : Math.round(initial * unreached / 255);
}

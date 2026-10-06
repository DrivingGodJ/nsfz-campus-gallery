export type PhotoOverlayMode = 'off' | 'translucent' | 'entering' | 'shown' | 'exiting';

export const OVERLAY_WAITING_RATE = .25;
export type OverlayClock = { elapsed: number; rate: number };

// Advance a virtual clock instead of changing the total duration, which would
// move the reveal front abruptly when the original finishes loading.
export function advanceOverlayClock(clock: OverlayClock, delta: number, waiting: boolean): OverlayClock {
  const time = Math.max(0, delta), target = waiting ? OVERLAY_WAITING_RATE : 1;
  const smoothing = 180, decay = Math.exp(-time / smoothing);
  return {
    elapsed: clock.elapsed + target * time + (clock.rate - target) * smoothing * (1 - decay),
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

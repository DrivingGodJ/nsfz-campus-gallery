
export type DepthTransitionDirection = 'far' | 'near';
export type DepthTransitionEasing = 'smooth' | 'linear';
// What the side the front has not reached shows: the depth map itself, or nothing
// at all, which lets the 3D model behind the overlay show through.
export type DepthTransitionBackground = 'depth' | 'model';

// Fixed rendering constants; there are no user-adjustable transition settings.
export type DepthTransitionSettings = {
  duration: number; color: string; width: number; core: number; glow: number; softness: number;
  direction: DepthTransitionDirection; easing: DepthTransitionEasing; background: DepthTransitionBackground;
};

export const DEPTH_TRANSITION_DEFAULTS: DepthTransitionSettings = {
  duration: 1600, color: '#344f3e', width: .9, core: 55, glow: 72, softness: 1, direction: 'far', easing: 'smooth', background: 'model',
};

// The photo is drawn opaque, then punched back out with the mask so the unreached
// side becomes transparent; only then, if the background is the depth map, are
// those holes backfilled. Under 'model' nothing fills them, so the campus mesh
// behind the overlay stays visible and the photo appears to wipe over the scene
// instead of over a grayscale plate. The theme edge is last, on top of either.
export type DepthTransitionLayer = 'photo' | 'depth' | 'line';
export function depthTransitionLayers(background: DepthTransitionBackground = DEPTH_TRANSITION_DEFAULTS.background): DepthTransitionLayer[] {
  return background === 'depth' ? ['photo', 'depth', 'line'] : ['photo', 'line'];
}

// The frame is grayscale, so the red channel carries the whole depth value.
export function depthGray(pixels: Uint8Array | Uint8ClampedArray) {
  const gray = new Uint8Array(pixels.length / 4);
  for (let index = 0; index < gray.length; index++) gray[index] = pixels[index * 4];
  return gray;
}

export function depthHistogram(gray: Uint8Array) {
  const histogram = new Uint32Array(256);
  for (let index = 0; index < gray.length; index++) histogram[gray[index]]++;
  return histogram;
}

// Screen-space width of the theme edge, as a share of the rendered frame so it
// reads the same whether the frame is 800 or 1600 pixels wide.
export const depthLineRadius = (frameWidth: number, percent = DEPTH_TRANSITION_DEFAULTS.width) =>
  Math.max(2, Math.round(frameWidth * percent / 100));

// The photo arrives from the end the direction names first: `far` starts at the
// white horizon, `near` starts at the black foreground. The front is measured
// where the replaced area matches the progress, so a uniform sky cannot swallow
// a sixth of the animation in one frame. The value is fractional: a level
// holding a large part of the picture fades in as the front crosses it.
export function revealFront(histogram: Uint32Array, progress: number, direction: DepthTransitionDirection = 'far') {
  let total = 0;
  for (let gray = 0; gray < 256; gray++) total += histogram[gray];
  const ratio = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
  const empty = direction === 'near' ? -.5 : 255.5, whole = direction === 'near' ? 255.5 : -.5;
  if (!total || ratio <= 0) return empty;
  if (ratio >= 1) return whole;
  const target = ratio * total;
  let replaced = 0;
  for (let step = 0; step < 256; step++) {
    const gray = direction === 'near' ? step : 255 - step;
    const next = replaced + histogram[gray];
    if (next >= target) {
      const share = histogram[gray] ? (target - replaced) / histogram[gray] : 1;
      return direction === 'near' ? gray - .5 + share : gray + .5 - share;
    }
    replaced = next;
  }
  return whole;
}

// 1 where the photo owns the pixel, 0 where the depth map still shows. The ramp
// is `softness` gray levels wide, centred on the front; 0 gives a hard edge.
export function revealAlpha(gray: number, front: number, direction: DepthTransitionDirection = 'far', softness = 1) {
  const behind = direction === 'near' ? front - gray : gray - front;
  if (!(softness > 0)) return behind > 0 ? 1 : 0;
  return Math.min(1, Math.max(0, behind / softness + .5));
}

// Per-pixel layers for one animation frame: `keep` is the depth map's alpha and
// `line` paints the edge on the side that has not been replaced yet. The edge is
// measured from the boundary in screen pixels, so a region of nearly constant
// depth gets a line instead of a wash.
export function depthTransitionFrame({ gray, width, height, front, direction = 'far', softness = 1, radius, core, glow, keep, line }: {
  gray: Uint8Array; width: number; height: number; front: number; direction?: DepthTransitionDirection;
  softness?: number; radius?: number; core?: number; glow?: number; keep?: Uint8Array; line?: Uint8Array;
}) {
  const count = width * height;
  const kept = keep || new Uint8Array(count), edge = line || new Uint8Array(count);
  const reach = radius ?? depthLineRadius(width);
  const solid = Math.max(1, Math.round(reach * (core ?? DEPTH_TRANSITION_DEFAULTS.core) / 100));
  const halo = Math.max(0, Math.min(255, Math.round(glow ?? DEPTH_TRANSITION_DEFAULTS.glow)));
  for (let index = 0; index < count; index++) {
    kept[index] = Math.round(255 * (1 - revealAlpha(gray[index], front, direction, softness)));
    edge[index] = 0;
  }
  // The line belongs on the untouched side of the leading edge: the pixels that
  // are about to be replaced. A level that is still fading in already counts as
  // arrived, otherwise a slowly fading sky would park the line at the horizon.
  const replace = (index: number) => kept[index] < 255;
  const paint = (start: number, step: number, limit: number) => {
    for (let distance = 1, index = start; distance <= reach; distance++, index += step) {
      if (step > 0 ? index > limit : index < limit) return;
      if (replace(index)) return;
      const alpha = distance <= solid ? 255 : halo;
      if (edge[index] < alpha) edge[index] = alpha;
    }
  };
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 1; x < width; x++) {
      const index = row + x;
      if (replace(index) === replace(index - 1)) continue;
      if (replace(index)) paint(index - 1, -1, row); else paint(index, 1, row + width - 1);
    }
  }
  for (let x = 0; x < width; x++) {
    for (let y = 1; y < height; y++) {
      const index = y * width + x;
      if (replace(index) === replace(index - width)) continue;
      if (replace(index)) paint(index - width, -width, x); else paint(index, width, (height - 1) * width + x);
    }
  }
  return { keep: kept, line: edge };
}

const easeInOut = (t: number) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export function transitionProgress(elapsed: number, duration = DEPTH_TRANSITION_DEFAULTS.duration, easing: DepthTransitionEasing = 'smooth') {
  if (!(duration > 0)) return 1;
  const ratio = Math.min(1, Math.max(0, Number.isFinite(elapsed) ? elapsed : 0) / duration);
  return easing === 'linear' ? ratio : easeInOut(ratio);
}

export function parseLineColor(value: string, fallback = DEPTH_TRANSITION_DEFAULTS.color) {
  const match = /^#?([\da-f]{3}|[\da-f]{6})$/i.exec((value || '').trim());
  const hex = match ? match[1] : fallback.slice(1);
  const full = hex.length === 3 ? hex.replace(/./g, character => character + character) : hex;
  return { r: parseInt(full.slice(0, 2), 16), g: parseInt(full.slice(2, 4), 16), b: parseInt(full.slice(4, 6), 16) };
}

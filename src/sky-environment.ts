import { activeMapTime, timeMapColor } from './time-palette.ts';
import type { PhotoSeason } from './photo-season';
import { photoTime, type PhotoTime } from './photo-time.ts';
import type { Photo } from './types';
import type { Theme } from './theme';

export type SkyTime = Exclude<PhotoTime, 'unknown'>;
export const SKY_PALETTES = {
  dawn: { zenith: '#6994ba', horizon: '#f4c9a6', glow: '#ffc08a', clouds: '#ffe4cf', celestial: '#fff2cb', direction: [-.84, .11, .53], stars: 0, moon: 0, cloudAmount: .28 },
  day: { zenith: '#5c9cce', horizon: '#dce9ed', glow: '#fff4d8', clouds: '#ffffff', celestial: '#fff9e5', direction: [.38, .78, .5], stars: 0, moon: 0, cloudAmount: .4 },
  dusk: { zenith: '#665d91', horizon: '#eab094', glow: '#ff9862', clouds: '#d9b4bd', celestial: '#ffd3a0', direction: [.84, .07, -.53], stars: .06, moon: 0, cloudAmount: .3 },
  night: { zenith: '#101e37', horizon: '#455872', glow: '#7795b9', clouds: '#647a95', celestial: '#e5edf7', direction: [-.38, .59, -.71], stars: 1, moon: 1, cloudAmount: .12 },
} satisfies Record<SkyTime, { zenith: string; horizon: string; glow: string; clouds: string; celestial: string; direction: number[]; stars: number; moon: number; cloudAmount: number }>;

export function skyTime(theme: Theme, time: PhotoTime | ''): SkyTime {
  return activeMapTime(time) || (theme === 'dark' ? 'night' : 'day');
}

export function photoSkyTime(mapTime: PhotoTime | '', photo?: Pick<Photo, 'capturedAt'> | null): PhotoTime | '' {
  const captured = photo ? photoTime(photo) : 'unknown';
  return captured === 'unknown' ? mapTime : captured;
}

export function skyEnvironment(theme: Theme, season: PhotoSeason | '', time: PhotoTime | '') {
  const period = skyTime(theme, time);
  return { period, ...SKY_PALETTES[period], ground: timeMapColor(theme, season, time, '#eeeee5') };
}

export function skyTransitionBlend(delta: number, firstFrame: boolean, reducedMotion = false) {
  if (reducedMotion) return 1;
  // A demand-rendered scene can have been idle for minutes before a preview.
  const step = Math.min(Number.isFinite(delta) ? Math.max(0, delta) : 0, firstFrame ? 1 / 60 : .05);
  return 1 - Math.exp(-step * 7);
}

// The dome stays inside the camera's clipping range even far outside campus.
export function skyDomeRadius(near: number, far: number) {
  return Math.max(near * 2, far * .8);
}

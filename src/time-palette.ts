import { seasonalMapColor } from './season-palette.ts';
import type { PhotoSeason } from './photo-season';
import type { PhotoTime } from './photo-time';
import type { Theme } from './theme';

export const TIME_LIGHTING = {
  dawn: { ambient: 1.35, intensity: 1.9, color: '#ffe0bc', position: [-220, 120, 140] as [number, number, number] },
  day: { ambient: 1.5, intensity: 2.3, color: '#ffffff', position: [140, 300, 160] as [number, number, number] },
  dusk: { ambient: 1.1, intensity: 1.7, color: '#ffd0a6', position: [220, 90, -140] as [number, number, number] },
  night: { ambient: 1.2, intensity: 1.3, color: '#b7cde8', position: [-100, 220, -180] as [number, number, number] },
};
export function activeMapTime(time: PhotoTime | '') { return time ? time === 'unknown' ? 'day' : time : null; }

function tint(color: string, warm: [number, number, number], amount: number) {
  if (!/^#[a-f0-9]{6}$/i.test(color)) return color;
  const channels = color.slice(1).match(/../g)!.map(n => parseInt(n, 16));
  return '#' + channels.map((n, i) => Math.round(n * (1 - amount) + warm[i] * amount).toString(16).padStart(2, '0')).join('');
}
export function timeMapColor(theme: Theme, season: PhotoSeason | '', time: PhotoTime | '', color: string) {
  const active = activeMapTime(time);
  const base = seasonalMapColor(active ? active === 'night' ? 'dark' : 'light' : theme, season, color);
  return active === 'dawn' ? tint(base, [242, 209, 180], .12) : active === 'dusk' ? tint(base, [216, 174, 141], .23) : base;
}

import type { Photo } from './types';

export const PHOTO_TIMES = [
  { id: 'dawn', label: '清晨', hours: '05:00–08:00' },
  { id: 'day', label: '白天', hours: '08:00–17:00' },
  { id: 'dusk', label: '傍晚', hours: '17:00–20:00' },
  { id: 'night', label: '夜间', hours: '20:00–次日 05:00' },
  { id: 'unknown', label: '时间待补充', hours: '' },
] as const;
export type PhotoTime = typeof PHOTO_TIMES[number]['id'];

// Classify the clock written by the camera, without converting its time zone.
// A date alone does not imply a midnight shot.
export function photoTime(photo: Pick<Photo, 'capturedAt'>): PhotoTime {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:Z|[+-]\d{2}:\d{2})?$/.exec(photo.capturedAt || '');
  if (!match) return 'unknown';
  const [, y, m, d, h, min, s = '0'] = match;
  const year = Number(y), month = Number(m), day = Number(d), hour = Number(h);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour > 23 || Number(min) > 59 || Number(s) > 59) return 'unknown';
  return hour >= 5 && hour < 8 ? 'dawn' : hour >= 8 && hour < 17 ? 'day' : hour >= 17 && hour < 20 ? 'dusk' : 'night';
}
export function photosInTime<T extends Pick<Photo, 'capturedAt'>>(photos: T[], time: PhotoTime | ''): T[] {
  return time ? photos.filter(photo => photoTime(photo) === time) : photos;
}

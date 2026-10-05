import type { Photo } from './types';

export const SEASONS = [
  { id: 'spring', label: '春季', months: '3–5 月' },
  { id: 'summer', label: '夏季', months: '6–8 月' },
  { id: 'autumn', label: '秋季', months: '9–11 月' },
  { id: 'winter', label: '冬季', months: '12–2 月' },
  { id: 'unknown', label: '日期待补充', months: '' }
] as const;
export type PhotoSeason = typeof SEASONS[number]['id'];

// Use the recorded shooting date, without shifting its month across time zones.
export function photoSeason(photo: Pick<Photo, 'capturedAt'>): PhotoSeason {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/.exec(photo.capturedAt || '');
  if (!match) return 'unknown';
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return 'unknown';
  return month >= 3 && month <= 5 ? 'spring' : month >= 6 && month <= 8 ? 'summer' : month >= 9 && month <= 11 ? 'autumn' : 'winter';
}
export function photosInSeason<T extends Pick<Photo, 'capturedAt'>>(photos: T[], season: PhotoSeason | ''): T[] {
  return season ? photos.filter(photo => photoSeason(photo) === season) : photos;
}
export function photoMapSeason(mapSeason: PhotoSeason | '', photo?: Pick<Photo, 'capturedAt'> | null): PhotoSeason | '' {
  const captured = photo ? photoSeason(photo) : 'unknown';
  return captured === 'unknown' ? mapSeason : captured;
}
export const photoSeasonLabel = (photo: Pick<Photo, 'capturedAt'>) => SEASONS.find(season => season.id === photoSeason(photo))!.label;

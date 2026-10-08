import type { Photo } from './types';
import { photoSeason } from './photo-season.ts';
import { photoTime } from './photo-time.ts';

// Match the camera's recorded calendar date to the visitor's local day.
export function photosOnThisDay<T extends Pick<Photo, 'capturedAt'>>(photos: T[], today = new Date()): T[] {
  return photos.filter(photo => {
    const captured = /^(\d{4})-(\d{2})-(\d{2})(?:$|T| )/.exec(photo.capturedAt || '');
    return captured && Number(captured[1]) > 0 && Number(captured[1]) < today.getFullYear()
      && Number(captured[2]) === today.getMonth() + 1 && Number(captured[3]) === today.getDate()
      && photoSeason(photo) !== 'unknown' && (photo.capturedAt.length === 10 || photoTime(photo) !== 'unknown');
  }).sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

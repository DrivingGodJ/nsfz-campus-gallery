import type { Photo } from './types';

export type PhotoSort = 'uploaded' | 'captured' | 'likes';
export type PhotoLike = { count: number; liked: boolean };
export type PhotoLikes = Record<string, PhotoLike>;

function time(value?: string) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value.length === 10 ? value + 'T00:00:00Z' : /Z$|[+-]\d\d:\d\d$/.test(value) ? value : value + 'Z');
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

export function sortPhotos(photos: Photo[], order: PhotoSort, allPhotos: Photo[], likes: PhotoLikes = {}) {
  const uploadOrder = new Map(allPhotos.map((photo, index) => [photo.id, index]));
  const uploaded = (a: Photo, b: Photo) => {
    const difference = time(b.uploadedAt) - time(a.uploadedAt);
    return (Number.isNaN(difference) ? 0 : difference) || (uploadOrder.get(b.id) ?? 0) - (uploadOrder.get(a.id) ?? 0);
  };
  return [...photos].sort((a, b) => {
    if (order === 'likes') return (likes[b.id]?.count ?? 0) - (likes[a.id]?.count ?? 0) || uploaded(a, b);
    if (order === 'captured') {
      const difference = time(b.capturedAt) - time(a.capturedAt);
      return (Number.isNaN(difference) ? 0 : difference) || uploaded(a, b);
    }
    return uploaded(a, b);
  });
}

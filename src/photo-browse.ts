import type { Photo } from './types.ts';

export function adjacentPhoto(photos: Photo[], selectedId: string, direction: -1 | 1) {
  const index = photos.findIndex(photo => photo.id === selectedId);
  return index < 0 ? undefined : photos[index + direction];
}

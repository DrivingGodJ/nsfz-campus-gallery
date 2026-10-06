import type { Photo } from './types';

// Legacy libraries can still be browsed without fetching their full-size image.
export const photoPreviewFile = (photo: Pick<Photo, 'files'>) => photo.files.preview ? photo.files.preview + '?v=2' : photo.files.thumbnail;

// The middle, secondary-HD tier used by both the card and immersive transition.
// Bump the rendition version after recompression so cached larger files expire.
export const photoDisplayFile = (photo: Pick<Photo, 'files'>) => photo.files.display ? photo.files.display + '?v=2' : photoPreviewFile(photo);

// Paired depth images are imported with the photograph. Replacing one changes
// its version so an existing browser cache cannot keep the previous map.
export const photoDepthFile = (photo: Pick<Photo, 'files' | 'depthUpdatedAt'>) => photo.files.depth ? photo.files.depth + '?v=' + encodeURIComponent(photo.depthUpdatedAt || '1') : null;

import type { Photo } from './types';

// Browsing uses just the thumbnail and secondary-HD rendition, never the original.
// Bump the rendition version after recompression so cached larger files expire.
export const photoDisplayFile = (photo: Pick<Photo, 'files'>) => photo.files.display ? photo.files.display + '?v=2' : photo.files.thumbnail;

// Paired depth images are imported with the photograph. Replacing one changes
// its version so an existing browser cache cannot keep the previous map.
export const photoDepthFile = (photo: Pick<Photo, 'files' | 'depthUpdatedAt'>) => photo.files.depth ? photo.files.depth + '?v=' + encodeURIComponent(photo.depthUpdatedAt || '1') : null;

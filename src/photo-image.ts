import type { Photo } from './types';

// Legacy libraries can still be browsed without fetching their full-size image.
export const photoPreviewFile = (photo: Pick<Photo, 'files'>) => photo.files.preview ? photo.files.preview + '?v=2' : photo.files.thumbnail;

// Photo-based depth maps are precomputed by scripts/photo-depth.mjs and shipped
// beside the other renditions, so the viewer never runs a model itself. The
// version query lets a regenerated map replace a cached one.
export const photoDepthFile = (photo: Pick<Photo, 'files'>) => photo.files.depth ? photo.files.depth + '?v=1' : null;

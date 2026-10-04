import type { Photo } from './types';

// Legacy libraries can still be browsed without fetching their full-size image.
export const photoPreviewFile = (photo: Pick<Photo, 'files'>) => photo.files.preview || photo.files.thumbnail;

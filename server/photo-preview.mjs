import sharp from 'sharp';

export const PHOTO_PREVIEW_EDGE = 1280;
export async function createPhotoPreview(source, destination) {
  return sharp(source, { limitInputPixels: 70000000 }).rotate().toColourspace('srgb')
    .resize({ width: PHOTO_PREVIEW_EDGE, height: PHOTO_PREVIEW_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 65, effort: 6 }).toFile(destination);
}

import sharp from 'sharp';
import fs from 'node:fs/promises';

export const PHOTO_PREVIEW_EDGE = 1280;
// Decimal MB: browsing renditions must be strictly smaller than 1.5 MB.
export const PHOTO_DISPLAY_MAX_BYTES = 1500000;
export async function createBoundedPhotoWebP(source, destination, { edge, quality, maxBytes = PHOTO_DISPLAY_MAX_BYTES }) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new Error('图片大小上限不能小于 1 KB。');
  let size = edge, currentQuality = quality;
  for (;;) {
    const output = await sharp(source, { limitInputPixels: 70000000 }).rotate().toColourspace('srgb')
      .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: currentQuality, effort: 6 }).toBuffer();
    if (output.length < maxBytes) {
      await fs.writeFile(destination, output);
      return { size: output.length };
    }
    if (currentQuality > 45) currentQuality = Math.max(45, currentQuality - 10);
    else {
      if (size <= 64) throw new Error('无法在图片大小上限内生成预览。');
      size = Math.max(64, Math.floor(size * .8));
    }
  }
}
export const createPhotoPreview = (source, destination) => createBoundedPhotoWebP(source, destination, { edge: PHOTO_PREVIEW_EDGE, quality: 65 });
export const createPhotoDisplay = (source, destination) => createBoundedPhotoWebP(source, destination, { edge: 2400, quality: 88 });

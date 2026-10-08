import sharp from 'sharp';
import fs from 'node:fs/promises';

export const PHOTO_PREVIEW_EDGE = 1280;
// Decimal KB: browsing renditions must be strictly smaller than 500 KB.
export const PHOTO_DISPLAY_MAX_BYTES = 500000;
export const PHOTO_DOWNLOAD_MAX_BYTES = 5000000;
export async function createPhotoDownload(source, destination, { maxBytes = PHOTO_DOWNLOAD_MAX_BYTES } = {}) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1024) throw new Error('图片大小上限不能小于 1 KB。');
  const metadata = await sharp(source, { limitInputPixels: 70000000 }).metadata();
  let edge = Math.max(metadata.width, metadata.height), resize = false;
  const encode = quality => {
    let image = sharp(source, { limitInputPixels: 70000000 }).rotate().toColourspace('srgb');
    if (resize) image = image.resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true });
    return image.jpeg({ quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  };
  for (;;) {
    let quality = 95, best = await encode(quality);
    if (best.data.length > maxBytes) {
      best = await encode(65);
      if (best.data.length > maxBytes) {
        if (edge <= 32) throw new Error('无法在图片大小上限内生成下载图。');
        edge = Math.max(32, Math.floor(edge * Math.max(.5, Math.min(.9, Math.sqrt(maxBytes / best.data.length) * .98))));
        resize = true;
        continue;
      }
      quality = 65;
      let low = 66, high = 94;
      while (low <= high) {
        const candidateQuality = Math.floor((low + high) / 2), candidate = await encode(candidateQuality);
        if (candidate.data.length <= maxBytes) {
          best = candidate; quality = candidateQuality; low = candidateQuality + 1;
        } else high = candidateQuality - 1;
      }
    }
    await fs.writeFile(destination, best.data);
    return { size: best.data.length, width: best.info.width, height: best.info.height, quality };
  }
}
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

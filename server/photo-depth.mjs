import sharp from 'sharp';
import { MAX_DEPTH_BYTES } from './photo-package.mjs';

export const PHOTO_DEPTH_FILE = 'depth.webp';
export const PHOTO_DEPTH_EDGE = 768;
export const PHOTO_DEPTH_OUTPUT_BYTES = 60000;
export async function normalizePhotoDepth(bytes, photo) {
  if (!bytes.length || bytes.length > MAX_DEPTH_BYTES) throw new Error('深度图不能超过 10 MB。');
  let metadata;
  try { metadata = await sharp(bytes, { limitInputPixels: 20000000, failOn: 'error' }).metadata(); }
  catch { throw new Error('无法读取深度图，请换成 PNG、JPEG 或 WebP。'); }
  if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || (metadata.pages || 1) > 1) throw new Error('请选择单张 PNG、JPEG 或 WebP 深度图。');
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const width = rotated ? metadata.height : metadata.width, height = rotated ? metadata.width : metadata.height;
  if (Math.abs((width / height) / (photo.width / photo.height) - 1) > .01) throw new Error('深度图的横竖方向和宽高比例需要与照片一致。');
  // Preserve black-near / white-far. A depth mask needs smooth boundaries, not
  // photographic resolution; constrain size even for noisy uploaded masks.
  for (let edge = PHOTO_DEPTH_EDGE; edge >= 96; edge = Math.floor(edge * .75)) {
    for (const quality of [90, 85, 80]) {
      const result = await sharp(bytes, { limitInputPixels: 20000000, failOn: 'error' }).rotate().removeAlpha().greyscale()
        .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true }).webp({ quality, effort: 6 }).toBuffer();
      if (result.length <= PHOTO_DEPTH_OUTPUT_BYTES) return result;
    }
  }
  throw new Error('深度图暂时无法压缩，请换一张深度图。');
}

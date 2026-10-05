import sharp from 'sharp';
import { MAX_DEPTH_BYTES } from './photo-package.mjs';

export const PHOTO_DEPTH_FILE = 'depth.webp';
export async function normalizePhotoDepth(bytes, photo) {
  if (!bytes.length || bytes.length > MAX_DEPTH_BYTES) throw new Error('深度图不能超过 10 MB。');
  let metadata;
  try { metadata = await sharp(bytes, { limitInputPixels: 20000000, failOn: 'error' }).metadata(); }
  catch { throw new Error('无法读取深度图，请换成 PNG、JPEG 或 WebP。'); }
  if (!['png', 'jpeg', 'webp'].includes(metadata.format) || !metadata.width || !metadata.height || (metadata.pages || 1) > 1) throw new Error('请选择单张 PNG、JPEG 或 WebP 深度图。');
  const rotated = [5, 6, 7, 8].includes(metadata.orientation);
  const width = rotated ? metadata.height : metadata.width, height = rotated ? metadata.width : metadata.height;
  if (Math.abs((width / height) / (photo.width / photo.height) - 1) > .01) throw new Error('深度图的横竖方向和宽高比例需要与照片一致。');
  // Preserve the uploaded near-black / far-white convention. Lossless grayscale
  // keeps the boundary reliable and does not introduce a prediction dependency.
  return sharp(bytes, { limitInputPixels: 20000000, failOn: 'error' }).rotate().removeAlpha().greyscale()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).webp({ lossless: true }).toBuffer();
}

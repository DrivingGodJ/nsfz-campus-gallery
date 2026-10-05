import type { Photo } from './types';
import { loadImageElement } from './depth-map';
import { MAX_DEPTH_BYTES } from '../server/photo-package.mjs';

export async function validateDepthUpload(file: File, photo: Pick<Photo, 'width' | 'height'>) {
  if (!file.size || file.size > MAX_DEPTH_BYTES || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 10 MB 以内的 PNG、JPEG 或 WebP 深度图。');
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImageElement(url, '无法读取深度图，请换成 PNG、JPEG 或 WebP。');
    if (image.naturalWidth * image.naturalHeight > 20000000) throw new Error('深度图请缩小到 2000 万像素以内。');
    if (Math.abs((image.naturalWidth / image.naturalHeight) / (photo.width / photo.height) - 1) > .01) throw new Error('深度图的横竖方向和宽高比例需要与照片一致。');
    return url;
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

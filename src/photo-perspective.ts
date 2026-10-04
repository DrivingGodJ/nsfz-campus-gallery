import type { Photo } from './types';

export function photoPerspectiveIssue(photo: Photo) {
  if (!photo.placed) return '先在地图标记拍摄位置，再体验照片视角。';
  if (![photo.position.x, photo.position.z, photo.heading, photo.pitch].every(Number.isFinite)) return '请先补齐拍摄位置和镜头方向。';
  const aerial = photo.captureType === 'aerial' || (photo.captureType === undefined && !!photo.metadata?.aerial);
  if (aerial && (photo.altitude?.reference !== 'takeoff' || !Number.isFinite(photo.altitude.meters))) {
    return '请先补充相对起飞点的航拍高度；海拔不能直接作为地图高度。';
  }
  return '';
}

export const photoFrameSize = (photoAspect: number, canvasAspect: number) => ({
  width: Math.min(1, photoAspect / canvasAspect), height: Math.min(1, canvasAspect / photoAspect)
});

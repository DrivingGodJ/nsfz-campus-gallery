import type { Photo } from './types';

const positive = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
export function photoFieldOfView(photo: Pick<Photo, 'metadata' | 'view' | 'width' | 'height'>) {
  if (!positive(photo.width) || !positive(photo.height)) return null;
  const manual = positive(photo.view?.focalLength35Mm), equivalent = positive(photo.metadata?.focalLength35Mm);
  const actual = positive(photo.metadata?.focalLengthMm), crop = positive(photo.view?.cropFactor);
  const focal = manual ?? equivalent ?? (actual ? actual * (crop ?? 1) : undefined);
  if (!focal || !Number.isFinite(focal)) return null;
  const source = manual ? 'manual' : equivalent ? 'exifEquivalent' : crop ? 'sensorFormat' : 'assumedFullFrame';
  // 35 mm equivalence is based on the image diagonal. Use the exported image's
  // aspect ratio so a portrait photograph has the narrower horizontal angle.
  const diagonal = Math.hypot(36, 24), aspect = photo.width / photo.height;
  const sensorHeight = diagonal / Math.hypot(aspect, 1), sensorWidth = sensorHeight * aspect;
  return { horizontal: 2 * Math.atan(sensorWidth / (2 * focal)) * 180 / Math.PI,
    vertical: 2 * Math.atan(sensorHeight / (2 * focal)) * 180 / Math.PI, focalLength35Mm: focal, source };
}
export function viewSourceText(view: NonNullable<ReturnType<typeof photoFieldOfView>>) {
  const focal = Number(view.focalLength35Mm.toFixed(1)) + ' mm';
  return view.source === 'manual' ? '按手动等效焦距 ' + focal + ' 估算'
    : view.source === 'exifEquivalent' ? '按 EXIF 等效焦距 ' + focal + ' 估算'
    : view.source === 'sensorFormat' ? '按相机画幅换算，等效 ' + focal
    : '画幅待确认，先按全画幅估算';
}
export function directionVector(heading: number, pitch: number): [number, number, number] {
  const yaw = heading * Math.PI / 180, tilt = pitch * Math.PI / 180;
  return [Math.sin(yaw) * Math.cos(tilt), Math.sin(tilt), -Math.cos(yaw) * Math.cos(tilt)];
}
export function viewSectorRays(heading: number, pitch: number, horizontalAngle: number, radius = 22, segments = 48): [number, number, number][] {
  const forward = directionVector(heading, pitch), yaw = heading * Math.PI / 180;
  const right = [Math.cos(yaw), 0, Math.sin(yaw)];
  return Array.from({ length: segments + 1 }, (_, i) => {
    const angle = (i / segments - .5) * horizontalAngle * Math.PI / 180;
    return forward.map((v, n) => radius * (v * Math.cos(angle) + right[n] * Math.sin(angle))) as [number, number, number];
  });
}

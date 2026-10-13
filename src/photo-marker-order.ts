import type { Camera, Vector3 } from 'three';

// Back to front, with no rounded distance buckets: cards sharing a pixel still
// keep their actual camera depth. Folded collections always stay at the bottom.
export function orderPhotoMarkers<T extends { id: string; position: Vector3; overflow?: boolean; occlusionLayers?: number }>(markers: T[], camera: Camera): T[] {
  camera.updateMatrixWorld();
  const depths = new Map(markers.map(marker => [marker.id, -marker.position.clone().applyMatrix4(camera.matrixWorldInverse).z]));
  return [...markers].sort((a, b) => Number(!!b.overflow) - Number(!!a.overflow)
    || depths.get(b.id)! - depths.get(a.id)!
    || (b.occlusionLayers ?? 0) - (a.occlusionLayers ?? 0) || a.id.localeCompare(b.id));
}

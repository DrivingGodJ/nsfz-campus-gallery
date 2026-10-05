import type { Photo } from './types';

// Where a depth map comes from. `model` renders the campus mesh through the photo
// camera: exact about geometry, but the mesh is deliberately low-poly, so its
// depth map is a handful of flat planes. `photo` uses a precomputed monocular
// estimate of the photograph itself (Depth Anything V2, see
// scripts/photo-depth.mjs): it follows the real scene, but only the relative
// ordering is meaningful, not metres.
export type DepthSource = 'model' | 'photo';

export const DEPTH_SOURCE_LABELS: Record<DepthSource, string> = {
  model: '模型', photo: '照片'
};

// Newest first, so an unset choice prefers the photo estimate wherever one has
// been precomputed: it is the more useful map, and the whole point of offering it.
export function availableDepthSources(photo: Pick<Photo, 'files'> | null | undefined): DepthSource[] {
  return photo?.files.depth ? ['photo', 'model'] : ['model'];
}

// An explicit choice wins only while it is still available. Switching to a photo
// without a precomputed map (a draft, an untouched library) falls back to the
// model instead of leaving a button aimed at a file that does not exist.
export function resolveDepthSource(photo: Pick<Photo, 'files'> | null | undefined, choice: DepthSource | null = null): DepthSource {
  const available = availableDepthSources(photo);
  return choice && available.includes(choice) ? choice : available[0];
}

import crypto from 'node:crypto';
import { readPhotoPackage } from './photo-package.mjs';
import { validatePhoto, UserError } from './storage.mjs';

export async function importPhotoPackage(store, bytes) {
  let pack;
  try { pack = await readPhotoPackage(bytes); } catch (error) { throw new UserError(error.message); }
  const { map } = await store.state();
  const candidate = { ...pack.annotation, id: crypto.randomUUID() };
  // Validate the annotation before writing any local original or draft.
  const annotation = validatePhoto(candidate, candidate, map);
  const feature = map.features.find(item => item.id === annotation.locationId);
  const types = new Set(['water', 'forest', 'sport', 'runningTrack', 'basketballCourts', 'undergroundRoom', 'tunnel', 'undergroundCorridor', 'undergroundTrack']);
  if (['way/1277841229', 'local/stand-office'].includes(annotation.locationId) || (feature && !types.has(feature.type))) throw new UserError('投稿只接受主要建筑、校园区域或通道作为拍摄地点。');
  const draft = await store.importPhoto(pack.original);
  // Keep server-generated IDs, assets and original metadata; a package can change annotations only.
  const photo = await store.updateDraft(draft.id, { ...draft, ...pack.annotation, id: draft.id });
  return { photo, submissionId: pack.manifest.id };
}

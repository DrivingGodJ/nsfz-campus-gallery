import crypto from 'node:crypto';
import { readPhotoPackages } from './photo-package.mjs';
import { validatePhoto, UserError } from './storage.mjs';

export async function importPhotoPackage(store, bytes) {
  let pack;
  try { pack = await readPhotoPackages(bytes); } catch (error) { throw new UserError(error.message); }
  const { map } = await store.state();
  const types = new Set(['water', 'forest', 'sport', 'runningTrack', 'basketballCourts', 'undergroundRoom', 'tunnel', 'undergroundCorridor', 'undergroundTrack']);
  // Check every record before writing any draft, including records later in a batch.
  for (const entry of pack.photos) {
    const candidate = { ...entry.annotation, id: crypto.randomUUID() };
    const annotation = validatePhoto(candidate, candidate, map);
    const feature = map.features.find(item => item.id === annotation.locationId);
    if (['way/1277841229', 'local/stand-office'].includes(annotation.locationId) || (feature && !types.has(feature.type))) throw new UserError('投稿只接受主要建筑、校园区域或通道作为拍摄地点。');
  }
  const photos = [], imported = [];
  try {
    for (const entry of pack.photos) {
      let draft = await store.importPhoto(entry.original);
      imported.push(draft.id);
      if (entry.depth) draft = await store.setPhotoDepth(draft.id, entry.depth);
      // Keep server-generated IDs, assets and metadata; packages change annotations only.
      photos.push(await store.updateDraft(draft.id, { ...draft, ...entry.annotation, id: draft.id }));
    }
  } catch (error) {
    // Preserve recoverable originals, but leave no half-imported batch in the review list.
    for (const id of imported) await store.removePhoto(id);
    throw error;
  }
  return { photo: photos[0], photos, submissionId: pack.manifest.id };
}

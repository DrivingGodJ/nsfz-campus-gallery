import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { constants } from 'node:fs';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { createStore, writeJSON } from '../server/storage.mjs';
import { createPhotoDisplay, createPhotoPreview, createPhotoDownload, PHOTO_DISPLAY_MAX_BYTES, PHOTO_DOWNLOAD_MAX_BYTES } from '../server/photo-preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { site, drafts } = await createStore(root).state();
const backup = path.join(root, '.local/backups/photo-limits-' + Date.now() + '-' + crypto.randomUUID());
let changed = 0;
for (const [kind, photos, parent] of [['published', site.photos, 'public/media'], ['drafts', drafts, '.local/draft-media']]) {
  const downloads = new Map();
  const compress = async photo => {
    for (const [file, generate, maxBytes] of [['download.jpg', createPhotoDownload, PHOTO_DOWNLOAD_MAX_BYTES], ['preview.webp', createPhotoPreview, PHOTO_DISPLAY_MAX_BYTES], ['display.webp', createPhotoDisplay, PHOTO_DISPLAY_MAX_BYTES]]) {
      const destination = path.join(root, parent, photo.id, file);
      let stat;
      try { stat = await fs.stat(destination); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (file === 'download.jpg' ? stat.size <= maxBytes : stat.size < maxBytes) {
        if (file === 'download.jpg' && photo.downloadBytes !== stat.size) {
          const { width, height } = await sharp(destination).metadata();
          downloads.set(photo.id, { width, height, downloadBytes: stat.size });
        }
        continue;
      }
      const saved = path.join(backup, kind, photo.id, file), temp = destination + '.' + crypto.randomUUID() + '.tmp';
      await fs.mkdir(path.dirname(saved), { recursive: true });
      await fs.copyFile(destination, saved, constants.COPYFILE_FICLONE);
      try {
        const result = await generate(path.join(path.dirname(destination), 'download.jpg'), temp);
        await fs.rename(temp, destination);
        if (file === 'download.jpg') downloads.set(photo.id, { width: result.width, height: result.height, downloadBytes: result.size });
        console.log(photo.title + ' · ' + file + '：' + stat.size + ' → ' + result.size + ' 字节');
        changed++;
      } finally { await fs.rm(temp, { force: true }); }
    }
  };
  let nextPhoto = 0;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (nextPhoto < photos.length) await compress(photos[nextPhoto++]);
  }));
  if (downloads.size) {
    // Re-read annotations after encoding so unrelated editor changes survive.
    const recordFile = path.join(root, kind === 'published' ? 'public/data/site.json' : '.local/drafts.json');
    const fresh = JSON.parse(await fs.readFile(recordFile, 'utf8'));
    const records = kind === 'published' ? fresh.photos : fresh;
    const originalPaths = new Map(photos.map(photo => [photo.id, photo.files.download]));
    const updated = records.map(photo => downloads.has(photo.id) && photo.files.download === originalPaths.get(photo.id) ? { ...photo, ...downloads.get(photo.id) } : photo);
    await writeJSON(path.join(backup, kind, 'records.json'), fresh);
    await writeJSON(recordFile, kind === 'published' ? { ...fresh, revision: fresh.revision + 1, photos: updated } : updated);
  }
}
console.log('已调整 ' + changed + ' 个文件；下载原图不超过 5 MB，展示图小于 500 KB。私有原片与标注已保留。');
if (changed) console.log('旧图备份：' + backup);

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from '../server/storage.mjs';
import { createPhotoDisplay, createPhotoPreview, PHOTO_DISPLAY_MAX_BYTES } from '../server/photo-preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { site, drafts } = await createStore(root).state();
const backup = path.join(root, '.local/backups/photo-limits-' + Date.now() + '-' + crypto.randomUUID());
let changed = 0;
for (const [kind, photos, parent] of [['published', site.photos, 'public/media'], ['drafts', drafts, '.local/draft-media']]) {
  for (const photo of photos) {
    for (const [file, generate] of [['preview.webp', createPhotoPreview], ['display.webp', createPhotoDisplay]]) {
      const destination = path.join(root, parent, photo.id, file);
      let stat;
      try { stat = await fs.stat(destination); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (stat.size < PHOTO_DISPLAY_MAX_BYTES) continue;
      const saved = path.join(backup, kind, photo.id, file), temp = destination + '.' + crypto.randomUUID() + '.tmp';
      await fs.mkdir(path.dirname(saved), { recursive: true });
      await fs.copyFile(destination, saved);
      try {
        const result = await generate(path.join(path.dirname(destination), 'download.jpg'), temp);
        await fs.rename(temp, destination);
        console.log(photo.title + ' · ' + file + '：' + stat.size + ' → ' + result.size + ' 字节');
        changed++;
      } finally { await fs.rm(temp, { force: true }); }
    }
  }
}
console.log('已调整 ' + changed + ' 张展示图，大小均小于 1.5 MB；高清下载、私有原片与标注保持原样。');
if (changed) console.log('旧图备份：' + backup);

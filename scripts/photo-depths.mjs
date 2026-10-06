import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createStore, writeJSON } from '../server/storage.mjs';
import { createPhotoDepthGenerator } from '../server/photo-depth-generator.mjs';
import { PHOTO_DEPTH_EDGE, PHOTO_DEPTH_OUTPUT_BYTES } from '../server/photo-depth.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const generator = createPhotoDepthGenerator(root);
const store = createStore(root, { generateDepth: generator.generate });
const before = await store.state();
const report = { startedAt: new Date().toISOString(), generated: 0, compressed: 0, beforeBytes: 0, afterBytes: 0, records: [] };
const reportFile = path.join(root, '.local/depth-maintenance', report.startedAt.replaceAll(':', '-') + '.json');
await writeJSON(reportFile + '.site-before.json', before.site);
await writeJSON(reportFile + '.drafts-before.json', before.drafts);
try {
  for (const [draft, photos] of [[false, before.site.photos], [true, before.drafts]]) for (const photo of photos) {
    const directory = path.join(root, draft ? '.local/draft-media' : 'public/media', photo.id);
    const file = path.join(directory, 'depth.webp');
    const bytes = await fs.readFile(file).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    report.beforeBytes += bytes?.length || 0;
    const current = await store.state();
    const latest = (draft ? current.drafts : current.site.photos).find(item => item.id === photo.id);
    if (JSON.stringify(latest) !== JSON.stringify(photo)) throw new Error('照片刚刚有其他修改，已停止以保留你的修改。');
    let action = 'unchanged', saved = photo;
    if (!bytes) {
      console.log('生成深度图：' + photo.title);
      saved = await store.generatePhotoDepth(photo.id, current.site.revision);
      report.generated++; action = 'generated';
    } else {
      const metadata = await sharp(bytes).metadata();
      if (!photo.files.depth || bytes.length > PHOTO_DEPTH_OUTPUT_BYTES || Math.max(metadata.width, metadata.height) > PHOTO_DEPTH_EDGE) {
        saved = await store.setPhotoDepth(photo.id, bytes, current.site.revision);
        report.compressed++; action = 'compressed';
      }
    }
    const output = await fs.readFile(file), metadata = await sharp(output).metadata();
    report.afterBytes += output.length;
    report.records.push({ id: photo.id, title: photo.title, draft, action, bytes: output.length, width: metadata.width, height: metadata.height, depthUpdatedAt: saved.depthUpdatedAt });
    await writeJSON(reportFile, report);
    console.log(`${report.records.length}/${before.site.photos.length + before.drafts.length} · ${photo.title} · ${(output.length / 1000).toFixed(1)} KB`);
  }
  console.log(`已补齐 ${report.generated} 张，压缩 ${report.compressed} 张。深度图 ${report.beforeBytes} → ${report.afterBytes} 字节。`);
  console.log('报告与资料备份：' + reportFile);
} finally { generator.close(); }

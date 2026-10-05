import { fileURLToPath } from 'node:url';
import { createStore } from '../server/storage.mjs';
import { createDepthEstimator, PHOTO_DEPTH_MODEL } from '../server/photo-depth.mjs';

// Builds the photo-based depth maps the viewer can show instead of the one
// rendered from the campus model. The 3D model is deliberately low-poly, so its
// depth map is a handful of flat planes; this one comes from the photograph
// itself and follows the real scene. Run it after adding photos, then commit the
// depth.webp files it writes next to the other renditions.
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf('--' + name);
  return index === -1 ? fallback : (args[index + 1] ?? fallback);
};
const refresh = args.includes('--refresh');
const model = option('model', PHOTO_DEPTH_MODEL);
const dtype = option('dtype', 'fp32');

const started = Date.now();
const estimate = await createDepthEstimator({ root, model, dtype, log: message => console.log(message) });
const result = await createStore(root).backfillPhotoDepths({ refresh, estimate, log: message => console.log('  ' + message) });
console.log('已生成 ' + result.generated + ' 张深度图，跳过 ' + result.skipped + ' 张（已存在）；检查了 ' +
  result.photos + ' 张公开照片和 ' + result.drafts + ' 张本地草稿。新增 ' + (result.bytes / 1048576).toFixed(1) +
  ' MB，用时 ' + ((Date.now() - started) / 1000).toFixed(0) + ' 秒。');
if (result.backup) console.log('旧深度图备份：' + result.backup);

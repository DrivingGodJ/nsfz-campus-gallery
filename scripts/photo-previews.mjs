import { fileURLToPath } from 'node:url';
import { createStore } from '../server/storage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await createStore(root).backfillPhotoPreviews();
console.log(`已生成 ${result.generated} 张清晰预览图；检查了 ${result.photos} 张公开照片和 ${result.drafts} 张本地草稿。高清下载和私有原文件保持原样。`);

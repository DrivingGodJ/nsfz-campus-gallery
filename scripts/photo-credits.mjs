import { fileURLToPath } from 'node:url';
import { createStore } from '../server/storage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await createStore(root).backfillPhotoCredits();
console.log(`已检查原片：${result.found} 张带作者或版权元数据，${result.missing} 张没有。已有手动署名保留；未提供的信息留空。`);

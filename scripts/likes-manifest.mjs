import fs from 'node:fs/promises';
import { ID_PATTERN } from '../server/storage.mjs';

const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url), 'utf8'));
const ids = site.photos.map(photo => photo.id);
if (ids.some(id => !ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) throw new Error('照片编号无效，未生成点赞名单。');
await fs.writeFile(new URL('../worker/src/photo-ids.json', import.meta.url), JSON.stringify(ids, null, 2) + '\n');
console.log(`已生成 ${ids.length} 张已发布照片的点赞名单。`);

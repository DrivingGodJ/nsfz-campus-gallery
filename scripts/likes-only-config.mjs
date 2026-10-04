import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Keep the complete submission configuration intact while R2 activation is pending.
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(root, 'worker/wrangler.jsonc'), 'utf8'));
config.main = path.join(root, 'worker/src/index.ts');
config.$schema = path.join(root, 'node_modules/wrangler/config-schema.json');
for (const database of config.d1_databases || []) {
  database.migrations_dir = path.join(root, 'worker', database.migrations_dir);
}
delete config.r2_buckets;
delete config.triggers;
const directory = path.join(root, '.local/deployment');
await fs.mkdir(directory, { recursive: true });
await fs.writeFile(path.join(directory, 'likes.jsonc'), JSON.stringify(config, null, 2) + '\n');
console.log('已生成仅开放点赞的部署配置；线上投稿保持关闭。');

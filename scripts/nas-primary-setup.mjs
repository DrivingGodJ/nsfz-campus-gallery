import path from 'node:path';
import net from 'node:net';
import { createNASCacheService } from '../server/nas-cache.mjs';
import { writeJSON } from '../server/storage.mjs';

const args = process.argv.slice(2);
if (!args[0] || args[0].startsWith('--')) throw new Error('请指定审核应用的工作区目录；迁移前先退出审核应用。');
const root = path.resolve(args[0]), config = args.indexOf('--config');
const cache = createNASCacheService(root, config >= 0 ? { configFile: path.resolve(args[config + 1]) } : {});
if (await cache.primaryRoot()) { console.log('已使用 NAS 主存储，无需再次迁移。'); process.exit(0); }
const running = await new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port: Number(process.env.CAMPUS_REVIEW_PORT || 5188) });
  socket.once('connect', () => { socket.destroy(); resolve(true); });
  socket.once('error', () => resolve(false)); socket.setTimeout(1000, () => { socket.destroy(); resolve(true); });
});
if (running) throw new Error('请先退出审核应用，避免迁移期间继续修改照片。');
await cache.requireConnected();
const timer = setInterval(async () => { console.log((await cache.status()).message); }, 5000);
try {
  await cache.sync();
  await cache.clear();
  await writeJSON(path.join(root, '.local/nas-library.json'), { version: 1, downloaded: false, migratedAt: new Date().toISOString() });
  console.log('迁移完成。照片已校验并保留在 NAS，本机不再保存照片副本。');
} finally { clearInterval(timer); }

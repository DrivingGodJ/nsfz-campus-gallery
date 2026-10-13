import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMediaAssets } from '../server/media-publication.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const response = await fetch('https://drivinggodj.github.io/nsfz-campus-gallery/data/site.json', { cache: 'no-store', signal: AbortSignal.timeout(25000) });
if (!response.ok) throw new Error('无法读取当前线上照片资料，未更改图片托管。请检查网络后重试。');
const manifest = await prepareMediaAssets(root, { previousSite: await response.json() });
console.log('图片托管：' + manifest.photoCount + ' 张照片，' + manifest.assets.length + ' 个公开文件，暂保留 ' + manifest.retainedCount + ' 个旧站所需文件；私有源文件和草稿不上传。');
const args = ['deploy', '--config', 'worker/media.wrangler.jsonc'];
if (process.argv.includes('--dry-run')) args.push('--dry-run');
const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
process.exitCode = code;

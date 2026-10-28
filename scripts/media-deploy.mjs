import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMediaAssets } from '../server/media-publication.mjs';
import { prepareIncrementalMedia, uploadIncrementalMedia } from '../server/incremental-media.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
async function credentials() {
  try {
    const { stdout } = await promisify(execFile)(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), 'auth', 'token', '--json'], { cwd: root, timeout: 30000 });
    const value = JSON.parse(stdout.slice(stdout.indexOf('{'), stdout.lastIndexOf('}') + 1));
    if (!value.token && !(value.type === 'api_key' && value.key && value.email)) throw new Error('Missing credentials');
    return value;
  } catch { throw new Error('图片托管尚未登录，请先运行 Wrangler 登录，再重试上线。照片已保存在 NAS。'); }
}
if (process.argv.includes('--auth-check')) {
  await credentials(); console.log('图片托管登录状态已确认。'); process.exit(0);
}
const response = await fetch('https://drivinggodj.github.io/nsfz-campus-gallery/data/site.json', { cache: 'no-store', signal: AbortSignal.timeout(25000) });
if (!response.ok) throw new Error('无法读取当前线上照片资料，未更改图片托管。请检查网络后重试。');
const previousSite = await response.json();
if (process.env.CAMPUS_MEDIA_SOURCE_ROOT) {
  const sourceRoot = process.env.CAMPUS_MEDIA_SOURCE_ROOT;
  const prepared = await prepareIncrementalMedia(sourceRoot, previousSite, JSON.parse(process.env.CAMPUS_MEDIA_CHANGED || '[]'), { progress: console.log });
  console.log('图片托管：' + prepared.photoCount + ' 张照片，本次检查 ' + prepared.changed + ' 个变更文件，不下载或复制整套照片。');
  if (!process.argv.includes('--dry-run')) {
    const login = await credentials();
    const config = JSON.parse(await fs.readFile(path.join(root, 'worker/media.wrangler.jsonc'), 'utf8'));
    if (config.name !== 'nsfz-campus-media' || !/^[a-f0-9]{32}$/.test(config.account_id)) throw new Error('图片托管目标不正确。');
    await uploadIncrementalMedia(sourceRoot, prepared.manifest, { accountId: config.account_id, scriptName: config.name, compatibilityDate: config.compatibility_date, credentials: login, checksums: prepared.checksums, progress: console.log });
  }
  process.exit(0);
}
const manifest = await prepareMediaAssets(root, { previousSite });
console.log('图片托管：' + manifest.photoCount + ' 张照片，' + manifest.assets.length + ' 个公开文件，暂保留 ' + manifest.retainedCount + ' 个旧站所需文件；私有源文件和草稿不上传。');
const args = ['deploy', '--config', 'worker/media.wrangler.jsonc'];
if (process.argv.includes('--dry-run')) args.push('--dry-run');
const code = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(root, 'node_modules/wrangler/bin/wrangler.js'), ...args], { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => resolve(code ?? 1));
});
process.exitCode = code;

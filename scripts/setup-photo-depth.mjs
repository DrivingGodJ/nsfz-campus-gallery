import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtime = path.join(root, '.local/depth-tools');
await fs.mkdir(runtime, { recursive: true });
for (const name of ['package.json', 'package-lock.json']) await fs.copyFile(path.join(root, 'tools/photo-depth', name), path.join(runtime, name));
const npm = path.join(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
execFileSync(process.execPath, [npm, 'ci', '--prefix', runtime, '--omit=dev', '--no-audit', '--no-fund'], { stdio: 'inherit', env: { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH } });
const revision = '4472b7362082ad9968fee890ca0f1e5aca36b93d';
const files = {
  'config.json': '3aee5b9bc4f711ee885c2526d871f0c8c6c8c4b26b8e04253d0167f6a83264f5',
  'preprocessor_config.json': '03576db3c13dd0471fdf5f5e1428befcb95de063fe699879150b293dc9e0a2c6',
  'onnx/model.onnx': 'afb6a5c28f3b6bf1618c6e43f02073ef9dfdc70e937502d51603e57b0a1df10c'
};
for (const [name, checksum] of Object.entries(files)) {
  const destination = path.join(root, '.local/models/onnx-community/depth-anything-v2-small', name);
  const valid = bytes => crypto.createHash('sha256').update(bytes).digest('hex') === checksum;
  if (await fs.readFile(destination).then(valid).catch(() => false)) continue;
  console.log('准备本机深度模型：' + name);
  const response = await fetch(`https://huggingface.co/onnx-community/depth-anything-v2-small/resolve/${revision}/${name}`, { signal: AbortSignal.timeout(300000) });
  if (!response.ok) throw new Error('模型下载失败：' + response.status);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error('模型校验失败，原有模型未覆盖。');
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = destination + '.tmp';
  await fs.writeFile(temporary, bytes); await fs.rename(temporary, destination);
}
console.log('深度生成组件已就绪。照片只在本机处理，浏览网站不需要安装模型。');

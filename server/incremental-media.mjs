import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ASSET_PATTERN, ID_PATTERN, UserError, writeJSON } from './storage.mjs';
import { MEDIA_BASE_URL } from './media-publication.mjs';

const HEADERS = '/*\n  Access-Control-Allow-Origin: *\n  Access-Control-Expose-Headers: Content-Length, ETag\n  Timing-Allow-Origin: *\n  Cache-Control: public, max-age=3600\n  X-Content-Type-Options: nosniff\n';
const mime = key => key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
function keys(site) {
  const result = new Set(), ids = new Set();
  for (const photo of site.photos) {
    if (!ID_PATTERN.test(photo.id) || ids.has(photo.id) || !ASSET_PATTERN.test(photo.files?.download) || !Number.isInteger(photo.downloadBytes) || photo.downloadBytes <= 0 || photo.downloadBytes > 5_000_000) throw new UserError('照片编号或下载图片大小无效。');
    ids.add(photo.id);
    for (const key of Object.values(photo.files || {})) {
      if (!ASSET_PATTERN.test(key) || !key.startsWith('media/' + photo.id + '/')) throw new UserError('照片文件路径无效。');
      result.add(key);
    }
  }
  return result;
}
async function publicFile(sourceRoot, key, read = false) {
  const file = path.join(await fs.realpath(path.join(sourceRoot, 'public')), key), stats = await fs.lstat(file);
  if (!stats.isFile() || await fs.realpath(file) !== file || stats.size <= 0 || stats.size > 25 * 1024 * 1024) throw new UserError('公开图片路径或大小无效：' + key);
  return read ? fs.readFile(file) : stats;
}

// A full manifest is metadata, not a local photo cache. Cloudflare requests
// bytes only for hashes absent from its existing static asset collection.
export async function prepareIncrementalMedia(sourceRoot, previousSite, changed, { fetcher = fetch, progress = () => {} } = {}) {
  const site = JSON.parse(await fs.readFile(path.join(sourceRoot, 'public/data/site.json')));
  const current = keys(site), previous = keys(previousSite), all = [...new Set([...current, ...previous])].sort();
  if (all.length > 20_000 || changed.some(key => !current.has(key))) throw new UserError('公开图片清单无效。');
  const file = path.join(sourceRoot, '.local/media-hosting.json');
  let saved;
  try { saved = JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const cached = saved?.version === 1 ? saved.assets : {}, delta = new Set(changed), manifest = {}, checksums = { ...(saved?.checksums || {}) };
  const unknown = [];
  for (const key of all) {
    const entry = cached?.['/' + key];
    if (!delta.has(key) && /^[a-f0-9]{32}$/.test(entry?.hash) && Number.isSafeInteger(entry.size) && entry.size > 0) manifest['/' + key] = entry;
    else if (delta.has(key) || !previous.has(key)) {
      const bytes = await publicFile(sourceRoot, key, true);
      checksums[key] = crypto.createHash('sha256').update(bytes).digest('hex');
      manifest['/' + key] = { hash: checksums[key].slice(0, 32), size: bytes.length };
    } else unknown.push(key);
  }
  let next = 0, completed = 0;
  await Promise.all(Array.from({ length: Math.min(8, unknown.length) }, async () => {
    while (next < unknown.length) {
      const key = unknown[next++];
      const response = await fetcher(MEDIA_BASE_URL + key, { method: 'HEAD', signal: AbortSignal.timeout(25000) });
      const hash = response.headers.get('etag')?.replace(/^W\//, '').replaceAll('"', '');
      if (!response.ok || !/^[a-f0-9]{32}$/.test(hash || '') || response.headers.get('content-type')?.split(';')[0] !== mime(key)) throw new UserError('无法核对已有托管图片：' + key);
      const size = Number(response.headers.get('content-length')) || (await publicFile(sourceRoot, key)).size;
      manifest['/' + key] = { hash, size };
      completed++; if (completed % 100 === 0 || completed === unknown.length) progress('首次建立已有图片索引 ' + completed + ' / ' + unknown.length + '；未下载照片。');
    }
  }));
  await writeJSON(file, { version: 1, assets: manifest, checksums });
  return { manifest, checksums, photoCount: site.photos.length, changed: delta.size };
}

export async function uploadIncrementalMedia(sourceRoot, manifest, { accountId, scriptName, credentials, checksums = {}, fetcher = fetch, progress = () => {}, compatibilityDate = '2026-10-13' }) {
  const base = 'https://api.cloudflare.com/client/v4/accounts/' + accountId + '/workers';
  const authorization = credentials.type === 'api_key' ? { 'X-Auth-Key': credentials.key, 'X-Auth-Email': credentials.email } : { Authorization: 'Bearer ' + credentials.token };
  const request = async (url, options) => {
    const response = await fetcher(url, { ...options, signal: AbortSignal.timeout(120000) });
    const data = await response.json();
    if (!response.ok || !data.success) throw new UserError('图片托管请求失败（' + response.status + '）：' + (data.errors || []).map(error => error.code).join('、'));
    return data.result;
  };
  const session = await request(base + '/scripts/' + scriptName + '/assets-upload-session', { method: 'POST', headers: { ...authorization, 'Content-Type': 'application/json' }, body: JSON.stringify({ manifest }) });
  if (!session.jwt || !Array.isArray(session.buckets)) throw new UserError('图片托管未返回有效上传会话。');
  let completion = session.buckets.length ? null : session.jwt, uploaded = 0;
  const byHash = new Map(Object.entries(manifest).map(([key, value]) => [value.hash, { key: key.slice(1), ...value }]));
  for (const bucket of session.buckets) {
    const form = new FormData();
    for (const hash of bucket) {
      const asset = byHash.get(hash);
      if (!asset || !ASSET_PATTERN.test(asset.key)) throw new UserError('托管请求了清单外的文件，已停止上传。');
      const bytes = await publicFile(sourceRoot, asset.key, true);
      if (bytes.length !== asset.size || checksums[asset.key] && crypto.createHash('sha256').update(bytes).digest('hex') !== checksums[asset.key]) throw new UserError('照片在上传前发生变化，请重试。');
      form.set(hash, new Blob([bytes.toString('base64')], { type: mime(asset.key) }), path.basename(asset.key));
    }
    const result = await request(base + '/assets/upload?base64=true', { method: 'POST', headers: { Authorization: 'Bearer ' + session.jwt }, body: form });
    if (result.jwt) completion = result.jwt;
    uploaded += bucket.length; progress('已上传 ' + uploaded + ' 个新增或修改的文件。');
  }
  if (!completion) throw new UserError('图片尚未全部上传完成，未更改在线托管。');
  const body = new FormData();
  body.set('metadata', JSON.stringify({ compatibility_date: compatibilityDate, assets: { jwt: completion, config: { html_handling: 'none', not_found_handling: 'none', run_worker_first: false, _headers: HEADERS } } }));
  await request(base + '/scripts/' + scriptName, { method: 'PUT', headers: authorization, body });
  progress('图片托管已更新；复用 ' + (Object.keys(manifest).length - uploaded) + ' 个已有文件。');
  return { uploaded };
}

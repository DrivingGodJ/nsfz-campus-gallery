import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ASSET_PATTERN, ID_PATTERN, UserError } from './storage.mjs';
import { PHOTO_DOWNLOAD_MAX_BYTES } from './photo-preview.mjs';

export const MEDIA_BASE_URL = 'https://photos.drivinggodj.dpdns.org/';
const MAX_ASSETS = 20_000;
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const HEADERS = '/*\n  Access-Control-Allow-Origin: *\n  Access-Control-Expose-Headers: Content-Length, ETag\n  Timing-Allow-Origin: *\n  Cache-Control: public, max-age=3600\n  X-Content-Type-Options: nosniff\n';

async function digest(file) {
  const hash = crypto.createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
}

export async function collectMediaAssets(root) {
  const site = JSON.parse(await fs.readFile(path.join(root, 'public/data/site.json'), 'utf8'));
  const publicRoot = await fs.realpath(path.join(root, 'public'));
  const keys = new Map(), ids = new Set();
  for (const photo of site.photos) {
    if (!ID_PATTERN.test(photo.id) || ids.has(photo.id)) throw new UserError('存在无效或重复的照片编号。');
    ids.add(photo.id);
    if (!ASSET_PATTERN.test(photo.files?.download)) throw new UserError('照片缺少有效的下载图片。');
    for (const key of Object.values(photo.files)) {
      if (!ASSET_PATTERN.test(key) || !key.startsWith('media/' + photo.id + '/')) throw new UserError('照片文件路径不正确。');
      keys.set(key, key.endsWith('/download.jpg') ? photo.downloadBytes : undefined);
    }
  }
  if (keys.size > MAX_ASSETS) throw new UserError('公开图片超过免费托管的文件数量限制。');
  const assets = [];
  for (const [key, downloadBytes] of [...keys].sort(([a], [b]) => a.localeCompare(b))) {
    const file = path.join(publicRoot, key), stats = await fs.lstat(file);
    if (stats.isSymbolicLink() || await fs.realpath(file) !== file) throw new UserError('公开图片不能通过软链接指向其他文件：' + key);
    if (!stats.isFile() || stats.size <= 0 || stats.size > MAX_ASSET_BYTES) throw new UserError('公开图片大小无效或超过 25 MiB：' + key);
    if (key.endsWith('/download.jpg') && (stats.size > PHOTO_DOWNLOAD_MAX_BYTES || stats.size !== downloadBytes)) throw new UserError('下载图片大小与照片资料不一致：' + key);
    assets.push({ key, bytes: stats.size, sha256: await digest(file) });
  }
  return { assets, photoCount: site.photos.length, revision: site.revision };
}

export async function prepareMediaAssets(root, { destination = path.join(root, '.local/deployment/media-assets'), previousSite, mediaRoot = process.env.CAMPUS_MEDIA_ROOT || path.resolve(root, '../nsfz-campus-media') } = {}) {
  const manifest = await collectMediaAssets(root);
  const publicRoot = await fs.realpath(path.join(root, 'public'));
  // Keep files that the current live site still needs until Pages switches.
  // Only a previously published library can supply these extra paths.
  const currentKeys = new Set(manifest.assets.map(asset => asset.key));
  const retained = new Map();
  if (previousSite) {
    if (previousSite.schemaVersion !== 1 || !Array.isArray(previousSite.photos)) throw new UserError('线上照片资料格式不正确，未更改图片托管。');
    for (const photo of previousSite.photos) {
      if (!ID_PATTERN.test(photo.id)) throw new UserError('线上照片编号不正确。');
      for (const key of Object.values(photo.files || {})) {
        if (!ASSET_PATTERN.test(key) || !key.startsWith('media/' + photo.id + '/')) throw new UserError('线上照片文件路径不正确。');
        if (!currentKeys.has(key)) retained.set(key, key.endsWith('/download.jpg') ? photo.downloadBytes : undefined);
      }
    }
  }
  if (manifest.assets.length + retained.size > MAX_ASSETS) throw new UserError('公开图片超过免费托管的文件数量限制。');
  const temp = destination + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.mkdir(temp, { recursive: true });
    for (const asset of manifest.assets) {
      const target = path.join(temp, asset.key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(path.join(root, 'public', asset.key), target, constants.COPYFILE_FICLONE);
      if (await digest(target) !== asset.sha256) throw new UserError('图片在打包时发生了变化，请重新上线。');
    }
    for (const [key, downloadBytes] of retained) {
      let source = path.join(publicRoot, key);
      try { await fs.access(source); }
      catch (error) { if (error.code !== 'ENOENT') throw error; source = path.join(await fs.realpath(mediaRoot), key); }
      const stats = await fs.lstat(source);
      if (!stats.isFile() || await fs.realpath(source) !== source || stats.size <= 0 || stats.size > MAX_ASSET_BYTES
        || key.endsWith('/download.jpg') && (stats.size > PHOTO_DOWNLOAD_MAX_BYTES || stats.size !== downloadBytes)) throw new UserError('缺少有效的旧版公开图片，未更改图片托管：' + key);
      const target = path.join(temp, key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target, constants.COPYFILE_FICLONE);
    }
    await fs.writeFile(path.join(temp, '_headers'), HEADERS);
    await fs.rm(destination, { recursive: true, force: true });
    await fs.rename(temp, destination);
    return { ...manifest, retainedCount: retained.size, directory: destination };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}

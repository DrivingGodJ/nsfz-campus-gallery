import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { extractPhotoMetadata, validCaptureTime } from './photo-metadata.mjs';
import { resolveLocationId } from './campus-corrections.mjs';
import { automaticPhotoPlacement } from './photo-geolocation.mjs';
import { createPhotoPreview, createPhotoDisplay, createPhotoDownload, PHOTO_DOWNLOAD_MAX_BYTES } from './photo-preview.mjs';
import { PHOTO_DEPTH_FILE, normalizePhotoDepth } from './photo-depth.mjs';

export const ID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const ASSET_PATTERN = /^media\/[a-f0-9-]{36}\/(thumbnail\.webp|preview\.webp|depth\.webp|display\.webp|download\.jpg)$/;
export const MAX_UPLOAD = 40 * 1024 * 1024;
const emptySite = () => ({ schemaVersion: 1, revision: 0, photos: [], buildingOverrides: {} });
export class UserError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export async function writeJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temp, file);
}
async function readJSON(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' && fallback !== undefined) return structuredClone(fallback); throw e; }
}
function number(value, min, max, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new UserError(label + '超出允许范围。');
  return value;
}
function text(value, limit, label) {
  if (typeof value !== 'string' || value.length > limit) throw new UserError(label + '格式不正确。');
  return value;
}
export function validatePhoto(input, existing, map, requirePlacement = true) {
  if (!existing || input.id !== existing.id) throw new UserError('照片编号不匹配。');
  const title = text(input.title, 160, '标题').trim();
  if (!title) throw new UserError('请填写照片标题。');
  const locationId = resolveLocationId(text(input.locationId ?? input.buildingId ?? '', 80, '拍摄地点'), map);
  const building = map.buildings.find(b => b.id === locationId);
  const feature = map.features.find(f => f.id === locationId && f.name?.trim());
  if (locationId && !building && !feature) throw new UserError('找不到所选拍摄地点，请重新选择。');
  const buildingId = building?.id || '';
  if (input.locationId !== undefined && input.buildingId !== undefined && resolveLocationId(input.buildingId, map) !== buildingId) throw new UserError('拍摄地点与建筑不一致，请重新选择地点。');
  const captureType = input.captureType ?? existing.captureType ?? (existing.metadata?.aerial ? 'aerial' : 'ground');
  if (!['ground', 'aerial'].includes(captureType)) throw new UserError('请选择普通照片或航拍照片。');
  const floor = number(input.floor, 0, 50, '楼层');
  if (!Number.isInteger(floor) || (captureType === 'aerial' ? floor !== 0 : (!building && floor !== 0) || (building && floor < 1))) throw new UserError('请检查拍摄地点和楼层。');
  const xs = map.boundary.map(p => p[0]), zs = map.boundary.map(p => p[1]);
  const position = {
    x: number(input.position?.x, Math.min(...xs) - 80, Math.max(...xs) + 80, '水平位置'),
    z: number(input.position?.z, Math.min(...zs) - 80, Math.max(...zs) + 80, '水平位置')
  };
  let altitude;
  if (captureType === 'aerial') {
    const value = input.altitude;
    if (value !== undefined) {
      if (!value || !['takeoff', 'seaLevel'].includes(value.reference)) throw new UserError('请检查航拍高度的基准。');
      altitude = { meters: number(value.meters, -12000, 100000, '航拍高度'), reference: value.reference };
    } else if (requirePlacement) throw new UserError('没有读取到航拍高度，请补充后保存。');
  }
  if (requirePlacement && input.placed !== true) throw new UserError('请先在地图上标记拍摄位置。');
  const capturedAt = text(input.capturedAt || '', 30, '拍摄日期');
  if (!validCaptureTime(capturedAt)) throw new UserError('拍摄日期或时间格式不正确。');
  let view = existing.view;
  if (input.view !== undefined) {
    if (!input.view || typeof input.view !== 'object' || Array.isArray(input.view)) throw new UserError('镜头视角设置格式不正确。');
    view = {};
    if (input.view.focalLength35Mm !== undefined) view.focalLength35Mm = number(input.view.focalLength35Mm, 1, 10000, '等效焦距');
    if (input.view.cropFactor !== undefined) view.cropFactor = number(input.view.cropFactor, .5, 5, '相机画幅倍率');
  }
  const { altitude: _oldAltitude, ...record } = existing;
  return { ...record, title, description: text(input.description || '', 10000, '描述'),
    author: text(input.author ?? existing.author ?? '', 200, '作者').trim(),
    copyright: text(input.copyright ?? existing.copyright ?? '', 3000, '版权信息').trim(),
    capturedAt, locationId, buildingId, floor, position, captureType, ...(altitude ? { altitude } : {}),
    heading: number(input.heading, 0, 360, '拍摄方向') % 360, pitch: number(input.pitch, -90, 90, '仰俯角'), placed: input.placed === true, ...(view !== undefined ? { view } : {}) };
}
export function validateOverrides(input, map) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new UserError('建筑资料格式不正确。');
  const result = {};
  for (const [id, data] of Object.entries(input)) {
    const building = map.buildings.find(b => b.id === id);
    if (!building) throw new UserError('建筑编号不存在。');
    result[id] = {
      name: text(data.name || '', 100, '建筑名称'),
      floors: number(data.floors, 1, 50, '建筑楼层数'),
      floorHeight: number(data.floorHeight, 2, 12, '层高')
    };
    if (!Number.isInteger(result[id].floors)) throw new UserError('楼层数必须是整数。');
    if (data.partFloors !== undefined) {
      if (!data.partFloors || typeof data.partFloors !== 'object' || Array.isArray(data.partFloors)) throw new UserError('主副楼楼层格式不正确。');
      const partFloors = {};
      for (const [partId, value] of Object.entries(data.partFloors)) {
        if (partId === 'main' || !building.parts?.some(part => part.id === partId)) throw new UserError('建筑分区不存在。');
        const floors = number(value, 1, 50, '副楼楼层数');
        if (!Number.isInteger(floors)) throw new UserError('楼层数必须是整数。');
        partFloors[partId] = floors;
      }
      if (Object.keys(partFloors).length) result[id].partFloors = partFloors;
    }
  }
  return result;
}
export function createStore(root, { generateDepth } = {}) {
  const publicRoot = path.join(root, 'public');
  const localRoot = path.join(root, '.local');
  const siteFile = path.join(publicRoot, 'data/site.json');
  const draftsFile = path.join(localRoot, 'drafts.json');
  const mapFile = path.join(publicRoot, 'data/campus.json');
  let chain = Promise.resolve();
  const serial = action => { const result = chain.then(action); chain = result.catch(() => {}); return result; };
  async function state() {
    return { site: await readJSON(siteFile, emptySite()), drafts: await readJSON(draftsFile, []), map: await readJSON(mapFile) };
  }
  function revision(site, expected) {
    if (expected !== site.revision) throw new UserError('内容已在其他窗口更新，请刷新后再保存。你填写的内容仍保留在当前窗口。', 409);
  }
  async function saveSite(before, next) {
    await writeJSON(path.join(localRoot, 'backups', new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomUUID() + '.json'), before);
    next.revision = before.revision + 1;
    await writeJSON(siteFile, next);
  }
  const store = {
    root, publicRoot, localRoot, state,
    importPhoto: (bytes, { depth } = {}) => serial(async () => {
      if (!bytes.length || bytes.length > MAX_UPLOAD) throw new UserError('单张照片不能超过 40 MB。', 413);
      let metadata;
      try { metadata = await sharp(bytes, { limitInputPixels: 70000000, failOn: 'error' }).metadata(); }
      catch { throw new UserError('无法读取这张照片，请转成 JPEG、PNG 或 WebP 后重试。'); }
      if (!['jpeg', 'png', 'webp', 'avif', 'tiff', 'heif'].includes(metadata.format) || !metadata.width || !metadata.height) throw new UserError('请选择 JPEG、PNG、WebP 或可解码的相机照片。');
      const id = crypto.randomUUID();
      const directory = path.join(localRoot, 'draft-media', id);
      await fs.mkdir(directory, { recursive: true });
      try {
        const image = () => sharp(bytes, { limitInputPixels: 70000000 }).rotate().toColourspace('srgb');
        await Promise.all([
          image().resize({ width: 420, height: 420, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(directory, 'thumbnail.webp')),
          createPhotoPreview(bytes, path.join(directory, 'preview.webp')),
          createPhotoDisplay(bytes, path.join(directory, 'display.webp')),
          createPhotoDownload(bytes, path.join(directory, 'download.jpg'))
        ]);
        const download = await sharp(path.join(directory, 'download.jpg')).metadata();
        const stats = await fs.stat(path.join(directory, 'download.jpg'));
        await fs.mkdir(path.join(localRoot, 'originals', id), { recursive: true });
        await fs.writeFile(path.join(localRoot, 'originals', id, 'source.' + metadata.format), bytes);
        const photoMetadata = await extractPhotoMetadata(bytes);
        const { map } = await state();
        const draft = { id, title: '未命名照片', description: '', capturedAt: photoMetadata.recordedAt || '', metadata: photoMetadata, buildingId: '', floor: 0,
          author: photoMetadata.author || '', copyright: photoMetadata.copyright || '', uploadedAt: new Date().toISOString(),
          ...automaticPhotoPlacement(photoMetadata, map), heading: 0, pitch: 0, width: download.width, height: download.height,
          downloadBytes: stats.size, files: { thumbnail: 'media/' + id + '/thumbnail.webp', preview: 'media/' + id + '/preview.webp', display: 'media/' + id + '/display.webp', download: 'media/' + id + '/download.jpg' } };
        let normalized;
        if (depth) {
          try { normalized = await normalizePhotoDepth(depth, draft); }
          catch (error) { throw new UserError(error.message); }
        } else if (generateDepth) {
          try { normalized = await normalizePhotoDepth(await generateDepth(path.join(directory, 'preview.webp')), draft); }
          catch { draft.depthGenerationError = '自动生成深度图失败，照片已保留。请重试或手动上传深度图。'; }
        }
        if (normalized) {
          await fs.writeFile(path.join(directory, PHOTO_DEPTH_FILE), normalized);
          draft.files.depth = 'media/' + id + '/' + PHOTO_DEPTH_FILE;
          draft.depthUpdatedAt = crypto.randomUUID();
        }
        const drafts = await readJSON(draftsFile, []);
        await writeJSON(draftsFile, [...drafts, draft]);
        return draft;
      } catch (e) {
        await fs.rm(directory, { recursive: true, force: true });
        if (e instanceof UserError) throw e;
        throw new UserError('这张照片暂时无法转换，请先导出为 JPEG 后重试。');
      }
    }),
    generatePhotoDepth: async (id, expected) => {
      if (!ID_PATTERN.test(id || '')) throw new UserError('照片编号无效。');
      if (!generateDepth) throw new UserError('本机尚未准备深度生成组件。');
      const { site, drafts } = await state();
      const draft = drafts.find(photo => photo.id === id), photo = draft || site.photos.find(photo => photo.id === id);
      if (!photo) throw new UserError('照片不存在。', 404);
      if (!draft) revision(site, expected);
      const directory = draft ? path.join(localRoot, 'draft-media', id) : path.join(publicRoot, 'media', id);
      let bytes;
      try { bytes = await generateDepth(path.join(directory, 'preview.webp')); }
      catch { throw new UserError('自动生成深度图失败，照片已保留。请重试或手动上传深度图。'); }
      // The version check is repeated after inference, so a concurrent edit
      // cannot be overwritten by a slow generation request.
      return store.setPhotoDepth(id, bytes, expected, { depthUpdatedAt: photo.depthUpdatedAt, draft: !!draft });
    },
    updateDraft: (id, input) => serial(async () => {
      const { drafts, map } = await state();
      const existing = drafts.find(p => p.id === id);
      if (!existing) throw new UserError('草稿不存在。', 404);
      const next = validatePhoto(input, existing, map, false);
      await writeJSON(draftsFile, drafts.map(p => p.id === id ? next : p));
      return next;
    }),
    publish: (id, expected) => serial(async () => {
      const { site, drafts, map } = await state();
      revision(site, expected);
      const draft = drafts.find(p => p.id === id);
      if (!draft) throw new UserError('草稿不存在。', 404);
      const photo = validatePhoto(draft, draft, map);
      if (!photo.files.preview) {
        await createPhotoPreview(path.join(localRoot, 'draft-media', id, 'download.jpg'), path.join(localRoot, 'draft-media', id, 'preview.webp'));
        photo.files = { ...photo.files, preview: 'media/' + id + '/preview.webp' };
      }
      const destination = path.join(publicRoot, 'media', id);
      await fs.mkdir(destination, { recursive: true });
      for (const name of ['thumbnail.webp', 'preview.webp', 'display.webp', 'download.jpg', ...(draft.files.depth ? [PHOTO_DEPTH_FILE] : [])]) {
        await fs.copyFile(path.join(localRoot, 'draft-media', id, name), path.join(destination, name));
      }
      await saveSite(site, { ...site, photos: [...site.photos.filter(p => p.id !== id), photo] });
      await writeJSON(draftsFile, drafts.filter(p => p.id !== id));
      return photo;
    }),
    updatePhoto: (id, input, expected) => serial(async () => {
      const { site, map } = await state();
      revision(site, expected);
      const existing = site.photos.find(p => p.id === id);
      if (!existing) throw new UserError('照片不存在。', 404);
      const next = validatePhoto(input, existing, map);
      await saveSite(site, { ...site, photos: site.photos.map(p => p.id === id ? next : p) });
      return next;
    }),
    removePhoto: (id, expected) => serial(async () => {
      const { site, drafts } = await state();
      const draft = drafts.find(p => p.id === id);
      if (draft) {
        await writeJSON(path.join(localRoot, 'removed', id + '.json'), { photo: draft, draft: true });
        await writeJSON(draftsFile, drafts.filter(p => p.id !== id));
        return;
      }
      revision(site, expected);
      const photo = site.photos.find(p => p.id === id);
      if (!photo) throw new UserError('照片不存在。', 404);
      await writeJSON(path.join(localRoot, 'removed', id + '.json'), { photo, draft: false });
      await saveSite(site, { ...site, photos: site.photos.filter(p => p.id !== id) });
    }),
    restorePhoto: (id, expected) => serial(async () => {
      const { site, drafts, map } = await state();
      const removed = await readJSON(path.join(localRoot, 'removed', id + '.json'), null);
      if (!removed) throw new UserError('找不到可恢复的照片。', 404);
      const photo = validatePhoto(removed.photo, removed.photo, map, !removed.draft);
      if (removed.draft) {
        if (!drafts.some(p => p.id === id)) await writeJSON(draftsFile, [...drafts, photo]);
      } else {
        revision(site, expected);
        if (!site.photos.some(p => p.id === id)) await saveSite(site, { ...site, photos: [...site.photos, photo] });
      }
      await fs.rm(path.join(localRoot, 'removed', id + '.json'), { force: true });
    }),
    backfillPhotoCredits: () => serial(async () => {
      const { site, drafts } = await state();
      let found = 0, missing = 0;
      const fill = async photo => {
        if (!ID_PATTERN.test(photo.id)) throw new UserError('照片编号无效。');
        let metadata;
        try {
          const directory = path.join(localRoot, 'originals', photo.id);
          const source = (await fs.readdir(directory)).find(file => /^source\.[a-z0-9]+$/.test(file));
          metadata = source ? await extractPhotoMetadata(await fs.readFile(path.join(directory, source))) : {};
        } catch (error) { if (error.code !== 'ENOENT') throw error; metadata = {}; }
        if (metadata.author || metadata.copyright) found++; else missing++;
        return { ...photo, author: photo.author ?? metadata.author ?? '', copyright: photo.copyright ?? metadata.copyright ?? '',
          ...(metadata.author || metadata.copyright ? { metadata: { ...photo.metadata,
            ...(metadata.author ? { author: metadata.author } : {}), ...(metadata.copyright ? { copyright: metadata.copyright } : {}) } } : {}) };
      };
      const photos = [], nextDrafts = [];
      for (const photo of site.photos) photos.push(await fill(photo));
      for (const photo of drafts) nextDrafts.push(await fill(photo));
      const latest = await state();
      if (JSON.stringify(latest.site) !== JSON.stringify(site) || JSON.stringify(latest.drafts) !== JSON.stringify(drafts)) throw new UserError('内容库刚刚有新修改，请重新运行署名补全。', 409);
      if (JSON.stringify(photos) !== JSON.stringify(site.photos)) await saveSite(site, { ...site, photos });
      if (JSON.stringify(nextDrafts) !== JSON.stringify(drafts)) await writeJSON(draftsFile, nextDrafts);
      return { found, missing };
    }),
    backfillPhotoPreviews: ({ refresh = false } = {}) => serial(async () => {
      const { site, drafts } = await state();
      let generated = 0;
      const backup = refresh ? path.join(localRoot, 'backups', 'previews-' + Date.now() + '-' + crypto.randomUUID()) : null;
      const fill = async (photo, draft) => {
        if (!ID_PATTERN.test(photo.id)) throw new UserError('照片编号无效。');
        const preview = 'media/' + photo.id + '/preview.webp';
        const directory = draft ? path.join(localRoot, 'draft-media', photo.id) : path.join(publicRoot, 'media', photo.id);
        const destination = path.join(directory, 'preview.webp');
        let exists = true;
        try { await fs.access(destination); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          exists = false;
        }
        if (!exists || refresh) {
          const temp = destination + '.' + crypto.randomUUID() + '.tmp';
          try {
            await createPhotoPreview(path.join(directory, 'download.jpg'), temp);
            if (exists && backup) {
              const previous = path.join(backup, draft ? 'drafts' : 'published', photo.id, 'preview.webp');
              await fs.mkdir(path.dirname(previous), { recursive: true });
              await fs.copyFile(destination, previous);
            }
            await fs.rename(temp, destination); generated++;
          } finally { await fs.rm(temp, { force: true }); }
        }
        return { ...photo, files: { ...photo.files, preview } };
      };
      const photos = [], nextDrafts = [];
      for (const photo of site.photos) photos.push(await fill(photo, false));
      for (const photo of drafts) nextDrafts.push(await fill(photo, true));
      const latest = await state();
      if (JSON.stringify(latest.site) !== JSON.stringify(site) || JSON.stringify(latest.drafts) !== JSON.stringify(drafts)) throw new UserError('内容库刚刚有新修改，请重新运行预览图补全。', 409);
      if (JSON.stringify(photos) !== JSON.stringify(site.photos)) await saveSite(site, { ...site, photos });
      if (JSON.stringify(nextDrafts) !== JSON.stringify(drafts)) await writeJSON(draftsFile, nextDrafts);
      return { generated, photos: photos.length, drafts: nextDrafts.length, backup };
    }),
    setPhotoDepth: (id, bytes, expected, generation) => serial(async () => {
      if (!ID_PATTERN.test(id || '')) throw new UserError('照片编号无效。');
      const { site, drafts } = await state();
      const draft = drafts.find(p => p.id === id), existing = draft || site.photos.find(p => p.id === id);
      if (!existing) throw new UserError('照片不存在。', 404);
      if (generation && (generation.draft !== !!draft || generation.depthUpdatedAt !== existing.depthUpdatedAt)) throw new UserError('深度图已在其他窗口更新，请刷新后重试。', 409);
      if (!draft) revision(site, expected);
      let normalized;
      if (bytes !== null) {
        try { normalized = await normalizePhotoDepth(bytes, existing); }
        catch (error) { throw new UserError(error.message); }
      }
      const directory = draft ? path.join(localRoot, 'draft-media', id) : path.join(publicRoot, 'media', id);
      const destination = path.join(directory, PHOTO_DEPTH_FILE);
      // Keep every replaced/deleted map recoverable alongside the JSON backup.
      try {
        const backup = path.join(localRoot, 'backups', 'depths', id, crypto.randomUUID() + '.webp');
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.copyFile(destination, backup);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const { depth: _oldDepth, ...files } = existing.files;
      const { depthGenerationError: _oldDepthError, ...record } = existing;
      const next = { ...record, depthUpdatedAt: crypto.randomUUID(), files: { ...files, ...(normalized ? { depth: 'media/' + id + '/' + PHOTO_DEPTH_FILE } : {}) } };
      if (normalized) {
        const temp = destination + '.' + crypto.randomUUID() + '.tmp';
        try { await fs.writeFile(temp, normalized); await fs.rename(temp, destination); }
        finally { await fs.rm(temp, { force: true }); }
      }
      if (draft) await writeJSON(draftsFile, drafts.map(p => p.id === id ? next : p));
      else await saveSite(site, { ...site, photos: site.photos.map(p => p.id === id ? next : p) });
      return next;
    }),
    updateBuildings: (overrides, expected) => serial(async () => {
      const { site, map } = await state();
      revision(site, expected);
      await saveSite(site, { ...site, buildingOverrides: validateOverrides(overrides, map) });
    })
  };
  return store;
}
export async function exportStaticContent(root, destination, { mediaBaseURL = '' } = {}) {
  const externalMedia = !!mediaBaseURL;
  if (externalMedia) {
    let url;
    try { url = new URL(mediaBaseURL); } catch { throw new UserError('图片仓库地址不正确。'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new UserError('图片仓库地址不正确。');
  }
  const { site, map } = await createStore(root).state();
  const buildingOverrides = validateOverrides(site.buildingOverrides, map);
  const ids = new Set();
  const photos = [];
  let total = 0;
  for (const photo of site.photos) {
    if (!ID_PATTERN.test(photo.id) || ids.has(photo.id)) throw new UserError('存在无效或重复的照片编号。');
    ids.add(photo.id);
    photos.push(validatePhoto(photo, photo, map));
    if (!Number.isInteger(photo.downloadBytes) || photo.downloadBytes <= 0 || photo.downloadBytes > PHOTO_DOWNLOAD_MAX_BYTES) throw new UserError('下载图片资料超过 5 MB 或大小无效，请先压缩后发布。');
    if (!ASSET_PATTERN.test(photo.files?.download)) throw new UserError('照片文件路径不正确。');
    for (const file of Object.values(photo.files)) {
      if (!ASSET_PATTERN.test(file) || !file.startsWith('media/' + photo.id + '/')) throw new UserError('照片文件路径不正确。');
      if (externalMedia) continue;
      const stats = await fs.stat(path.join(root, 'public', file));
      total += stats.size;
      if (file === photo.files.download && stats.size > PHOTO_DOWNLOAD_MAX_BYTES) throw new UserError('下载图片超过 5 MB，请先压缩后发布。');
      if (stats.size > 100 * 1024 * 1024) throw new UserError('存在超过 GitHub 单文件限制的图片。');
    }
  }
  if (total > 900 * 1024 * 1024) throw new UserError('图片总大小超过 900 MB，请减少下载文件体积后发布。');
  await fs.mkdir(path.join(destination, 'data'), { recursive: true });
  await writeJSON(path.join(destination, 'data/site.json'), { ...site, photos, buildingOverrides });
  await writeJSON(path.join(destination, 'data/campus.json'), map);
  await fs.copyFile(path.join(root, 'public/favicon.svg'), path.join(destination, 'favicon.svg'));
  if (!externalMedia) for (const photo of site.photos) for (const file of Object.values(photo.files)) {
    const target = path.join(destination, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // APFS can clone immutable build assets without duplicating every original.
    // COPYFILE_FICLONE falls back to a normal copy on other file systems.
    await fs.copyFile(path.join(root, 'public', file), target, constants.COPYFILE_FICLONE);
  }
  await fs.writeFile(path.join(destination, '.nojekyll'), '');
  console.log('静态内容已导出：' + site.photos.length + ' 张照片；仅包含已保存内容。');
}
export function staticContentPlugin() {
  let root, outDir, mediaBaseURL;
  return { name: 'nsfz-static-content', apply: 'build',
    configResolved(config) { root = config.root; outDir = path.resolve(root, config.build.outDir); mediaBaseURL = config.env.VITE_MEDIA_BASE_URL; },
    async writeBundle() { await exportStaticContent(root, outDir, { mediaBaseURL }); }
  };
}

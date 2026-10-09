import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

export const SUBMISSION_EMAIL = 'drivinggodj@icloud.com';
export const MAX_DEPTH_BYTES = 10 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 40 * 1024 * 1024;
export const MAX_PACKAGE_PHOTOS = 20;
export const MAX_PACKAGE_ORIGINAL_BYTES = 100 * 1024 * 1024;
const MAX_MANIFEST_BYTES = MAX_PACKAGE_PHOTOS * 64 * 1024;
export const MAX_PACKAGE_BYTES = MAX_PACKAGE_ORIGINAL_BYTES + MAX_MANIFEST_BYTES + 64 * 1024;
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const annotationFields = ['title', 'description', 'capturedAt', 'locationId', 'buildingId', 'floor', 'captureType', 'altitude', 'cameraHeight', 'position', 'heading', 'pitch', 'placed', 'author', 'copyright', 'view'];

export function packageAnnotation(photo) {
  if (photo.cameraHeight !== undefined && (!Number.isFinite(photo.cameraHeight) || photo.cameraHeight < .1 || photo.cameraHeight > 11.9)) throw new Error('拍摄高度需在 0.1 到 11.9 米之间。');
  const annotation = Object.fromEntries(annotationFields.filter(key => photo[key] !== undefined).map(key => [key, photo[key]]));
  annotation.position = { x: photo.position?.x, z: photo.position?.z };
  return annotation;
}
async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
function validateSubmission(file, photo, campus) {
  if (!file.size || file.size > MAX_PHOTO_BYTES || !extensions[file.type]) throw new Error('请选择 40 MB 以内的 JPEG、PNG、WebP 或 AVIF 照片。');
  if (!photo.placed || !photo.title?.trim()) throw new Error('请填写标题并标记拍摄位置。');
  const finite = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  if (!finite(photo.heading, 0, 360) || !finite(photo.pitch, -90, 90)) throw new Error('请检查拍摄方向与仰俯角。');
  if (!Number.isInteger(photo.floor) || !finite(photo.floor, 0, 50)) throw new Error('请检查照片楼层。');
  if (!finite(photo.position?.x, -1e6, 1e6) || !finite(photo.position?.z, -1e6, 1e6)) throw new Error('请检查拍摄位置。');
  if (campus) {
    const xs = campus.boundary.map(p => p[0]), zs = campus.boundary.map(p => p[1]);
    if (!finite(photo.position.x, Math.min(...xs) - 80, Math.max(...xs) + 80) || !finite(photo.position.z, Math.min(...zs) - 80, Math.max(...zs) + 80)) throw new Error('拍摄位置超出校园地图范围，请重新标记。');
  }
  if (photo.captureType === 'aerial' && (!photo.altitude || !finite(photo.altitude.meters, -12000, 100000) || !['takeoff', 'seaLevel'].includes(photo.altitude.reference))) throw new Error('请检查航拍高度与基准。');
  if (photo.view?.focalLength35Mm !== undefined && !finite(photo.view.focalLength35Mm, 1, 10000)) throw new Error('等效焦距需在 1 到 10000 mm 之间。');
}
async function encodeDepth(file, path) {
  if (!file) return null;
  if (!file.size || file.size > MAX_DEPTH_BYTES || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('请选择 10 MB 以内的 PNG、JPEG 或 WebP 深度图。');
  const bytes = new Uint8Array(await file.arrayBuffer());
  return { bytes, record: { path: path + extensions[file.type], filename: file.name, size: bytes.length, type: file.type, sha256: await sha256(bytes) } };
}
export async function createPhotoPackage(file, photo, campus, depthFile) {
  validateSubmission(file, photo, campus);
  const original = new Uint8Array(await file.arrayBuffer());
  const depth = await encodeDepth(depthFile, 'depth.');
  const manifest = { schemaVersion: 1, kind: 'nsfz-photo-submission', id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    original: { path: 'original.' + extensions[file.type], filename: file.name, size: original.length, type: file.type, sha256: await sha256(original) },
    annotation: packageAnnotation(photo), ...(depth ? { depth: depth.record } : {}) };
  const encoded = strToU8(JSON.stringify(manifest, null, 2));
  if (encoded.length > 64 * 1024) throw new Error('照片资料过长，请缩短描述后重试。');
  const title = photo.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60) || '校园照片';
  // Originals are already compressed. Store them unchanged, without expensive recompression.
  const bytes = zipSync({ 'manifest.json': encoded, [manifest.original.path]: original, ...(depth ? { [depth.record.path]: depth.bytes } : {}),
    '说明.txt': strToU8('附中影像照片投稿\n请把整个 ZIP 包作为附件发送到 ' + SUBMISSION_EMAIL + '。\n包内包含原片、配套深度图（如有）和位置、楼层、拍摄视角等标注，请勿拆分或修改。\n管理员：在本地编辑器的照片页导入 ZIP，核对后保存到内容库，再发布网站。\n生成或下载照片包不代表邮件已经发送或审核通过。\n') }, { level: 0 });
  return { bytes, manifest, filename: '校园投稿-' + title + '-' + manifest.id.slice(0, 8) + '.zip' };
}
export async function createPhotoBatchPackage(entries, campus) {
  if (!Array.isArray(entries) || !entries.length || entries.length > MAX_PACKAGE_PHOTOS) throw new Error('一个照片包请加入 1 到 20 张照片。');
  if (entries.reduce((total, entry) => total + (entry.file.size + (entry.depthFile?.size || 0)), 0) > MAX_PACKAGE_ORIGINAL_BYTES) throw new Error('一个照片包的原片和深度图总大小不能超过 100 MB，请减少照片后再生成。');
  entries.forEach(({ file, photo }) => validateSubmission(file, photo, campus));
  const files = {}, photos = [];
  for (const [index, { file, photo, depthFile }] of entries.entries()) {
    const original = new Uint8Array(await file.arrayBuffer());
    const depth = await encodeDepth(depthFile, 'depths/' + String(index + 1).padStart(2, '0') + '.');
    const path = 'originals/' + String(index + 1).padStart(2, '0') + '.' + extensions[file.type];
    const record = { id: crypto.randomUUID(), original: { path, filename: file.name, size: original.length, type: file.type, sha256: await sha256(original) }, annotation: packageAnnotation(photo), ...(depth ? { depth: depth.record } : {}) };
    if (strToU8(JSON.stringify(record)).length > 64 * 1024) throw new Error('照片资料过长，请缩短描述后重试。');
    files[path] = original;
    if (depth) files[depth.record.path] = depth.bytes;
    photos.push(record);
  }
  const manifest = { schemaVersion: 2, kind: 'nsfz-photo-submission', id: crypto.randomUUID(), createdAt: new Date().toISOString(), photos };
  files['manifest.json'] = strToU8(JSON.stringify(manifest));
  files['说明.txt'] = strToU8('附中影像批量照片投稿\n共 ' + photos.length + ' 张照片。请将整个 ZIP 包作为一封邮件的附件发送到 ' + SUBMISSION_EMAIL + '，不必逐张发送。\n包内包含每张原片、配套深度图（如有）及独立标注，请勿拆分或修改。\n管理员：在本地编辑器的照片页导入整个 ZIP，逐张核对并审核。\n生成或下载照片包不代表邮件已经发送或审核通过。\n');
  return { bytes: zipSync(files, { level: 0 }), manifest, filename: '校园投稿-' + photos.length + '张照片-' + manifest.id.slice(0, 8) + '.zip' };
}
export function submissionMailto(manifest, filename) {
  const photos = manifest.schemaVersion === 2 ? manifest.photos : [manifest];
  const title = String(photos[0].annotation.title).replace(/[\r\n]/g, ' ').slice(0, 160);
  const subject = '附中影像照片投稿：' + (photos.length > 1 ? photos.length + ' 张校园照片' : title);
  const list = photos.map((photo, index) => (index + 1) + '. ' + String(photo.annotation.title).replace(/[\r\n]/g, ' ').slice(0, 60)).join('\n');
  const body = '你好，我想投稿 ' + photos.length + ' 张校园照片，已统一打包在一个 ZIP 中：\n' + list + '\n\n照片包：' + filename + '\n投稿编号：' + manifest.id
    + '\n\n请审核附件中的原片和标注。\n我有权提供此照片，并同意审核通过后在附中影像展示。\n\n【发送前请手动添加上面的 ZIP 照片包作为附件。】';
  return 'mailto:' + SUBMISSION_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}
export async function readPhotoPackages(bytes) {
  if (!bytes.length || bytes.length > MAX_PACKAGE_BYTES) throw new Error('投稿包过大，原片总大小最多 100 MB。');
  const names = new Set();
  let files;
  try {
    files = unzipSync(bytes, { filter(info) {
      if (names.has(info.name) || names.size >= MAX_PACKAGE_PHOTOS * 2 + 2 || !/^(manifest\.json|说明\.txt|original\.(jpg|png|webp|avif)|originals\/(0[1-9]|1[0-9]|20)\.(jpg|png|webp|avif)|depth\.(jpg|png|webp)|depths\/(0[1-9]|1[0-9]|20)\.(jpg|png|webp))$/.test(info.name)) throw new Error('投稿包文件不正确。');
      names.add(info.name);
      const maximum = info.name.startsWith('depth') ? MAX_DEPTH_BYTES : info.name.startsWith('original') ? MAX_PHOTO_BYTES : info.name === 'manifest.json' ? MAX_MANIFEST_BYTES : 64 * 1024;
      // Accept only this site's stored archive format. No untrusted ZIP inflation or filesystem extraction.
      if (info.compression !== 0 || info.size !== info.originalSize || info.originalSize > maximum || info.originalSize < 1) throw new Error('请导入本站直接生成的完整投稿包。');
      return true;
    } });
  } catch (reason) { throw new Error(reason instanceof Error ? reason.message : '无法读取投稿包。'); }
  if (!files['manifest.json']) throw new Error('投稿包缺少照片资料。');
  let manifest;
  try { manifest = JSON.parse(strFromU8(files['manifest.json'])); } catch { throw new Error('投稿包资料格式不正确。'); }
  if (![1, 2].includes(manifest?.schemaVersion) || manifest.kind !== 'nsfz-photo-submission' || !UUID.test(manifest.id)
    || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('投稿包资料格式不正确。');
  const records = manifest.schemaVersion === 1 ? [manifest] : manifest.photos;
  if (!Array.isArray(records) || !records.length || records.length > MAX_PACKAGE_PHOTOS) throw new Error('投稿包照片数量不正确。');
  const expected = new Set(['manifest.json', ...(files['说明.txt'] ? ['说明.txt'] : [])]), photos = [];
  let total = 0;
  for (const [index, record] of records.entries()) {
    const source = record?.original;
    const prefix = manifest.schemaVersion === 1 ? 'original.' : 'originals/' + String(index + 1).padStart(2, '0') + '.';
    if (!UUID.test(record?.id) || !source || !extensions[source.type] || source.path !== prefix + extensions[source.type]
      || typeof source.filename !== 'string' || !source.filename || source.filename.length > 1000 || !/^[a-f0-9]{64}$/.test(source.sha256)
      || !record.annotation || typeof record.annotation !== 'object' || Array.isArray(record.annotation)
      || strToU8(JSON.stringify(record)).length > 64 * 1024) throw new Error('投稿包资料格式不正确。');
    const original = files[source.path];
    if (!original || original.length !== source.size) throw new Error('投稿包原片缺失或大小不一致。');
    total += original.length;
    if (total > MAX_PACKAGE_ORIGINAL_BYTES) throw new Error('投稿包原片总大小最多 100 MB。');
    if (await sha256(original) !== source.sha256) throw new Error('投稿包原片校验失败，请重新下载原包。');
    expected.add(source.path);
    let depth;
    if (record.depth !== undefined) {
      const paired = record.depth;
      const depthPrefix = manifest.schemaVersion === 1 ? 'depth.' : 'depths/' + String(index + 1).padStart(2, '0') + '.';
      if (!paired || !['image/png', 'image/jpeg', 'image/webp'].includes(paired.type) || paired.path !== depthPrefix + extensions[paired.type]
        || typeof paired.filename !== 'string' || !paired.filename || paired.filename.length > 1000 || !/^[a-f0-9]{64}$/.test(paired.sha256)) throw new Error('投稿包深度图资料格式不正确。');
      depth = files[paired.path];
      if (!depth || depth.length !== paired.size || depth.length > MAX_DEPTH_BYTES) throw new Error('投稿包深度图缺失或大小不一致。');
      if (await sha256(depth) !== paired.sha256) throw new Error('投稿包深度图校验失败，请重新下载原包。');
      total += depth.length;
      if (total > MAX_PACKAGE_ORIGINAL_BYTES) throw new Error('投稿包原片和深度图总大小最多 100 MB。');
      expected.add(paired.path);
    }
    photos.push({ manifest: record, original, annotation: packageAnnotation(record.annotation), ...(depth ? { depth } : {}) });
  }
  if (names.size !== expected.size || [...names].some(name => !expected.has(name))) throw new Error('投稿包文件不正确。');
  return { manifest, photos };
}
export async function readPhotoPackage(bytes) {
  const pack = await readPhotoPackages(bytes);
  if (pack.photos.length !== 1) throw new Error('这是多张照片的投稿包，请整体导入。');
  return { ...pack.photos[0], manifest: pack.manifest };
}

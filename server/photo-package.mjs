import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

export const SUBMISSION_EMAIL = 'drivinggodj@icloud.com';
export const MAX_PHOTO_BYTES = 40 * 1024 * 1024;
export const MAX_PACKAGE_BYTES = MAX_PHOTO_BYTES + 128 * 1024;
const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif' };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const annotationFields = ['title', 'description', 'capturedAt', 'locationId', 'buildingId', 'floor', 'captureType', 'altitude', 'position', 'heading', 'pitch', 'placed', 'author', 'copyright', 'view'];

export function packageAnnotation(photo) {
  const annotation = Object.fromEntries(annotationFields.filter(key => photo[key] !== undefined).map(key => [key, photo[key]]));
  annotation.position = { x: photo.position?.x, z: photo.position?.z };
  return annotation;
}
async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function createPhotoPackage(file, photo, campus) {
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
  const original = new Uint8Array(await file.arrayBuffer());
  const manifest = { schemaVersion: 1, kind: 'nsfz-photo-submission', id: crypto.randomUUID(), createdAt: new Date().toISOString(),
    original: { path: 'original.' + extensions[file.type], filename: file.name, size: original.length, type: file.type, sha256: await sha256(original) },
    annotation: packageAnnotation(photo) };
  const encoded = strToU8(JSON.stringify(manifest, null, 2));
  if (encoded.length > 64 * 1024) throw new Error('照片资料过长，请缩短描述后重试。');
  const title = photo.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 60) || '校园照片';
  // Originals are already compressed. Store them unchanged, without expensive recompression.
  const bytes = zipSync({ 'manifest.json': encoded, [manifest.original.path]: original,
    '说明.txt': strToU8('附中影像照片投稿\n请把整个 ZIP 包作为附件发送到 ' + SUBMISSION_EMAIL + '。\n包内包含原片和位置、楼层、拍摄视角等标注，请勿拆分或修改。\n管理员：在本地编辑器的照片页导入 ZIP，核对后保存到内容库，再发布网站。\n生成或下载照片包不代表邮件已经发送或审核通过。\n') }, { level: 0 });
  return { bytes, manifest, filename: '校园投稿-' + title + '-' + manifest.id.slice(0, 8) + '.zip' };
}
export function submissionMailto(manifest, filename) {
  const title = String(manifest.annotation.title).replace(/[\r\n]/g, ' ').slice(0, 160);
  const subject = '附中影像照片投稿：' + title;
  const body = '你好，我想投稿这张校园照片：' + title + '\n\n照片包：' + filename + '\n投稿编号：' + manifest.id
    + '\n\n请审核附件中的原片和标注。\n我有权提供此照片，并同意审核通过后在附中影像展示。\n\n【发送前请手动添加上面的 ZIP 照片包作为附件。】';
  return 'mailto:' + SUBMISSION_EMAIL + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
}
export async function readPhotoPackage(bytes) {
  if (!bytes.length || bytes.length > MAX_PACKAGE_BYTES) throw new Error('投稿包过大，原片最多 40 MB。');
  const names = new Set();
  let files;
  try {
    files = unzipSync(bytes, { filter(info) {
      if (names.has(info.name) || names.size >= 3 || !/^(manifest\.json|说明\.txt|original\.(jpg|png|webp|avif))$/.test(info.name)) throw new Error('投稿包文件不正确。');
      names.add(info.name);
      const maximum = info.name.startsWith('original.') ? MAX_PHOTO_BYTES : 64 * 1024;
      // Accept only this site's stored archive format. No untrusted ZIP inflation or filesystem extraction.
      if (info.compression !== 0 || info.size !== info.originalSize || info.originalSize > maximum || info.originalSize < 1) throw new Error('请导入本站直接生成的完整投稿包。');
      return true;
    } });
  } catch (reason) { throw new Error(reason instanceof Error ? reason.message : '无法读取投稿包。'); }
  if (!files['manifest.json']) throw new Error('投稿包缺少照片资料。');
  let manifest;
  try { manifest = JSON.parse(strFromU8(files['manifest.json'])); } catch { throw new Error('投稿包资料格式不正确。'); }
  const source = manifest?.original;
  if (manifest?.schemaVersion !== 1 || manifest.kind !== 'nsfz-photo-submission' || !UUID.test(manifest.id)
    || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))
    || !source || !extensions[source.type] || source.path !== 'original.' + extensions[source.type]
    || typeof source.filename !== 'string' || source.filename.length > 1000 || !/^[a-f0-9]{64}$/.test(source.sha256)
    || !manifest.annotation || typeof manifest.annotation !== 'object' || Array.isArray(manifest.annotation)) throw new Error('投稿包资料格式不正确。');
  const original = files[source.path];
  if (!original || original.length !== source.size || names.size !== (files['说明.txt'] ? 3 : 2)) throw new Error('投稿包原片缺失或大小不一致。');
  if (await sha256(original) !== source.sha256) throw new Error('投稿包原片校验失败，请重新下载原包。');
  return { manifest, original, annotation: packageAnnotation(manifest.annotation) };
}

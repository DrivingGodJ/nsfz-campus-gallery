import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { createPhotoPackage, readPhotoPackage, submissionMailto, MAX_PACKAGE_BYTES } from '../server/photo-package.mjs';
import { importPhotoPackage } from '../server/package-import.mjs';
import { createStore } from '../server/storage.mjs';

const annotation = { title: '天井 & 窗边', description: '拍摄标注', capturedAt: '2025-08-20T14:44:50', locationId: '', buildingId: '', floor: 0,
  captureType: 'ground', position: { x: 0, z: 0, height: 999 }, heading: 121, pitch: 22, placed: true, author: '', copyright: '', view: { focalLength35Mm: 24 } };
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-package-'));
  await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
  await fs.copyFile(new URL('../public/data/campus.json', import.meta.url), path.join(root, 'public/data/campus.json'));
  const bytes = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#666655' } }).jpeg().toBuffer();
  const file = new File([bytes], '原片.jpg', { type: 'image/jpeg' });
  const pack = await createPhotoPackage(file, annotation);
  return { root, store: createStore(root), bytes, file, pack, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
test('browser packages preserve the original and annotations and email links target the owner', async () => {
  const f = await fixture();
  try {
    const decoded = await readPhotoPackage(f.pack.bytes);
    assert.deepEqual(Buffer.from(decoded.original), f.bytes);
    assert.deepEqual(decoded.annotation, { ...annotation, position: { x: 0, z: 0 } });
    assert.equal(decoded.manifest.original.filename, '原片.jpg');
    const mail = new URL(submissionMailto(f.pack.manifest, f.pack.filename));
    assert.equal(mail.pathname, 'drivinggodj@icloud.com');
    assert.equal(mail.searchParams.get('subject'), '附中影像照片投稿：天井 & 窗边');
    assert.match(mail.searchParams.get('body'), /手动添加.*ZIP/);
    assert.ok(mail.searchParams.get('body').includes(f.pack.filename));
    assert.equal(mail.searchParams.size, 2);
    const safe = await createPhotoPackage(f.file, { ...annotation, title: '../标题\n尾部' });
    assert.ok(!/[\/\\\n]/.test(safe.filename));
    assert.ok(!new URL(submissionMailto(safe.manifest, safe.filename)).searchParams.get('subject').includes('\n'));
  } finally { await f.cleanup(); }
});
test('email packages import into private drafts with their location, floor and view ready for review', async () => {
  const f = await fixture();
  try {
    const map = (await f.store.state()).map;
    const building = map.buildings[0];
    const pack = await createPhotoPackage(f.file, { ...annotation, locationId: building.id, buildingId: building.id, floor: 3, author: '原片作者', copyright: '原片版权' });
    const { photo, submissionId } = await importPhotoPackage(f.store, pack.bytes);
    assert.equal(submissionId, pack.manifest.id); assert.notEqual(photo.id, pack.manifest.id);
    assert.equal(photo.floor, 3); assert.equal(photo.buildingId, building.id);
    assert.equal(photo.heading, 121); assert.equal(photo.pitch, 22); assert.equal(photo.view.focalLength35Mm, 24);
    assert.equal(photo.author, '原片作者'); assert.equal(photo.copyright, '原片版权');
    assert.deepEqual(photo.position, { x: 0, z: 0 });
    assert.deepEqual(await fs.readFile(path.join(f.root, '.local/originals', photo.id, 'source.jpeg')), f.bytes);
    const state = await f.store.state();
    assert.equal(state.drafts.length, 1); assert.equal(state.site.photos.length, 0);
    await assert.rejects(fs.access(path.join(f.root, 'public/media', photo.id)));
    const published = await f.store.publish(photo.id, 0);
    assert.equal(published.title, annotation.title); assert.equal((await f.store.state()).site.photos.length, 1);
  } finally { await f.cleanup(); }
});
test('unsafe archives, damaged originals and invalid annotations cannot create drafts', async () => {
  const f = await fixture();
  try {
    const entries = unzipSync(f.pack.bytes);
    const invalid = [];
    invalid.push(zipSync({ ...entries, '../escape.jpg': new Uint8Array([1]) }, { level: 0 }));
    invalid.push(zipSync(entries, { level: 6 }));
    invalid.push(zipSync({ ...entries, 'original.jpg': new Uint8Array([1, 2, 3]) }, { level: 0 }));
    invalid.push(zipSync({ ...entries, 'manifest.json': strToU8('{broken') }, { level: 0 }));
    for (const patch of [{ floor: 1 }, { position: { x: Infinity, z: 0 } }, { placed: false }, { locationId: 'unknown' }]) {
      const manifest = JSON.parse(strFromU8(entries['manifest.json']));
      Object.assign(manifest.annotation, patch);
      invalid.push(zipSync({ ...entries, 'manifest.json': strToU8(JSON.stringify(manifest)) }, { level: 0 }));
    }
    for (const pack of invalid) await assert.rejects(importPhotoPackage(f.store, pack));
    assert.equal((await f.store.state()).drafts.length, 0);
    await assert.rejects(readPhotoPackage(new Uint8Array(MAX_PACKAGE_BYTES + 1)), /过大/);
    await assert.rejects(createPhotoPackage(new File(['x'], 'file.txt', { type: 'text/plain' }), annotation), /JPEG/);
    await assert.rejects(createPhotoPackage(f.file, { ...annotation, placed: false }), /标记/);
    await assert.rejects(createPhotoPackage(f.file, { ...annotation, view: { focalLength35Mm: 0 } }), /焦距/);
    await assert.rejects(createPhotoPackage(f.file, { ...annotation, position: { x: 10000, z: 0 } }, (await f.store.state()).map), /地图范围/);
    const corrupt = { ...entries, 'original.jpg': entries['original.jpg'].slice() };
    corrupt['original.jpg'][0] ^= 1;
    await assert.rejects(readPhotoPackage(zipSync(corrupt, { level: 0 })), /校验失败/);
  } finally { await f.cleanup(); }
});

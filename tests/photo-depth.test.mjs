import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { createStore, exportStaticContent, ASSET_PATTERN } from '../server/storage.mjs';
import { PHOTO_DEPTH_FILE, normalizePhotoDepth } from '../server/photo-depth.mjs';
import { createPhotoPackage, createPhotoBatchPackage, readPhotoPackages } from '../server/photo-package.mjs';
import { importPhotoPackage } from '../server/package-import.mjs';
import { photoDepthFile } from '../src/photo-image.ts';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-depth-upload-'));
  await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
  await fs.copyFile(new URL('../public/data/campus.json', import.meta.url), path.join(root, 'public/data/campus.json'));
  await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
  const original = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#456744' } }).jpeg().toBuffer();
  const depth = await sharp(Buffer.from(Array.from({ length: 80 * 40 }, (_, i) => Math.floor(i / 80) * 6)), { raw: { width: 80, height: 40, channels: 1 } }).png().toBuffer();
  const file = new File([original], '校园.jpg', { type: 'image/jpeg' }), depthFile = new File([depth], '校园深度.png', { type: 'image/png' });
  const photo = { title: '校园', description: '', capturedAt: '', buildingId: '', floor: 0, position: { x: 0, z: 0 }, heading: 0, pitch: 0, placed: true };
  return { root, store: createStore(root), original, depth, file, depthFile, photo, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

test('paired maps travel through single/batch packages, private review, publication and static export', async () => {
  const f = await fixture();
  try {
    for (const pack of [await createPhotoPackage(f.file, f.photo, undefined, f.depthFile), await createPhotoBatchPackage([{ file: f.file, photo: f.photo, depthFile: f.depthFile }, { file: f.file, photo: f.photo }])]) {
      const read = await readPhotoPackages(pack.bytes);
      assert.deepEqual(Buffer.from(read.photos[0].depth), f.depth);
      if (read.photos.length === 2) assert.equal(read.photos[1].depth, undefined);
    }
    const pack = await createPhotoBatchPackage([{ file: f.file, photo: f.photo, depthFile: f.depthFile }]);
    const { photo } = await importPhotoPackage(f.store, pack.bytes);
    assert.match(photo.files.depth, /depth.webp$/);
    assert.equal((await f.store.state()).site.photos.length, 0, 'import is still private');
    const normalized = await fs.readFile(path.join(f.root, '.local/draft-media', photo.id, PHOTO_DEPTH_FILE));
    const gray = await sharp(normalized).greyscale().raw().toBuffer();
    assert.equal(gray[0], 0); assert.equal(gray.at(-1), 234, 'uploaded black-near convention stays unchanged');
    assert.deepEqual(await fs.readFile(path.join(f.root, '.local/originals', photo.id, 'source.jpeg')), f.original);
    const published = await f.store.publish(photo.id, 0);
    assert.deepEqual(await fs.readFile(path.join(f.root, 'public', published.files.depth)), normalized);
    const output = path.join(f.root, 'export'); await exportStaticContent(f.root, output);
    assert.deepEqual(await fs.readFile(path.join(output, published.files.depth)), normalized);
  } finally { await f.cleanup(); }
});

test('wrong proportions and damaged/misbound depth maps cannot leave half-imported drafts', async () => {
  const f = await fixture();
  try {
    const pack = await createPhotoBatchPackage([{ file: f.file, photo: f.photo }, { file: f.file, photo: f.photo, depthFile: f.depthFile }]);
    const files = unzipSync(pack.bytes), damaged = { ...files, 'depths/02.png': files['depths/02.png'].slice() }; damaged['depths/02.png'][0] ^= 1;
    await assert.rejects(importPhotoPackage(f.store, zipSync(damaged, { level: 0 })), /深度图校验失败/);
    const manifest = structuredClone(pack.manifest); manifest.photos[1].depth.path = 'depths/01.png';
    await assert.rejects(readPhotoPackages(zipSync({ ...files, 'manifest.json': strToU8(JSON.stringify(manifest)) }, { level: 0 })), /深度图资料格式/);
    await assert.rejects(normalizePhotoDepth(f.depth, { width: 40, height: 80 }), /比例/);
    const badFile = new File(['invalid'], 'bad.png', { type: 'image/png' });
    const bad = await createPhotoBatchPackage([{ file: f.file, photo: f.photo, depthFile: f.depthFile }, { file: f.file, photo: f.photo, depthFile: badFile }]);
    await assert.rejects(importPhotoPackage(f.store, bad.bytes), /读取深度图/);
    assert.equal((await f.store.state()).drafts.length, 0);
    await assert.rejects(createPhotoPackage(f.file, f.photo, undefined, new File(['x'], 'x.avif', { type: 'image/avif' })), /深度图/);
  } finally { await f.cleanup(); }
});

test('replacing/removing published maps keeps backups, enforces revisions and changes cache versions', async () => {
  const f = await fixture();
  try {
    const draft = await f.store.importPhoto(f.original);
    await f.store.updateDraft(draft.id, { ...draft, ...f.photo });
    await f.store.setPhotoDepth(draft.id, f.depth);
    const published = await f.store.publish(draft.id, 0);
    const first = await fs.readFile(path.join(f.root, 'public', published.files.depth));
    const next = await f.store.setPhotoDepth(draft.id, f.depth, 1);
    assert.notEqual(photoDepthFile(next), photoDepthFile(published));
    await assert.rejects(f.store.setPhotoDepth(draft.id, f.depth, 1), /其他窗口更新/);
    const removed = await f.store.setPhotoDepth(draft.id, null, 2);
    assert.equal(photoDepthFile(removed), null);
    const backups = path.join(f.root, '.local/backups/depths', draft.id);
    assert.equal((await fs.readdir(backups)).length, 2);
    for (const name of await fs.readdir(backups)) assert.deepEqual(await fs.readFile(path.join(backups, name)), first);
    assert.ok(ASSET_PATTERN.test(published.files.depth));
    assert.equal(ASSET_PATTERN.test('media/../../secret/depth.webp'), false);
  } finally { await f.cleanup(); }
});

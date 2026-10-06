import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { createStore, exportStaticContent, ASSET_PATTERN } from '../server/storage.mjs';
import { PHOTO_DEPTH_FILE, PHOTO_DEPTH_EDGE, PHOTO_DEPTH_OUTPUT_BYTES, normalizePhotoDepth } from '../server/photo-depth.mjs';
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

test('depth compression bounds noisy maps, keeps orientation and retains near/far ordering', async () => {
  const width = 1200, height = 800;
  let seed = 42;
  const values = Uint8Array.from({ length: width * height }, () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed >>> 24; });
  const noisy = await sharp(values, { raw: { width, height, channels: 1 } }).png().toBuffer();
  const compact = await normalizePhotoDepth(noisy, { width, height });
  const metadata = await sharp(compact).metadata();
  assert.ok(compact.length <= PHOTO_DEPTH_OUTPUT_BYTES);
  assert.ok(Math.max(metadata.width, metadata.height) <= PHOTO_DEPTH_EDGE);
  assert.ok(Math.abs(metadata.width / metadata.height - width / height) < .01);
  const f = await fixture();
  try {
    const depth = await normalizePhotoDepth(f.depth, { width: 80, height: 40 });
    const gray = await sharp(depth).greyscale().raw().toBuffer();
    assert.ok(gray[0] < 4);
    assert.ok(gray.at(-1) > 230);
  } finally { await f.cleanup(); }
});

test('local imports generate compressed depth and packages keep supplied maps', async () => {
  const f = await fixture();
  const sources = [];
  const store = createStore(f.root, { generateDepth: async source => { sources.push(source); return f.depth; } });
  try {
    const draft = await store.importPhoto(f.original);
    assert.ok(draft.files.depth);
    assert.equal(sources.length, 1);
    assert.equal(path.basename(sources[0]), 'preview.webp');
    assert.equal((await store.state()).site.photos.length, 0);
    assert.deepEqual(await fs.readFile(path.join(f.root, '.local/originals', draft.id, 'source.jpeg')), f.original);
    const pack = await createPhotoBatchPackage([{ file: f.file, photo: f.photo, depthFile: f.depthFile }, { file: f.file, photo: f.photo }]);
    const imported = await importPhotoPackage(store, pack.bytes);
    assert.equal(sources.length, 2, 'paired map skips inference, missing map is generated');
    for (const photo of imported.photos) assert.ok(photo.files.depth);
  } finally { await f.cleanup(); }
});

test('generation failures keep editable originals and retry restores the depth map', async () => {
  const f = await fixture();
  let fail = true;
  const store = createStore(f.root, { generateDepth: async () => { if (fail) throw new Error('offline'); return f.depth; } });
  try {
    const draft = await store.importPhoto(f.original);
    assert.equal(draft.files.depth, undefined);
    assert.match(draft.depthGenerationError, /照片已保留/);
    assert.equal((await store.state()).drafts.length, 1);
    assert.deepEqual(await fs.readFile(path.join(f.root, '.local/originals', draft.id, 'source.jpeg')), f.original);
    fail = false;
    const retried = await store.generatePhotoDepth(draft.id);
    assert.ok(retried.files.depth);
    assert.equal(retried.depthGenerationError, undefined);
    await store.updateDraft(draft.id, { ...retried, ...f.photo, id: draft.id });
    const published = await store.publish(draft.id, 0);
    assert.ok(published.files.depth);
    assert.ok((await fs.stat(path.join(f.root, 'public', published.files.depth))).size <= PHOTO_DEPTH_OUTPUT_BYTES);
  } finally { await f.cleanup(); }
});

test('slow generation cannot replace a concurrently supplied draft depth', async () => {
  const f = await fixture();
  let complete;
  const store = createStore(f.root, { generateDepth: () => new Promise(resolve => { complete = resolve; }) });
  try {
    const draft = await f.store.importPhoto(f.original);
    const request = store.generatePhotoDepth(draft.id);
    while (!complete) await new Promise(resolve => setImmediate(resolve));
    const supplied = await store.setPhotoDepth(draft.id, f.depth);
    complete(f.depth);
    await assert.rejects(request, /其他窗口更新/);
    assert.equal((await store.state()).drafts[0].depthUpdatedAt, supplied.depthUpdatedAt);
  } finally { await f.cleanup(); }
});

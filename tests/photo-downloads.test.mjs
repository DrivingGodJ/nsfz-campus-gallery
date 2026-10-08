import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { createPhotoDownload, PHOTO_DOWNLOAD_MAX_BYTES } from '../server/photo-preview.mjs';
import { createStore, exportStaticContent } from '../server/storage.mjs';

test('new imports bound noisy full-size downloads to 5 MB and preserve the private source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-download-'));
  try {
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.copyFile(new URL('../public/data/campus.json', import.meta.url), path.join(root, 'public/data/campus.json'));
    const width = 3072, height = 2304;
    const bytes = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer();
    assert.ok(bytes.length > PHOTO_DOWNLOAD_MAX_BYTES, 'fixture exercises compression of an oversized photo');
    const store = createStore(root), draft = await store.importPhoto(bytes);
    const download = await fs.readFile(path.join(root, '.local/draft-media', draft.id, 'download.jpg'));
    assert.ok(download.length <= PHOTO_DOWNLOAD_MAX_BYTES);
    assert.equal(draft.downloadBytes, download.length);
    assert.deepEqual([draft.width, draft.height], [width, height], 'quality is reduced before full image dimensions');
    assert.deepEqual(await fs.readFile(path.join(root, '.local/originals', draft.id, 'source.jpeg')), bytes);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('small downloads retain full dimensions and quality after orientation and sRGB normalization', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-download-'));
  try {
    const source = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#47694e' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const destination = path.join(root, 'download.jpg'), result = await createPhotoDownload(source, destination);
    const metadata = await sharp(destination).metadata();
    assert.deepEqual([result.width, result.height], [40, 80]);
    assert.equal(result.quality, 95);
    assert.equal(result.size, (await fs.stat(destination)).size);
    assert.equal(metadata.format, 'jpeg'); assert.equal(metadata.space, 'srgb');
    assert.equal(metadata.orientation, undefined); assert.equal(metadata.exif, undefined);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('download generation downsizes only when the acceptable quality floor cannot fit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-download-'));
  try {
    const width = 500, height = 350;
    const source = await sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).png().toBuffer();
    const minimum = await sharp(source).jpeg({ quality: 65, mozjpeg: true }).toBuffer();
    assert.ok(minimum.length > 10000);
    const result = await createPhotoDownload(source, path.join(root, 'download.jpg'), { maxBytes: 10000 });
    assert.ok(result.size <= 10000); assert.ok(result.width < width); assert.ok(result.height < height);
    assert.ok(Math.abs(result.width / result.height - width / height) < .02);
    assert.ok(result.quality >= 65);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('static export rejects oversized downloads even when recorded downloadBytes is stale', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-download-'));
  try {
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.copyFile(new URL('../public/data/campus.json', import.meta.url), path.join(root, 'public/data/campus.json'));
    const source = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#47694e' } }).jpeg().toBuffer();
    const store = createStore(root), draft = await store.importPhoto(source);
    await store.updateDraft(draft.id, { ...draft, placed: true });
    const published = await store.publish(draft.id, 0);
    const download = path.join(root, 'public', published.files.download);
    await fs.truncate(download, PHOTO_DOWNLOAD_MAX_BYTES);
    await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
    await exportStaticContent(root, path.join(root, 'at-limit'));
    await fs.truncate(download, PHOTO_DOWNLOAD_MAX_BYTES + 1);
    await assert.rejects(exportStaticContent(root, path.join(root, 'over-limit')), /下载图片超过 5 MB/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

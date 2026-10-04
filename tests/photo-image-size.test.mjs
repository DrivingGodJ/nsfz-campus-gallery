import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { createBoundedPhotoWebP, createPhotoDisplay, PHOTO_DISPLAY_MAX_BYTES } from '../server/photo-preview.mjs';

test('detailed photos fit the display byte limit and remain decodable without changing the source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'photo-size-'));
  try {
    const bytes = crypto.randomBytes(2400 * 2400 * 3);
    const source = await sharp(bytes, { raw: { width: 2400, height: 2400, channels: 3 } }).png().toBuffer();
    const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
    const file = path.join(root, 'display.webp');
    await createPhotoDisplay(source, file);
    assert.ok((await fs.stat(file)).size < PHOTO_DISPLAY_MAX_BYTES);
    const image = await sharp(file).metadata();
    assert.equal(image.format, 'webp');
    assert.equal(image.width, image.height);
    assert.ok(image.width <= 2400 && image.width > 1000);
    await sharp(file).raw().toBuffer();
    assert.equal(crypto.createHash('sha256').update(source).digest('hex'), sourceHash);
    const tiny = path.join(root, 'tiny.webp');
    await createBoundedPhotoWebP(source, tiny, { edge: 500, quality: 88, maxBytes: 16000 });
    assert.ok((await fs.stat(tiny)).size < 16000);
    assert.ok((await sharp(tiny).metadata()).width < 500, 'Very small budgets can reduce dimensions after quality reduction');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

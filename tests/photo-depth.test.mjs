import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createStore, exportStaticContent, ASSET_PATTERN } from '../server/storage.mjs';
import { PHOTO_DEPTH_FILE, invertDepth, photoDepthModelFile, requirePhotoDepthModel } from '../server/photo-depth.mjs';
import { availableDepthSources, resolveDepthSource } from '../src/depth-source.ts';
import { photoDepthFile } from '../src/photo-image.ts';

const model = files => ({ id: 'photo', title: '照片', files });

test('a photo with a precomputed map defaults to the photo source, otherwise to the model', () => {
  const withDepth = model({ thumbnail: 't.webp', depth: 'media/a/depth.webp', display: 'd.webp', download: 'x.jpg' });
  const withoutDepth = model({ thumbnail: 't.webp', display: 'd.webp', download: 'x.jpg' });
  assert.deepEqual(availableDepthSources(withDepth), ['photo', 'model']);
  assert.deepEqual(availableDepthSources(withoutDepth), ['model']);
  assert.equal(resolveDepthSource(withDepth), 'photo', 'the photo estimate is the better map, so it wins by default');
  assert.equal(resolveDepthSource(withoutDepth), 'model');
  assert.equal(resolveDepthSource(null), 'model');
  assert.equal(resolveDepthSource(undefined), 'model');
  assert.equal(photoDepthFile(withDepth), 'media/a/depth.webp?v=1');
  assert.equal(photoDepthFile(withoutDepth), null, 'the version query lets a regenerated map replace a cached one');
});

test('an explicit source wins while it is available and falls back when it is not', () => {
  const withDepth = model({ thumbnail: 't.webp', depth: 'media/a/depth.webp', display: 'd.webp', download: 'x.jpg' });
  const withoutDepth = model({ thumbnail: 't.webp', display: 'd.webp', download: 'x.jpg' });
  assert.equal(resolveDepthSource(withDepth, 'model'), 'model', 'the user may still prefer the model view');
  assert.equal(resolveDepthSource(withoutDepth, 'model'), 'model');
  // A draft, or a library that was never processed, must not leave the button
  // aimed at a depth.webp that does not exist.
  assert.equal(resolveDepthSource(withoutDepth, 'photo'), 'model');
  assert.equal(resolveDepthSource(null, 'photo'), 'model');
});

test('the model-based convention is restored by inverting the prediction', () => {
  // Depth Anything predicts relative inverse depth, i.e. bright = near, which is
  // the opposite of the app's near = black, so the writer flips every level.
  const predicted = Uint8Array.from([0, 1, 127, 254, 255]);
  assert.deepEqual([...invertDepth(predicted)], [255, 254, 128, 1, 0]);
  assert.deepEqual([...invertDepth(invertDepth(predicted))], [...predicted], 'the flip is its own inverse');
  assert.deepEqual([...invertDepth(new Uint8Array(0))], []);
});

test('the dtype picks the same weights file the runner expects', () => {
  // Mirrors DEFAULT_DTYPE_SUFFIX_MAPPING (node_modules/@huggingface/transformers/src/utils/dtypes.js:59).
  assert.equal(photoDepthModelFile('fp32'), 'model.onnx');
  assert.equal(photoDepthModelFile('fp16'), 'model_fp16.onnx');
  assert.equal(photoDepthModelFile('q8'), 'model_quantized.onnx');
  assert.equal(photoDepthModelFile('q4f16'), 'model_q4f16.onnx');
  assert.equal(photoDepthModelFile('nonsense'), 'model.onnx', 'an unknown dtype falls back to the full model');
});

test('a missing model reports the exact files to fetch instead of failing deep inside the runner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-depth-model-'));
  try {
    await assert.rejects(requirePhotoDepthModel(root), error => {
      assert.match(error.message, /缺少深度模型文件/);
      assert.match(error.message, /onnx-community\/depth-anything-v2-small\/resolve\/main\/onnx\/model\.onnx/);
      assert.match(error.message, /-x http:\/\/127\.0\.0\.1:7897/, 'the note names the proxy mainland networks need');
      return true;
    });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('depth maps are an accepted asset but path traversal still is not', () => {
  assert.equal(ASSET_PATTERN.test('media/8cf1e176-fe09-4c3b-9e04-a84286f36f4e/' + PHOTO_DEPTH_FILE), true);
  for (const file of ['media/../../secret', '/etc/passwd', 'media/8cf1e176-fe09-4c3b-9e04-a84286f36f4e/depth.png']) {
    assert.equal(ASSET_PATTERN.test(file), false, file + ' must stay rejected');
  }
});

test('backfilling writes depth.webp, records it, exports it, and skips on a second run', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-depth-backfill-'));
  const store = createStore(root);
  try {
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.copyFile(new URL('../public/data/campus.json', import.meta.url), path.join(root, 'public/data/campus.json'));
    await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
    const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#47694e' } }).jpeg().toBuffer();
    const draft = await store.importPhoto(bytes);
    await store.updateDraft(draft.id, { ...draft, placed: true });
    const published = await store.publish(draft.id, 0);

    // A stand-in for the model: the storage layer only needs a gray prediction, so
    // this covers the whole pipeline without the 94 MB of weights.
    const calls = [];
    const estimate = async source => {
      calls.push(source);
      const width = 40, height = 30;
      const data = new Uint8Array(width * height);
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = y * 8;
      return { depth: { data, width, height } };
    };
    const first = await store.backfillPhotoDepths({ estimate });
    assert.equal(first.generated, 1);
    assert.equal(first.skipped, 0);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /preview\.webp$/, 'the depth map is derived from the browsing rendition');
    const depthFile = path.join(root, 'public/media', draft.id, PHOTO_DEPTH_FILE);
    // Read the bytes once and decode from the buffer: libvips keeps a handle on a
    // file it opened by path, which then blocks the temp-directory cleanup on Windows.
    const written = await fs.readFile(depthFile);
    const saved = (await store.state()).site.photos[0];
    assert.equal(saved.files.depth, 'media/' + draft.id + '/' + PHOTO_DEPTH_FILE);
    assert.equal(published.files.depth, undefined, 'the published record is only updated by the backfill');
    // The written file must carry the app's convention: the prediction rose from
    // top to bottom (near at the top), so the map has to fall.
    const decoded = await sharp(written).toColourspace('b-w').raw().toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 40);
    assert.equal(decoded.info.height, 30);
    assert.ok(decoded.data[0] > decoded.data[decoded.data.length - 1], 'near stays black after the flip');

    const second = await store.backfillPhotoDepths({ estimate });
    assert.equal(second.generated, 0);
    assert.equal(second.skipped, 1, 'existing maps are not recomputed');
    assert.equal(calls.length, 1);

    const output = path.join(root, 'export');
    await exportStaticContent(root, output);
    assert.deepEqual(await fs.readFile(path.join(output, saved.files.depth)), written);

    const forced = await store.backfillPhotoDepths({ estimate, refresh: true });
    assert.equal(forced.generated, 1);
    assert.ok(forced.backup, 'refreshing keeps the previous map');
    assert.deepEqual(await fs.readFile(path.join(forced.backup, 'published', draft.id, PHOTO_DEPTH_FILE)), written);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

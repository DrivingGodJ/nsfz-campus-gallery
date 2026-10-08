import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assetURL } from '../src/asset-url.ts';
import { downloadPhotoFile, externalPhotoDownload } from '../src/photo-download.ts';
import { exportStaticContent } from '../server/storage.mjs';

const mediaBaseURL = 'https://raw.githubusercontent.com/DrivingGodJ/nsfz-campus-media/main/';
test('only production photo assets use the separate repository and preserve asset versions', () => {
  const file = 'media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/depth.webp?v=depth-version';
  assert.equal(assetURL(file, '/nsfz-campus-gallery/', mediaBaseURL), mediaBaseURL + file);
  assert.equal(assetURL(file, '/nsfz-campus-gallery/', mediaBaseURL.slice(0, -1)), mediaBaseURL + file);
  assert.equal(assetURL('data/site.json', '/nsfz-campus-gallery/', mediaBaseURL), '/nsfz-campus-gallery/data/site.json');
  assert.equal(assetURL('favicon.svg', './', mediaBaseURL), './favicon.svg');
  assert.equal(assetURL(file, './', mediaBaseURL, true), './' + file, 'the local editor keeps using local media');
  assert.equal(assetURL(file, './'), './' + file, 'a standalone build retains local assets');
});

test('cross-origin JPEG downloads request bytes only when invoked and save under the photo filename', async t => {
  const requests = [], clicked = [], cleaned = [], timers = [];
  const previousDocument = globalThis.document;
  globalThis.document = {
    body: { appendChild(link) { assert.equal(link.download, '校园.jpg'); } },
    createElement(tag) { assert.equal(tag, 'a'); return { click() { clicked.push([this.href, this.download]); }, remove() { cleaned.push('link'); } }; }
  };
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument; });
  t.mock.method(globalThis, 'fetch', async url => { requests.push(url); return new Response('jpeg-bytes', { headers: { 'Content-Type': 'image/jpeg' } }); });
  t.mock.method(URL, 'createObjectURL', blob => { assert.equal(blob.type, 'image/jpeg'); return 'blob:photo-download'; });
  t.mock.method(URL, 'revokeObjectURL', url => cleaned.push(url));
  t.mock.method(globalThis, 'setTimeout', callback => { timers.push(callback); return 0; });
  const page = 'https://drivinggodj.github.io/nsfz-campus-gallery/';
  assert.equal(externalPhotoDownload(mediaBaseURL + 'media/id/download.jpg', page), true);
  assert.equal(externalPhotoDownload('./media/id/download.jpg', page), false);
  assert.deepEqual(requests, []);
  await downloadPhotoFile(mediaBaseURL + 'media/id/download.jpg', '校园.jpg');
  assert.deepEqual(requests, [mediaBaseURL + 'media/id/download.jpg']);
  assert.deepEqual(clicked, [['blob:photo-download', '校园.jpg']]);
  assert.deepEqual(cleaned, ['link']);
  timers[0](); assert.deepEqual(cleaned, ['link', 'blob:photo-download']);
});

test('failed remote downloads do not create or save an error document', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('not found', { status: 404 }));
  t.mock.method(URL, 'createObjectURL', () => assert.fail('failed responses cannot become downloads'));
  await assert.rejects(downloadPhotoFile(mediaBaseURL + 'media/id/download.jpg', '校园.jpg'), /下载失败/);
});

test('external static builds validate photo declarations but require and export no media files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-external-media-'));
  try {
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.copyFile(new URL('../public/data/campus.json', import.meta.url), path.join(root, 'public/data/campus.json'));
    await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
    const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const photo = { id, title: '外部仓库照片', description: '', capturedAt: '', buildingId: '', floor: 0, placed: true,
      position: { x: 0, z: 0 }, heading: 0, pitch: 0, width: 80, height: 40, downloadBytes: 5000000,
      files: { thumbnail: 'media/' + id + '/thumbnail.webp', display: 'media/' + id + '/display.webp',
        depth: 'media/' + id + '/depth.webp', download: 'media/' + id + '/download.jpg' } };
    const site = { schemaVersion: 1, revision: 1, photos: [photo], buildingOverrides: {} };
    const write = () => fs.writeFile(path.join(root, 'public/data/site.json'), JSON.stringify(site));
    await write();
    const output = path.join(root, 'dist');
    await exportStaticContent(root, output, { mediaBaseURL });
    const exported = JSON.parse(await fs.readFile(path.join(output, 'data/site.json')));
    assert.deepEqual(exported.photos[0].files, photo.files);
    await assert.rejects(fs.access(path.join(output, 'media')));
    await assert.rejects(exportStaticContent(root, path.join(root, 'local')), { code: 'ENOENT' });
    photo.downloadBytes = 5000001; await write();
    await assert.rejects(exportStaticContent(root, output, { mediaBaseURL }), /5 MB/);
    photo.downloadBytes = 1; photo.files.thumbnail = 'media/../../private.webp'; await write();
    await assert.rejects(exportStaticContent(root, output, { mediaBaseURL }), /路径/);
    await assert.rejects(exportStaticContent(root, output, { mediaBaseURL: 'javascript:alert(1)' }), /仓库地址/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

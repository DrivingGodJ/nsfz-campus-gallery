import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { collectMediaAssets, prepareMediaAssets } from '../server/media-publication.mjs';

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const otherId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const names = { thumbnail: 'thumbnail.webp', preview: 'preview.webp', display: 'display.webp', depth: 'depth.webp', download: 'download.jpg' };
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function fixture(t) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-media-publication-'));
  const root = path.join(workspace, 'nsfz-campus-gallery');
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  const write = async (file, bytes) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), bytes);
  };
  const photo = { id, files: Object.fromEntries(Object.entries(names).map(([kind, name]) => [kind, `media/${id}/${name}`])) };
  const contents = new Map();
  for (const file of Object.values(photo.files)) {
    const bytes = Buffer.from('public photo: ' + file);
    contents.set(file, bytes);
    await write('public/' + file, bytes);
  }
  photo.downloadBytes = contents.get(photo.files.download).length;
  const site = { revision: 17, photos: [photo] };
  const save = () => write('public/data/site.json', JSON.stringify(site));
  await save();
  return { root, write, photo, site, save, contents };
}

test('media snapshot includes only referenced saved photo files and remains independent of later local edits', async t => {
  const f = await fixture(t);
  await f.write('.local/drafts.json', JSON.stringify([{ id: otherId, files: { download: `media/${otherId}/download.jpg` } }]));
  await f.write(`.local/draft-media/${otherId}/download.jpg`, 'draft');
  await f.write(`.local/originals/${id}/source.jpeg`, 'private source');
  await f.write(`public/media/${otherId}/download.jpg`, 'unreferenced public orphan');
  await f.write(`public/media/${id}/source.jpeg`, 'unreferenced source');
  // Repeated references represent one object, rather than extra uploaded files.
  f.photo.files.alternateThumbnail = f.photo.files.thumbnail;
  await f.save();
  const destination = path.join(f.root, '.local/snapshot');
  const snapshot = await prepareMediaAssets(f.root, { destination });
  assert.equal(snapshot.revision, 17);
  assert.equal(snapshot.photoCount, 1);
  assert.equal(snapshot.directory, destination);
  assert.deepEqual(snapshot.assets, [...f.contents].sort(([a], [b]) => a.localeCompare(b)).map(([key, bytes]) => ({ key, bytes: bytes.length, sha256: sha256(bytes) })));
  assert.deepEqual((await fs.readdir(destination)).sort(), ['_headers', 'media']);
  assert.deepEqual(await fs.readdir(path.join(destination, 'media')), [id]);
  assert.deepEqual((await fs.readdir(path.join(destination, 'media', id))).sort(), Object.values(names).sort());
  const headers = await fs.readFile(path.join(destination, '_headers'), 'utf8');
  assert.match(headers, /^\/\*\n/);
  assert.match(headers, /Access-Control-Allow-Origin: \*/);
  assert.match(headers, /Access-Control-Expose-Headers:.*Content-Length/);
  for (const [key, bytes] of f.contents) {
    await f.write('public/' + key, 'changed after packaging');
    assert.deepEqual(await fs.readFile(path.join(destination, key)), bytes);
  }
  assert.equal(await fs.readFile(path.join(f.root, '.local/originals', id, 'source.jpeg'), 'utf8'), 'private source');
});

test('media collection rejects references outside a photo own public directory', async t => {
  for (const key of [`media/${otherId}/thumbnail.webp`, '../../.local/originals/source.jpeg', `media/${id}/source.jpeg`, `media/${id}/depth.png`, `media/${id}/thumbnail.webp?private=1`]) {
    await t.test(key, async sub => {
      const f = await fixture(sub);
      f.photo.files.thumbnail = key;
      await f.save();
      await assert.rejects(collectMediaAssets(f.root), /路径/);
    });
  }
});

test('media collection rejects invalid and duplicate photo IDs', async t => {
  for (const duplicate of [false, true]) {
    await t.test(duplicate ? 'duplicate UUID' : 'invalid UUID', async sub => {
      const f = await fixture(sub);
      if (duplicate) f.site.photos.push(structuredClone(f.photo));
      else f.photo.id = 'private-source';
      await f.save();
      await assert.rejects(collectMediaAssets(f.root), /照片编号/);
    });
  }
});

test('a missing referenced image stops packaging and preserves the previous snapshot', async t => {
  const f = await fixture(t), destination = path.join(f.root, '.local/snapshot');
  const before = await prepareMediaAssets(f.root, { destination });
  await fs.rm(path.join(f.root, 'public', f.photo.files.depth));
  await assert.rejects(prepareMediaAssets(f.root, { destination }), error => error.code === 'ENOENT');
  for (const asset of before.assets) assert.equal(sha256(await fs.readFile(path.join(destination, asset.key))), asset.sha256);
  assert.deepEqual((await fs.readdir(path.dirname(destination))).sort(), ['snapshot']);
});

test('media collection rejects invalid download byte metadata and download files over five megabytes', async t => {
  for (const invalid of [undefined, 0, -1, 1.5, '80', 80]) {
    await t.test(String(invalid), async sub => {
      const f = await fixture(sub);
      f.photo.downloadBytes = invalid;
      await f.save();
      await assert.rejects(collectMediaAssets(f.root), /下载图片大小/);
    });
  }
  const f = await fixture(t);
  await fs.truncate(path.join(f.root, 'public', f.photo.files.download), 5_000_001);
  f.photo.downloadBytes = 5_000_001;
  await f.save();
  await assert.rejects(collectMediaAssets(f.root), /下载图片大小/);
});

test('media collection rejects empty, non-file, and over-25-MiB objects before upload', async t => {
  for (const kind of ['empty', 'directory', 'oversized']) {
    await t.test(kind, async sub => {
      const f = await fixture(sub), file = path.join(f.root, 'public', f.photo.files.depth);
      if (kind === 'directory') {
        await fs.rm(file);
        await fs.mkdir(file);
      } else await fs.truncate(file, kind === 'empty' ? 0 : 25 * 1024 * 1024 + 1);
      await assert.rejects(collectMediaAssets(f.root), /图片大小/);
    });
  }
});

test('media collection rejects a public image symlink pointing at a private original', async t => {
  const f = await fixture(t), file = path.join(f.root, 'public', f.photo.files.depth);
  await f.write(`.local/originals/${id}/source.jpeg`, 'private original');
  await fs.rm(file);
  await fs.symlink(path.join(f.root, '.local/originals', id, 'source.jpeg'), file);
  await assert.rejects(collectMediaAssets(f.root), /软链|路径/);
  assert.equal(await fs.readFile(path.join(f.root, '.local/originals', id, 'source.jpeg'), 'utf8'), 'private original');
});

test('media collection rejects an image directory symlink even when every referenced file exists', async t => {
  const f = await fixture(t), directory = path.join(f.root, 'public/media', id);
  const privateDirectory = path.join(f.root, '.local/originals', id);
  await fs.mkdir(path.dirname(privateDirectory), { recursive: true });
  await fs.rename(directory, privateDirectory);
  await fs.symlink(privateDirectory, directory);
  await assert.rejects(collectMediaAssets(f.root), /软链|路径/);
  for (const [key, bytes] of f.contents) assert.deepEqual(await fs.readFile(path.join(privateDirectory, path.basename(key))), bytes);
});

test('media snapshot retains the live site removed photo and depth files, including public backup fallback, without uploading other orphans', async t => {
  const f = await fixture(t), previousPhoto = structuredClone(f.photo);
  const removedPhoto = { id: otherId, files: Object.fromEntries(Object.entries(names).map(([kind, name]) => [kind, `media/${otherId}/${name}`])) };
  const previousBytes = new Map(f.contents);
  for (const key of Object.values(removedPhoto.files)) {
    const bytes = Buffer.from('previously published: ' + key);
    previousBytes.set(key, bytes);
    await f.write('public/' + key, bytes);
  }
  removedPhoto.downloadBytes = previousBytes.get(removedPhoto.files.download).length;
  const previousSite = { schemaVersion: 1, photos: [previousPhoto, removedPhoto] };
  delete f.photo.files.depth;
  await f.save();
  const backup = path.resolve(f.root, '../nsfz-campus-media', removedPhoto.files.download);
  await fs.mkdir(path.dirname(backup), { recursive: true });
  await fs.writeFile(backup, previousBytes.get(removedPhoto.files.download));
  await fs.rm(path.join(f.root, 'public', removedPhoto.files.download));
  const orphanId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  await f.write(`public/media/${orphanId}/download.jpg`, 'never published');
  await f.write(`.local/originals/${otherId}/source.jpeg`, 'private source');
  const snapshot = await prepareMediaAssets(f.root, { previousSite });
  assert.equal(snapshot.photoCount, 1);
  assert.equal(snapshot.assets.length, 4, 'The manifest still describes the current library');
  assert.equal(snapshot.retainedCount, 6, 'Five removed photo files and one removed depth map remain during the site update');
  assert.deepEqual((await fs.readdir(path.join(snapshot.directory, 'media'))).sort(), [id, otherId]);
  for (const [key, bytes] of previousBytes) assert.deepEqual(await fs.readFile(path.join(snapshot.directory, key)), bytes);
  await assert.rejects(fs.access(path.join(snapshot.directory, '.local')));
  await assert.rejects(fs.access(path.join(snapshot.directory, 'media', orphanId)));
  assert.equal(await fs.readFile(path.join(f.root, '.local/originals', otherId, 'source.jpeg'), 'utf8'), 'private source');
});

test('previously published libraries cannot inject cross-photo or private paths into the retained snapshot', async t => {
  for (const key of [`media/${otherId}/depth.webp`, '../../.local/originals/source.jpeg', `media/${id}/source.jpeg`]) {
    await t.test(key, async sub => {
      const f = await fixture(sub);
      const previousSite = { schemaVersion: 1, photos: [{ id, files: { depth: key } }] };
      await assert.rejects(prepareMediaAssets(f.root, { previousSite }), /线上照片文件路径/);
      await assert.rejects(fs.access(path.join(f.root, '.local/deployment/media-assets')));
    });
  }
});

test('missing retained files in both public sources stop packaging and preserve the previous snapshot', async t => {
  const f = await fixture(t), destination = path.join(f.root, '.local/snapshot');
  const before = await prepareMediaAssets(f.root, { destination });
  const previousSite = { schemaVersion: 1, photos: [structuredClone(f.photo)] };
  const deletedDepth = f.photo.files.depth;
  delete f.photo.files.depth;
  await f.save();
  await fs.rm(path.join(f.root, 'public', deletedDepth));
  await assert.rejects(prepareMediaAssets(f.root, { destination, previousSite }), error => error.code === 'ENOENT');
  for (const asset of before.assets) assert.equal(sha256(await fs.readFile(path.join(destination, asset.key))), asset.sha256);
  assert.deepEqual((await fs.readdir(path.dirname(destination))).sort(), ['snapshot']);
});

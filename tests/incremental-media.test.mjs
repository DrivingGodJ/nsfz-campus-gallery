import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { prepareIncrementalMedia, uploadIncrementalMedia } from '../server/incremental-media.mjs';

const oldId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', newId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const photo = id => ({ id, downloadBytes: 5, files: { download: 'media/' + id + '/download.jpg' } });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'incremental-media-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const old = photo(oldId), added = photo(newId), previous = { photos: [old] }, current = { photos: [old, added] };
  await fs.writeFile(path.join(root, 'public/data/site.json'), JSON.stringify(current));
  await fs.mkdir(path.dirname(path.join(root, 'public', added.files.download)), { recursive: true });
  await fs.writeFile(path.join(root, 'public', added.files.download), 'photo');
  const saved = { version: 1, assets: { ['/' + old.files.download]: { hash: 'a'.repeat(32), size: 5 } } };
  await fs.writeFile(path.join(root, '.local/media-hosting.json'), JSON.stringify(saved));
  return { root, old, added, previous };
}
test('incremental hosting retains existing assets without reading their missing NAS/local images', async t => {
  const { root, old, added, previous } = await fixture(t);
  const prepared = await prepareIncrementalMedia(root, previous, [added.files.download], { fetcher: () => assert.fail('cached files need no network request') });
  assert.equal(Object.keys(prepared.manifest).length, 2);
  assert.equal(prepared.manifest['/' + old.files.download].hash, 'a'.repeat(32));
  const hash = prepared.manifest['/' + added.files.download].hash;
  let uploaded = 0, deployed = false;
  const fetcher = async (url, options) => {
    if (url.endsWith('/assets-upload-session')) {
      assert.deepEqual(JSON.parse(options.body).manifest, prepared.manifest);
      return Response.json({ success: true, result: { jwt: 'session', buckets: [[hash]] } });
    }
    if (url.endsWith('/assets/upload?base64=true')) {
      assert.equal(options.headers.Authorization, 'Bearer session');
      const file = options.body.get(hash);
      assert.equal(await file.text(), Buffer.from('photo').toString('base64')); assert.equal(file.type, 'image/jpeg'); uploaded++;
      return Response.json({ success: true, result: { jwt: 'complete' } });
    }
    assert.equal(options.method, 'PUT');
    const metadata = JSON.parse(options.body.get('metadata'));
    assert.equal(metadata.assets.jwt, 'complete'); assert.match(metadata.assets.config._headers, /Access-Control-Allow-Origin: \*/); deployed = true;
    return Response.json({ success: true, result: {} });
  };
  assert.deepEqual(await uploadIncrementalMedia(root, prepared.manifest, { accountId: 'account', scriptName: 'media', credentials: { token: 'test' }, checksums: prepared.checksums, fetcher }), { uploaded: 1 });
  assert.equal(uploaded, 1); assert.equal(deployed, true);
});
test('first-run hosting learns remote hashes using HEAD, then reuses its small persistent index', async t => {
  const { root, old, added, previous } = await fixture(t);
  await fs.rm(path.join(root, '.local/media-hosting.json'));
  let count = 0;
  const fetcher = async (_url, options) => { assert.equal(options.method, 'HEAD'); count++; return new Response(null, { headers: { etag: '"' + 'b'.repeat(32) + '"', 'content-type': 'image/jpeg', 'content-length': '5' } }); };
  await prepareIncrementalMedia(root, previous, [added.files.download], { fetcher });
  assert.equal(count, 1);
  await fs.rm(path.join(root, 'public', added.files.download));
  const prepared = await prepareIncrementalMedia(root, { photos: [old, added] }, [], { fetcher: () => assert.fail('no re-scan after restart') });
  assert.equal(Object.keys(prepared.manifest).length, 2);
});
test('same-size source changes and private symlinks stop hosting before any deployment', async t => {
  const { root, added, previous } = await fixture(t);
  const prepared = await prepareIncrementalMedia(root, previous, [added.files.download]);
  const hash = prepared.manifest['/' + added.files.download].hash;
  await fs.writeFile(path.join(root, 'public', added.files.download), 'other');
  await assert.rejects(uploadIncrementalMedia(root, prepared.manifest, { accountId: 'account', scriptName: 'media', credentials: { token: 'test' }, checksums: prepared.checksums,
    fetcher: async url => { assert.ok(url.endsWith('/assets-upload-session')); return Response.json({ success: true, result: { jwt: 'session', buckets: [[hash]] } }); }
  }), /发生变化/);
  await fs.rm(path.join(root, 'public', added.files.download));
  await fs.writeFile(path.join(root, '.local/private.jpg'), 'photo');
  await fs.symlink(path.join(root, '.local/private.jpg'), path.join(root, 'public', added.files.download));
  await assert.rejects(prepareIncrementalMedia(root, previous, [added.files.download]), /路径/);
});

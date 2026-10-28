import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { contentPath, changedPaths, photoChanges, createPublicationService, runCommand, cleanPublicationBuilds, publicationError, LIKES_API } from '../server/local-publication.mjs';

test('publication includes only the public content library and approved renditions', () => {
  assert.ok(contentPath('public/data/site.json'));
  assert.ok(contentPath('public/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/thumbnail.webp'));
  assert.ok(contentPath('public/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/depth.webp'));
  assert.equal(contentPath('public/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/depth.png'), false);
  for (const file of ['.local/originals/source.jpg', '.env.production.local', 'src/editor.tsx', 'public/media/../credentials', 'public/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/source.jpg']) assert.equal(contentPath(file), false);
  assert.deepEqual(changedPaths(' M public/data/site.json\0R  src/new.ts\0src/old.ts\0'), ['public/data/site.json', 'src/new.ts', 'src/old.ts']);
  assert.deepEqual(photoChanges({ photos: [{ id: 'a', title: 'old' }, { id: 'removed' }], buildingOverrides: {} }, { photos: [{ id: 'a', title: 'new' }, { id: 'new' }], buildingOverrides: {} }), { added: 1, updated: 1, removed: 1, buildingChanged: false });
});

test('NAS availability is checked before publication and failed sync preserves the published result and local photos', async t => {
  const unavailable = await fixture(t, { beforePublish: async () => { throw new Error('NAS 未连接'); } });
  await unavailable.service.start();
  const blocked = await finished(unavailable.service);
  assert.equal(blocked.status, 'failed'); assert.match(blocked.message, /NAS 未连接/);
  assert.ok(!unavailable.commands.some(row => row[0] === 'git' && row[1] === 'push'));
  let call;
  const published = await fixture(t, { afterPublish: async value => { call = value; throw new Error('NAS 同步中断'); } });
  await published.service.start();
  const partial = await finished(published.service);
  assert.deepEqual(call, { commit: 'a'.repeat(40) });
  assert.equal(partial.websiteVerified, true); assert.equal(partial.status, 'failed');
  assert.match(partial.message, /网站已上线，但 NAS 同步尚未完成/);
  assert.equal(JSON.parse(await fs.readFile(path.join(published.root, 'public/data/site.json'))).photos.length, 1);
  assert.ok(published.commands.flat().includes('likes:deploy:only'));
});

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-publication-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const previous = options.previous || { photos: [], buildingOverrides: {} }, current = options.current || { photos: [{ id: 'approved', title: '校园照片' }], buildingOverrides: {} };
  const bytes = Buffer.from(JSON.stringify(current) + '\n');
  await fs.writeFile(path.join(root, 'public/data/site.json'), bytes);
  await fs.writeFile(path.join(root, '.local/drafts.json'), JSON.stringify([{ id: 'private-draft' }]));
  const mediaRoot = path.join(root, '.local/media-repo');
  if (options.media) {
    await fs.mkdir(path.join(mediaRoot, '.git'), { recursive: true });
    for (const photo of current.photos) for (const file of Object.values(photo.files ?? {})) {
      const local = path.join(root, 'public', file);
      await fs.mkdir(path.dirname(local), { recursive: true });
      await fs.writeFile(local, file);
      if (options.mediaStored) {
        await fs.mkdir(path.dirname(path.join(mediaRoot, file)), { recursive: true });
        await fs.copyFile(local, path.join(mediaRoot, file));
      }
    }
  }
  const commands = [], commandOptions = [], requests = [];
  const run = async (tool, args, settings) => {
    commands.push([tool, ...args]);
    commandOptions.push(settings);
    if (options.onCommand) await options.onCommand(tool, args, root, settings);
    if (tool === 'git') {
      if (settings.cwd === mediaRoot) {
        if (args[0] === 'status') return options.mediaDirty || '';
        if (args[0] === 'branch') return 'main\n';
        if (args[0] === 'remote') return 'https://github.com/DrivingGodJ/nsfz-campus-media.git\n';
        if (args[0] === 'rev-list') return (options.mediaAhead || 0) + '\t0\n';
        if (args[0] === 'rev-parse') return args[1] === '--git-path' ? '.git/' + args[2] : (options.mediaHead?.() || 'b'.repeat(40)) + '\n';
        return '';
      }
      if (args[0] === 'status') return options.dirty ?? ' M public/data/site.json\0';
      if (args[0] === 'branch') return options.branch ?? 'main\n';
      if (args[0] === 'remote') return 'https://github.com/DrivingGodJ/nsfz-campus-gallery.git\n';
      if (args[0] === 'show') return options.runShow ? options.runShow(settings) : JSON.stringify(previous);
      if (args[0] === 'rev-list') return '0\t0\n';
      if (args[0] === 'rev-parse') return 'a'.repeat(40) + '\n';
    }
    if (tool === 'gh' && args[0] === 'api') {
      if (args[1].endsWith('/actions/variables/MEDIA_BASE_URL')) return JSON.stringify({ value: options.mediaBaseURL || 'https://photos.drivinggodj.dpdns.org/' });
      return JSON.stringify({ workflow_runs: [{ head_sha: 'a'.repeat(40), created_at: new Date().toISOString(), status: 'completed', conclusion: options.conclusion || 'success', html_url: 'https://github.com/DrivingGodJ/nsfz-campus-gallery/actions/runs/1' }] });
    }
    return '';
  };
  const fetcher = async (url, settings) => {
    requests.push([url, settings?.method || 'GET']);
    if (options.onRequest) await options.onRequest(url, settings);
    if (settings?.method === 'HEAD') {
      const key = new URL(url).pathname.replace(/^\//, '');
      const status = typeof options.assetStatus === 'function' ? options.assetStatus(url) : options.assetStatus || 200;
      const headers = {
        'access-control-allow-origin': '*', 'content-type': key.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
        'content-length': String(Buffer.byteLength(key)), etag: '"' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 32) + '"',
        ...(typeof options.assetHeaders === 'function' ? options.assetHeaders(url) : options.assetHeaders)
      };
      for (const [name, value] of Object.entries(headers)) if (value === null) delete headers[name];
      return new Response(null, { status, headers });
    }
    if (url.startsWith(LIKES_API)) {
      const { photoIds } = JSON.parse(settings.body);
      return Response.json({ likes: Object.fromEntries(photoIds.map(id => [id, { count: 0, liked: false, ...(options.unsynced ? { available: false } : {}) }])) }, { status: options.likesStatus || 200 });
    }
    const published = options.remoteLibrary || current;
    return new Response(JSON.stringify(published), { status: options.responseStatus || 200 });
  };
  const service = createPublicationService(root, { run, fetcher, wait: () => new Promise(resolve => setImmediate(resolve)), maxPolls: 3, mediaRoot, beforePublish: options.beforePublish, afterPublish: options.afterPublish, incremental: options.incremental });
  return { root, mediaRoot, service, commands, commandOptions, requests };
}
async function finished(service) {
  for (let i = 0; i < 200; i++) {
    const state = await service.snapshot();
    if (!state.running && state.status !== 'idle') return state;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail('publication did not finish');
}

test('reviewed photos publish through checks, exact GitHub run, live verification and likes; drafts stay local', async t => {
  const { service, commands, requests } = await fixture(t);
  const { plan } = await service.status();
  assert.equal(plan.added, 1); assert.equal(plan.drafts, 1);
  await service.start();
  const result = await finished(service);
  assert.equal(result.status, 'completed');
  assert.deepEqual(commands.find(row => row[0] === 'git' && row[1] === 'add'), ['git', 'add', '--', 'public/data/site.json']);
  const scripts = commands.filter(row => row[2] === 'run').map(row => row[3]);
  assert.deepEqual(scripts, ['test', 'likes:check', 'build', 'likes:deploy:only']);
  assert.ok(commands.some(row => row[0] === 'git' && row[1] === 'push'));
  assert.ok(commands.some(row => row[0] === 'gh' && row[2]?.includes('head_sha=' + 'a'.repeat(40))));
  assert.equal(requests[0][0].split('?')[0], 'https://drivinggodj.github.io/nsfz-campus-gallery/data/site.json');
  assert.ok(requests.some(([url, method]) => url === LIKES_API + '/read' && method === 'POST'));
  assert.ok(!commands.flat().some(value => String(value).includes('private-draft')));
});

test('paired depth maps publish with the photo library and are checked online', async t => {
  const depth = 'public/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/depth.webp';
  const { service, root, commands, requests } = await fixture(t, { dirty: ' M public/data/site.json\0?? ' + depth + '\0' });
  await fs.mkdir(path.dirname(path.join(root, depth)), { recursive: true });
  await fs.writeFile(path.join(root, depth), 'paired-depth');
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  assert.deepEqual(commands.find(row => row[0] === 'git' && row[1] === 'add'), ['git', 'add', '--', 'public/data/site.json', depth]);
  assert.ok(requests.some(([url, method]) => method === 'HEAD' && url.includes('/media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/depth.webp')));
});

const separateMediaPhoto = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', title: '校园照片', downloadBytes: 80,
  files: { thumbnail: 'media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/thumbnail.webp', depth: 'media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/depth.webp', download: 'media/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/download.jpg' }
};
const separateMediaLibrary = { photos: [separateMediaPhoto], buildingOverrides: {} };

test('a NAS-backed publish can plan uncached photos and retrieves them under its publish lock before strict validation', async t => {
  let context;
  let retrieved = false;
  context = await fixture(t, { media: true, mediaStored: true, current: separateMediaLibrary, beforePublish: async () => {
    assert.equal(await context.service.publishing(), true);
    for (const key of Object.values(separateMediaPhoto.files)) await fs.copyFile(path.join(context.mediaRoot, key), path.join(context.root, 'public', key));
    retrieved = true;
  } });
  for (const key of Object.values(separateMediaPhoto.files)) await fs.unlink(path.join(context.root, 'public', key));
  const status = await context.service.status();
  assert.equal(status.problem, '');
  assert.equal(status.plan.media.missingAssets.length, 3);
  assert.equal(retrieved, false, 'showing a plan never downloads photos');
  await context.service.start();
  assert.equal((await finished(context.service)).status, 'completed');
  assert.equal(retrieved, true);
});

test('separate media publication copies referenced assets and pushes them before the Pages site', async t => {
  const orphan = 'media/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb/download.jpg';
  const { root, mediaRoot, service, commands, commandOptions, requests } = await fixture(t, { media: true, current: separateMediaLibrary, mediaDirty: '?? ' + orphan + '\0' });
  await fs.writeFile(path.join(root, '.local/original.jpg'), 'private-original');
  await fs.mkdir(path.dirname(path.join(mediaRoot, orphan)), { recursive: true });
  await fs.writeFile(path.join(mediaRoot, orphan), 'orphan-photo');
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  const mediaPush = commands.findIndex((row, index) => row[0] === 'git' && row[1] === 'push' && commandOptions[index].cwd === mediaRoot);
  const mainPush = commands.findIndex((row, index) => row[0] === 'git' && row[1] === 'push' && commandOptions[index].cwd === root);
  assert.ok(mediaPush >= 0 && mainPush > mediaPush);
  const mediaAdd = commands.find((row, index) => row[0] === 'git' && row[1] === 'add' && commandOptions[index].cwd === mediaRoot);
  assert.deepEqual(mediaAdd.slice(3), Object.values(separateMediaPhoto.files).sort());
  const mainAdd = commands.find((row, index) => row[0] === 'git' && row[1] === 'add' && commandOptions[index].cwd === root);
  assert.deepEqual(mainAdd, ['git', 'add', '--', 'public/data/site.json']);
  const buildIndex = commands.findIndex(row => row[2] === 'run' && row[3] === 'build');
  assert.equal(commandOptions[buildIndex].env.VITE_MEDIA_BASE_URL, 'https://photos.drivinggodj.dpdns.org/');
  assert.equal(requests.filter(([, method]) => method === 'HEAD').length, 6);
  assert.ok(requests.filter(([, method]) => method === 'HEAD').every(([url]) => url.startsWith('https://photos.drivinggodj.dpdns.org/media/')));
  const mediaDeploy = commands.findIndex(row => row[2] === 'run' && row[3] === 'media:deploy');
  assert.ok(mediaDeploy > mediaPush && mainPush > mediaDeploy);
  assert.deepEqual((await service.status()).plan.media.assets, Object.values(separateMediaPhoto.files).sort());
  for (const file of Object.values(separateMediaPhoto.files)) assert.equal(await fs.readFile(path.join(mediaRoot, file), 'utf8'), file);
  assert.equal(await fs.readFile(path.join(mediaRoot, orphan), 'utf8'), 'orphan-photo');
  assert.equal(await fs.readFile(path.join(root, '.local/original.jpg'), 'utf8'), 'private-original');
});

test('ignored media edits during checks stop publication before either repository is changed', async t => {
  const { service, commands } = await fixture(t, { media: true, current: separateMediaLibrary, onCommand: async (_tool, args, root) => {
    if (args[1] === 'run' && args[2] === 'test') await fs.writeFile(path.join(root, 'public', separateMediaPhoto.files.depth), 'new-depth');
  } });
  await service.start();
  assert.match((await finished(service)).message, /内容库发生变化/);
  assert.ok(!commands.some(row => row[0] === 'git' && ['add', 'commit', 'push'].includes(row[1])));
});

test('failed media pushes stop the main publication and matching committed media can be retried', async t => {
  const failed = await fixture(t, { media: true, current: separateMediaLibrary, onCommand: async (tool, args, _root, settings) => {
    if (tool === 'git' && args[0] === 'push' && settings.cwd.endsWith('/media-repo')) throw new Error('media push failed');
  } });
  await failed.service.start();
  assert.equal((await finished(failed.service)).status, 'failed');
  assert.ok(!failed.commands.some((row, index) => row[0] === 'git' && row[1] === 'push' && failed.commandOptions[index].cwd === failed.root));
  const retry = await fixture(t, { media: true, mediaStored: true, mediaAhead: 1, current: separateMediaLibrary });
  await retry.service.start();
  assert.equal((await finished(retry.service)).status, 'completed');
  assert.ok(retry.commands.some((row, index) => row[0] === 'git' && row[1] === 'push' && retry.commandOptions[index].cwd === retry.mediaRoot));
  assert.ok(!retry.commands.some((row, index) => row[0] === 'git' && row[1] === 'commit' && retry.commandOptions[index].cwd === retry.mediaRoot));
  assert.equal(retry.requests.filter(([, method]) => method === 'HEAD').length, 6);
});

test('SMB NUL padding in the generated commit message is repaired once without changing the message', async t => {
  let commits = 0;
  const { service, mediaRoot } = await fixture(t, { media: true, current: separateMediaLibrary,
    onCommand: async (tool, args, _root, settings) => {
      if (tool !== 'git' || args[0] !== 'commit' || !settings.cwd.endsWith('/media-repo')) return;
      const file = path.join(settings.cwd, '.git/COMMIT_EDITMSG');
      commits++;
      if (commits === 1) {
        await fs.writeFile(file, args[2] + '\n' + '\0'.repeat(30));
        throw new Error('error: a NUL byte in commit log message not allowed.');
      }
      assert.equal(await fs.readFile(file, 'utf8'), args[2] + '\n');
    }
  });
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  assert.equal(commits, 2);
  assert.equal((await fs.readdir(path.join(mediaRoot, '.git'))).filter(name => name.endsWith('.tmp')).length, 0);
});

test('a changed commit message is preserved and never retried as an SMB padding repair', async t => {
  let commits = 0;
  const { service, mediaRoot } = await fixture(t, { media: true, current: separateMediaLibrary,
    onCommand: async (tool, args, _root, settings) => {
      if (tool !== 'git' || args[0] !== 'commit' || !settings.cwd.endsWith('/media-repo')) return;
      commits++; await fs.writeFile(path.join(settings.cwd, '.git/COMMIT_EDITMSG'), 'another author message\n\0');
      throw new Error('error: a NUL byte in commit log message not allowed.');
    }
  });
  await service.start(); assert.equal((await finished(service)).status, 'failed');
  assert.equal(commits, 1);
  assert.equal(await fs.readFile(path.join(mediaRoot, '.git/COMMIT_EDITMSG'), 'utf8'), 'another author message\n\0');
});

test('conflicting media checkout edits are preserved while matching dirty copies can publish', async t => {
  const depth = separateMediaPhoto.files.depth;
  const conflict = await fixture(t, { media: true, mediaStored: true, current: separateMediaLibrary, mediaDirty: ' M ' + depth + '\0' });
  await fs.writeFile(path.join(conflict.mediaRoot, depth), 'edited-in-media-checkout');
  await assert.rejects(conflict.service.start(), /未同步的修改，未覆盖/);
  assert.equal(await fs.readFile(path.join(conflict.mediaRoot, depth), 'utf8'), 'edited-in-media-checkout');
  assert.equal(await fs.readFile(path.join(conflict.root, 'public', depth), 'utf8'), depth);
  assert.ok(!conflict.commands.some(row => row[0] === 'git' && ['add', 'commit', 'push'].includes(row[1])));
  const matching = await fixture(t, { media: true, mediaStored: true, current: separateMediaLibrary, mediaDirty: ' M ' + depth + '\0' });
  await matching.service.start();
  assert.equal((await finished(matching.service)).status, 'completed');
  const add = matching.commands.find((row, index) => row[0] === 'git' && row[1] === 'add' && matching.commandOptions[index].cwd === matching.mediaRoot);
  assert.deepEqual(add, ['git', 'add', '--', depth]);
});

test('a split project cannot publish without its sibling media checkout', async t => {
  const { root, service, commands } = await fixture(t);
  await fs.writeFile(path.join(root, '.gitignore'), '.local/\npublic/media/\n');
  await assert.rejects(service.start(), /图片库未就绪/);
  assert.ok(!commands.some(row => row[0] === 'git' && ['add', 'commit', 'push'].includes(row[1])));
});

test('external media requires every local asset and rejects downloads over five megabytes', async t => {
  const missing = await fixture(t, { media: true, current: separateMediaLibrary });
  await fs.rm(path.join(missing.root, 'public', separateMediaPhoto.files.depth));
  await assert.rejects(missing.service.start(), /缺少已审核的照片文件/);
  const oversized = await fixture(t, { media: true, current: separateMediaLibrary });
  await fs.writeFile(path.join(oversized.root, 'public', separateMediaPhoto.files.download), Buffer.alloc(5_000_001));
  await assert.rejects(oversized.service.start(), /下载图片超过 5 MB/);
  assert.ok(!oversized.commands.some(row => row[0] === 'git' && ['add', 'commit', 'push'].includes(row[1])));
});

test('missing hosted images stop the site publication even when the media backup has succeeded', async t => {
  const { service, commands, requests } = await fixture(t, { media: true, mediaStored: true, mediaAhead: 1, current: separateMediaLibrary, assetStatus: 404 });
  await service.start();
  const result = await finished(service);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /照片文件尚未加载成功/);
  assert.ok(requests.some(([url, method]) => method === 'HEAD' && url.startsWith('https://photos.drivinggodj.dpdns.org/')));
  assert.ok(!commands.some(row => row[0] === 'gh' && row[1] === 'workflow'));
  assert.ok(!commands.flat().includes('likes:deploy:only'));
});

test('failed photo hosting retains the GitHub backup and stops the main commit and push', async t => {
  const { service, root, mediaRoot, commands, commandOptions } = await fixture(t, { media: true, current: separateMediaLibrary,
    onCommand: async (_tool, args) => { if (args[1] === 'run' && args[2] === 'media:deploy') throw new Error('hosting unavailable'); }
  });
  await service.start();
  const result = await finished(service);
  assert.equal(result.status, 'failed');
  assert.match(result.message, /照片托管上传失败.*尚未提交/);
  assert.ok(commands.some((row, index) => row[0] === 'git' && row[1] === 'push' && commandOptions[index].cwd === mediaRoot));
  assert.ok(!commands.some((row, index) => row[0] === 'git' && ['add', 'commit', 'push'].includes(row[1]) && commandOptions[index].cwd === root));
  for (const file of Object.values(separateMediaPhoto.files)) assert.equal(await fs.readFile(path.join(mediaRoot, file), 'utf8'), file);
});

test('hosting is verified from the Pages origin before the site push, including CORS, image type and byte length', async t => {
  for (const assetHeaders of [
    { 'access-control-allow-origin': 'https://example.com' },
    { 'content-type': 'text/html' },
    { 'content-length': '1' }
  ]) {
    const { service, root, commands, commandOptions, requests } = await fixture(t, { media: true, mediaStored: true, current: separateMediaLibrary, assetHeaders });
    await service.start();
    assert.match((await finished(service)).message, /跨域、图片类型或文件大小/);
    assert.ok(!commands.some((row, index) => row[0] === 'git' && ['add', 'commit', 'push'].includes(row[1]) && commandOptions[index].cwd === root));
    assert.ok(requests.some(([, method]) => method === 'HEAD'));
  }
  const valid = await fixture(t, { media: true, mediaStored: true, current: separateMediaLibrary, assetHeaders: { 'access-control-allow-origin': 'https://drivinggodj.github.io' },
    onRequest: async (_url, settings) => { if (settings?.method === 'HEAD') assert.equal(settings.headers.Origin, 'https://drivinggodj.github.io'); }
  });
  await valid.service.start();
  assert.equal((await finished(valid.service)).status, 'completed');
});

test('native asset HEAD responses without Content-Length require an ETag', async t => {
  const valid = await fixture(t, { media: true, mediaStored: true, current: separateMediaLibrary,
    assetHeaders: { 'content-length': null, etag: '"native-asset-hash"' }
  });
  await valid.service.start();
  assert.equal((await finished(valid.service)).status, 'completed');
  for (const etag of [null, '   ']) {
    const invalid = await fixture(t, { media: true, mediaStored: true, current: separateMediaLibrary,
      assetHeaders: { 'content-length': null, etag }
    });
    await invalid.service.start();
    assert.match((await finished(invalid.service)).message, /跨域、图片类型或文件大小/);
    assert.ok(!invalid.commands.some((row, index) => row[0] === 'git' && ['add', 'commit', 'push'].includes(row[1]) && invalid.commandOptions[index].cwd === invalid.root));
  }
});

test('changes made during photo hosting upload stop main publication without discarding the edit', async t => {
  for (const editPhoto of [false, true]) {
    const { service, root, commands, commandOptions } = await fixture(t, { media: true, current: separateMediaLibrary,
      onCommand: async (_tool, args, root) => {
        if (args[1] !== 'run' || args[2] !== 'media:deploy') return;
        if (editPhoto) await fs.writeFile(path.join(root, 'public', separateMediaPhoto.files.depth), 'changed-during-upload');
        else await fs.writeFile(path.join(root, 'public/data/site.json'), JSON.stringify({ ...separateMediaLibrary, photos: [{ ...separateMediaPhoto, title: 'changed-during-upload' }] }));
      }
    });
    await service.start();
    assert.match((await finished(service)).message, /上传过程中内容库发生变化/);
    assert.ok(!commands.some((row, index) => row[0] === 'git' && ['add', 'commit', 'push'].includes(row[1]) && commandOptions[index].cwd === root));
    const edited = editPhoto ? path.join(root, 'public', separateMediaPhoto.files.depth) : path.join(root, 'public/data/site.json');
    assert.match(await fs.readFile(edited, 'utf8'), /changed-during-upload/);
  }
});

test('the upload guard accepts the backup commit while protecting the original local source', async t => {
  let mediaHead = 'b'.repeat(40);
  const { service } = await fixture(t, { media: true, current: separateMediaLibrary, mediaHead: () => mediaHead,
    onCommand: async (tool, args, _root, settings) => {
      if (tool === 'git' && args[0] === 'commit' && settings.cwd.endsWith('/media-repo')) mediaHead = 'c'.repeat(40);
    }
  });
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  assert.equal(mediaHead, 'c'.repeat(40));
});

test('a stale GitHub media base setting stops hosting and publication before any write', async t => {
  const { service, commands } = await fixture(t, { media: true, current: separateMediaLibrary, mediaBaseURL: 'https://raw.githubusercontent.com/DrivingGodJ/nsfz-campus-media/main/' });
  await service.start();
  assert.match((await finished(service)).message, /图片库地址尚未配置正确/);
  assert.ok(!commands.flat().includes('media:deploy'));
  assert.ok(!commands.some(row => row[0] === 'git' && ['add', 'commit', 'push'].includes(row[1])));
});

test('all matching referenced assets are verified with at most six simultaneous requests', async t => {
  const photos = Array.from({ length: 4 }, (_, index) => {
    const id = '0000000' + index + '-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    return { ...separateMediaPhoto, id, files: Object.fromEntries(Object.entries(separateMediaPhoto.files).map(([key, file]) => [key, file.replace(separateMediaPhoto.id, id)])) };
  });
  let active = 0, maximum = 0;
  const { service, requests } = await fixture(t, { media: true, mediaStored: true, current: { ...separateMediaLibrary, photos }, onRequest: async (_url, settings) => {
    if (settings?.method !== 'HEAD') return;
    active++; maximum = Math.max(maximum, active);
    await new Promise(resolve => setTimeout(resolve, 3));
    active--;
  } });
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  assert.equal(requests.filter(([, method]) => method === 'HEAD').length, 24);
  assert.ok(maximum > 1 && maximum <= 6);
});

test('unrelated program changes and wrong branches cannot be committed by the review app', async t => {
  for (const options of [{ dirty: ' M src/editor.tsx\0' }, { branch: 'feature/unrelated' }]) {
    const { service, commands } = await fixture(t, options);
    await assert.rejects(service.start());
    assert.ok(!commands.some(row => ['add', 'commit', 'push'].includes(row[1])));
  }
});

test('incremental publication opens without media scans and publishes additions without reading old images', async t => {
  const newId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const added = { ...separateMediaPhoto, id: newId, files: Object.fromEntries(Object.entries(separateMediaPhoto.files).map(([kind, key]) => [kind, key.replace(separateMediaPhoto.id, newId)])) };
  const { root, service, commands, commandOptions, requests, mediaRoot } = await fixture(t, { incremental: true, media: true, mediaStored: true,
    previous: separateMediaLibrary, current: { ...separateMediaLibrary, photos: [separateMediaPhoto, added] } });
  for (const key of Object.values(separateMediaPhoto.files)) {
    await fs.rm(path.join(root, 'public', key));
    await fs.rm(path.join(mediaRoot, key));
  }
  const state = await service.status();
  assert.equal(state.plan.added, 1);
  assert.equal(state.problem, '');
  assert.ok(!commandOptions.some(options => options.cwd === mediaRoot));
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  assert.ok(!commands.some(row => row[2] === 'run' && row[3] === 'test'));
  assert.ok(requests.filter(([, method]) => method === 'HEAD').every(([url]) => url.includes(newId)));
});

test('new photo URLs can become available after the hosting deployment response', async t => {
  const seen = new Map();
  const { service } = await fixture(t, { incremental: true, media: true, mediaStored: true, current: separateMediaLibrary,
    assetStatus: url => { const key = new URL(url).pathname, count = (seen.get(key) || 0) + 1; seen.set(key, count); return count === 1 ? 404 : 200; } });
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  assert.ok([...seen.values()].every(count => count >= 3));
});

test('same-path photo updates wait for the new content hash rather than accepting a stale edge response', async t => {
  const seen = new Set();
  const { service } = await fixture(t, { incremental: true, media: true, mediaStored: true, current: separateMediaLibrary,
    assetHeaders: url => { const key = new URL(url).pathname; if (!seen.has(key)) { seen.add(key); return { etag: '"' + '0'.repeat(32) + '"' }; } return {}; } });
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  assert.equal(seen.size, Object.keys(separateMediaPhoto.files).length);
});

test('same-path content edits made during checking prevent the publish, without losing changes', async t => {
  const { service, commands, root } = await fixture(t, { onCommand: async (tool, args, root) => {
    if (args[1] === 'run' && args[2] === 'test') await fs.writeFile(path.join(root, 'public/data/site.json'), JSON.stringify({ photos: [{ id: 'new-edit' }], buildingOverrides: {} }));
  } });
  await service.start();
  assert.match((await finished(service)).message, /内容库发生变化/);
  assert.ok(!commands.some(row => row[0] === 'git' && row[1] === 'add'));
  assert.match(await fs.readFile(path.join(root, 'public/data/site.json'), 'utf8'), /new-edit/);
});

test('failed GitHub deployment retains the committed content and does not report success or sync likes', async t => {
  const { service, commands } = await fixture(t, { conclusion: 'failure' });
  await service.start(); const result = await finished(service);
  assert.equal(result.status, 'failed'); assert.match(result.message, /发布未成功/);
  assert.equal(result.commit, 'a'.repeat(40));
  assert.ok(!commands.flat().includes('likes:deploy:only'));
});

test('a transient GitHub status EOF is retried without pushing or uploading photos again', async t => {
  let polls = 0;
  const { service, commands } = await fixture(t, { onCommand: async (tool, args) => {
    if (tool === 'gh' && args[0] === 'api' && args[1].includes('/workflows/pages.yml/runs') && ++polls === 1) throw new Error('Get "https://api.github.com/": EOF');
  } });
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  assert.equal(polls, 2);
  assert.equal(commands.filter(row => row[0] === 'git' && row[1] === 'push').length, 1);
});

test('publishing requires a matching live library even after a successful GitHub run', async t => {
  const { service } = await fixture(t, { responseStatus: 503 });
  await service.start();
  const result = await finished(service);
  assert.equal(result.status, 'failed'); assert.match(result.message, /还没确认/);
});

test('publication accepts reordered JSON fields but still rejects changed photo content', async t => {
  const reordered = { buildingOverrides: {}, photos: [{ title: '校园照片', id: 'approved' }] };
  const { service } = await fixture(t, { remoteLibrary: reordered });
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  const changed = await fixture(t, { remoteLibrary: { ...reordered, photos: [{ title: '不是审核后的照片', id: 'approved' }] } });
  await changed.service.start();
  assert.equal((await finished(changed.service)).status, 'failed');
  assert.ok(!changed.commands.flat().includes('likes:deploy:only'));
});

test('the unchanged version can be redeployed without manufacturing a new content commit', async t => {
  const { service, commands } = await fixture(t, { dirty: '' });
  await service.start(); assert.equal((await finished(service)).status, 'completed');
  assert.ok(commands.some(row => row[0] === 'gh' && row[1] === 'workflow' && row[2] === 'run'));
  assert.ok(!commands.some(row => row[0] === 'git' && row[1] === 'commit'));
});

test('another local process sees the publish lock and cannot start a competing task', async t => {
  let resume;
  const gate = new Promise(resolve => { resume = resolve; });
  const options = { onCommand: async (tool, args) => { if (tool === 'gh' && args[0] === 'auth') await gate; } };
  const { service, root } = await fixture(t, options);
  await service.start(); assert.equal(await service.publishing(), true);
  await assert.rejects(service.start(), /正在执行/);
  resume(); assert.equal((await finished(service)).status, 'completed');
  assert.equal(await service.publishing(), false);
  await assert.rejects(fs.access(path.join(root, '.local/publication/lock.json')));
});

test('subprocesses use literal arguments and redact credentials from errors and progress', async () => {
  const output = await runCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1]+" gho_dummy123 Bearer secret123")', '$(do-not-execute)']);
  assert.match(output, /\$\(do-not-execute\)/); assert.ok(!output.includes('gho_dummy123')); assert.ok(!output.includes('secret123'));
});

test('hosting login errors explain the recovery without exposing the process stack', () => {
  const message = publicationError('node scripts/media-deploy.mjs\nError: 图片托管尚未登录，请先运行 Wrangler 登录\n at credentials (file:///private/workspace/script.mjs:17)');
  assert.match(message, /完成 Cloudflare 登录授权/);
  assert.match(message, /照片已保存在 NAS/);
  assert.ok(!message.includes('file:///') && !message.includes(' at credentials'));
});

test('publication tests isolate desktop paths while build commands retain their configuration', async t => {
  const inherited = {
    CAMPUS_PROJECT_TEMPLATE: '/unused/bundled-project',
    CAMPUS_CONTENT_ROOT: '/unused/review-library',
    CAMPUS_MEDIA_ROOT: '/unused/nas-media',
    CAMPUS_NAS_CONFIG: '/unused/nas.json',
    CAMPUS_DEPTH_COMPONENTS: '/unused/depth-components',
    CAMPUS_NPM_CLI: '/unused/npm-cli.js',
    CAMPUS_DESKTOP_APP: '1',
    MINIFLARE_CACHE_DIR: '/unused/worker-cache'
  };
  const previous = Object.fromEntries(Object.keys(inherited).map(key => [key, process.env[key]]));
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  Object.assign(process.env, inherited);
  const { root, service, commands, commandOptions } = await fixture(t);
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
  const tests = commands.findIndex(row => row[2] === 'run' && row[3] === 'test');
  const build = commands.findIndex(row => row[2] === 'run' && row[3] === 'build');
  assert.ok(tests >= 0 && build >= 0);
  assert.equal(commandOptions[tests].env.CAMPUS_DESKTOP_APP, '1');
  assert.equal(commandOptions[tests].env.MINIFLARE_CACHE_DIR, path.join(root, '.local/miniflare-cache'));
  for (const [key, value] of Object.entries(inherited)) {
    if (key.startsWith('CAMPUS_') && key !== 'CAMPUS_DESKTOP_APP') assert.equal(commandOptions[tests].env[key], undefined, key);
    assert.equal(commandOptions[build].env[key], value, key);
  }
});

test('subprocess logs stay bounded while structured output can be captured in full', async () => {
  const args = ['-e', 'process.stdout.write(JSON.stringify({ value: "x".repeat(300000) }))'];
  const bounded = await runCommand(process.execPath, args);
  assert.equal(bounded.length, 250000);
  assert.throws(() => JSON.parse(bounded));
  const complete = await runCommand(process.execPath, args, { maxOutputChars: Infinity });
  assert.equal(JSON.parse(complete).value.length, 300000);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(300000)); process.exitCode=1'], { maxOutputChars: Infinity }), error => error.message.length === 2500);
});

test('publication reads the complete previous library when its JSON exceeds the log limit', async t => {
  const previous = { photos: [{ id: 'approved', title: 'old', description: 'x'.repeat(300000) }], buildingOverrides: {} };
  const current = { ...previous, photos: [{ ...previous.photos[0], title: 'new' }] };
  let previousFile;
  const { root, service } = await fixture(t, { current, runShow: settings => runCommand(process.execPath,
    ['-e', 'process.stdout.write(require("node:fs").readFileSync(process.argv[1], "utf8"))', previousFile], settings) });
  previousFile = path.join(root, '.local/previous-site.json');
  await fs.writeFile(previousFile, JSON.stringify(previous));
  const { plan, problem } = await service.status();
  assert.equal(problem, '');
  assert.equal(plan.added, 0); assert.equal(plan.updated, 1); assert.equal(plan.removed, 0);
  await service.start();
  assert.equal((await finished(service)).status, 'completed');
});

test('successful deployment is not reported complete until every photo can read likes', async t => {
  for (const options of [{ likesStatus: 503 }, { unsynced: true }]) {
    const { service } = await fixture(t, options);
    await service.start();
    const result = await finished(service);
    assert.equal(result.status, 'failed');
    assert.equal(result.websiteVerified, true);
    assert.match(result.message, /网站已发布.*点赞名单/);
  }
});

test('publication removes only its generated builds, preserving logs, originals and unknown directories', async t => {
  const { root } = await fixture(t);
  const directory = path.join(root, '.local/publication');
  const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await fs.mkdir(path.join(directory, id, 'build/media'), { recursive: true });
  await fs.mkdir(path.join(directory, 'unrecognized/build'), { recursive: true });
  await fs.writeFile(path.join(directory, id, 'build/media/generated.jpg'), 'copy');
  await fs.writeFile(path.join(directory, id + '.log'), 'record');
  await fs.writeFile(path.join(directory, id, 'keep.json'), 'record');
  await fs.writeFile(path.join(root, '.local/original.jpg'), 'original');
  await cleanPublicationBuilds(directory);
  await assert.rejects(fs.access(path.join(directory, id, 'build')));
  assert.equal(await fs.readFile(path.join(directory, id + '.log'), 'utf8'), 'record');
  assert.equal(await fs.readFile(path.join(directory, id, 'keep.json'), 'utf8'), 'record');
  assert.equal(await fs.readFile(path.join(root, '.local/original.jpg'), 'utf8'), 'original');
  await fs.access(path.join(directory, 'unrecognized/build'));
});

test('a failed build removes temporary images and keeps a readable disk-full error and saved photos', async t => {
  const { service, root, commands } = await fixture(t, { onCommand: async (_tool, args) => {
    if (args[1] !== 'run' || args[2] !== 'build') return;
    const out = args[args.indexOf('--outDir') + 1];
    await fs.mkdir(out, { recursive: true });
    await fs.writeFile(path.join(out, 'partial.jpg'), 'generated');
    throw new Error('Error: ENOSPC: no space left on device, copyfile original.jpg');
  } });
  await service.start();
  const result = await finished(service);
  assert.equal(result.status, 'failed'); assert.match(result.message, /磁盘空间不足/);
  await assert.rejects(fs.access(path.join(root, '.local/publication', result.id, 'build')));
  assert.ok(!commands.some(row => row[0] === 'git' && row[1] === 'push'));
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'public/data/site.json'), 'utf8')).photos.length, 1);
  assert.match(publicationError('ENOSPC'), /释放空间后可重试/);
});

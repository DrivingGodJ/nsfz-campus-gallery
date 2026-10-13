import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createNASCacheService } from '../server/nas-cache.mjs';

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const picture = 'public/media/' + id + '/thumbnail.webp';
const site = { revision: 1, photos: [{ id, files: { thumbnail: 'media/' + id + '/thumbnail.webp' } }] };
const write = async (root, file, bytes) => { await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true }); await fs.writeFile(path.join(root, file), bytes); };
const execute = promisify(execFile);
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-nas-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'local'), archiveRoot = path.join(directory, 'archive'), gallery = path.join(archiveRoot, 'nsfz-campus-gallery');
  await write(root, 'public/data/site.json', JSON.stringify(site));
  await write(root, 'public/data/campus.json', '{}');
  await write(gallery, 'public/data/site.json', JSON.stringify(site));
  await write(gallery, 'public/data/campus.json', '{}');
  await write(gallery, '.git/HEAD', 'ref: refs/heads/main\n');
  await write(gallery, picture, 'processed image');
  await write(gallery, '.local/originals/' + id + '/source.jpeg', 'private source image');
  await write(gallery, '.local/drafts.json', '[]');
  await write(gallery, '.local/removed/old.json', '{"removed":true}');
  await write(gallery, '.local/backups/before.json', '{"revision":0}');
  await write(gallery, '.local/depth-tools/package.json', '{"software":true}');
  let connected = true, onCheck;
  const service = createNASCacheService(root, { archiveRoot, isConnected: async () => { await onCheck?.(); return connected; } });
  return { root, gallery, archiveRoot, service, disconnect: () => { connected = false; }, onCheck: callback => { onCheck = callback; } };
}

test('NAS download restores public and private photos; clear leaves metadata, source and software intact', async t => {
  const { root, gallery, service } = await fixture(t);
  await write(root, 'src/source.ts', 'keep software');
  await write(root, '.local/vite/compiled.js', 'derived cache');
  await write(root, '.local/deployment/media-assets/' + picture.slice(7), 'disposable publication copy');
  const publication = '.local/publication/' + id;
  await write(root, publication + '/build/media/old.webp', 'old publication image');
  await write(root, publication + '/record.json', 'keep publication record');
  const partial = '.local/deployment/media-assets.' + id + '.tmp';
  await write(root, partial + '/media/old.webp', 'interrupted staging image');
  await fs.mkdir(path.join(root, '.local/depth-tools'), { recursive: true });
  await write(root, '.local/depth-tools/package.json', 'keep model runtime');
  const first = await service.status();
  assert.equal(first.connected, true); assert.equal(first.cached, false);
  const loaded = await service.download();
  assert.equal(loaded.busy, false); assert.equal(loaded.cached, true);
  assert.equal(await fs.readFile(path.join(root, picture), 'utf8'), 'processed image');
  assert.equal(await fs.readFile(path.join(root, '.local/originals/' + id + '/source.jpeg'), 'utf8'), 'private source image');
  assert.equal(await fs.readFile(path.join(root, '.local/depth-tools/package.json'), 'utf8'), 'keep model runtime');
  const cleared = await service.clear();
  assert.equal(cleared.cached, false); assert.equal(cleared.deleted, 4);
  await assert.rejects(fs.access(path.join(root, picture)), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(root, '.local/vite')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(root, '.local/deployment/media-assets')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(root, publication + '/build')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(root, partial)), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, publication + '/record.json'), 'utf8'), 'keep publication record');
  assert.equal(await fs.readFile(path.join(root, 'src/source.ts'), 'utf8'), 'keep software');
  assert.equal(await fs.readFile(path.join(root, '.local/depth-tools/package.json'), 'utf8'), 'keep model runtime');
  assert.equal(await fs.readFile(path.join(root, 'public/data/site.json'), 'utf8'), JSON.stringify(site));
  assert.equal(await fs.readFile(path.join(gallery, picture), 'utf8'), 'processed image');
  assert.equal((await service.download()).cached, true);
});

test('download and clear refuse unsynced changes; sync verifies and preserves private originals', async t => {
  const { root, gallery, service } = await fixture(t);
  await service.download();
  await write(root, picture, 'changed local image');
  await assert.rejects(service.download(), /尚未同步/);
  await assert.rejects(service.clear(), /尚未同步/);
  assert.equal(await fs.readFile(path.join(root, picture), 'utf8'), 'changed local image');
  await write(root, '.local/originals/new/source.jpeg', 'new private image');
  assert.equal((await service.sync()).busy, false);
  assert.equal(await fs.readFile(path.join(gallery, picture), 'utf8'), 'changed local image');
  assert.equal(await fs.readFile(path.join(gallery, '.local/originals/new/source.jpeg'), 'utf8'), 'new private image');
  assert.equal((await service.clear()).cached, false);
});

test('a concurrent NAS edit is never replaced; a disconnected NAS never allows cleanup', async t => {
  const { root, gallery, service, disconnect } = await fixture(t);
  await service.download();
  await write(root, picture, 'local edit');
  await write(gallery, picture, 'different NAS edit');
  await assert.rejects(service.sync(), /别处修改/);
  assert.equal(await fs.readFile(path.join(gallery, picture), 'utf8'), 'different NAS edit');
  disconnect();
  assert.equal((await service.status()).connected, false);
  await assert.rejects(service.download(), /NAS 未连接/);
  await assert.rejects(service.clear(), /NAS 未连接/);
  await assert.rejects(service.sync(), /NAS 未连接/);
  assert.equal(await fs.readFile(path.join(root, picture), 'utf8'), 'local edit');
});

test('download detects incomplete archives and rejects paths outside the project', async t => {
  const { root, gallery, service } = await fixture(t);
  await fs.unlink(path.join(gallery, picture));
  await assert.rejects(service.download(), /归档尚不完整/);
  await write(gallery, picture, 'processed image');
  await fs.symlink('/etc/hosts', path.join(gallery, '.local/originals/outside'));
  await assert.rejects(service.download(), /工程外/);
  await assert.rejects(fs.access(path.join(root, picture)), { code: 'ENOENT' });
});

test('publication sync fast-forwards the full NAS Git repository without replacing history', async t => {
  const { root, gallery, archiveRoot } = await fixture(t);
  const commands = [];
  const service = createNASCacheService(root, { archiveRoot, isConnected: async () => true, run: async (tool, args, options) => { commands.push([tool, ...args, options.cwd]); return ''; } });
  await service.download();
  await service.sync({ commit: 'a'.repeat(40) });
  assert.deepEqual(commands, [
    ['git', 'status', '--porcelain', '--untracked-files=no', gallery],
    ['git', 'fetch', 'origin', 'main', gallery],
    ['git', 'merge', '--ff-only', '--no-edit', 'a'.repeat(40), gallery]
  ]);
  const dirty = createNASCacheService(root, { archiveRoot, isConnected: async () => true, run: async () => ' M src/scene.ts\n' });
  await assert.rejects(dirty.sync({ commit: 'b'.repeat(40) }), /未提交的修改/);
  assert.equal(await fs.readFile(path.join(gallery, '.git/HEAD'), 'utf8'), 'ref: refs/heads/main\n');
});

test('the cache lock rejects another mutation while download is copying', async t => {
  const { service, onCheck } = await fixture(t);
  let resume, wait = false;
  onCheck(async () => { if (wait) await new Promise(resolve => { resume = resolve; }); });
  wait = true;
  const loading = service.download();
  while (!resume) await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.isBusy(), true);
  await assert.rejects(service.clear(), error => error.status === 423);
  wait = false; resume();
  await loading;
  assert.equal(service.isBusy(), false);
});

test('a plain local folder under Volumes is not accepted as a mounted NAS', async t => {
  const { root, archiveRoot } = await fixture(t);
  const service = createNASCacheService(root, { archiveRoot });
  assert.equal((await service.status()).connected, false);
  await assert.rejects(service.download(), /NAS 未连接/);
});

test('empty cache folders do not claim that photos have been downloaded', async t => {
  const { root, service } = await fixture(t);
  await fs.mkdir(path.join(root, 'public/media/empty'), { recursive: true });
  await fs.mkdir(path.join(root, '.local/originals/empty'), { recursive: true });
  await fs.mkdir(path.join(root, '.local/draft-media/empty'), { recursive: true });
  assert.equal((await service.status()).cached, false);
  await write(root, '.local/draft-media/empty/thumbnail.webp', 'new local photo');
  assert.equal((await service.status()).cached, true);
});

test('private review settings sync and restore with owner-only permissions and survive photo cleanup', async t => {
  const { root, gallery, service } = await fixture(t);
  const file = '.local/submission-service.json';
  await write(gallery, file, '{"ownerToken":"private-test-token"}');
  await service.download();
  assert.equal((await fs.stat(path.join(root, file))).mode & 0o777, 0o600);
  await write(root, file, '{"ownerToken":"changed-test-token"}');
  await service.sync();
  assert.equal(await fs.readFile(path.join(gallery, file), 'utf8'), '{"ownerToken":"changed-test-token"}');
  assert.equal((await fs.stat(path.join(gallery, file))).mode & 0o777, 0o600);
  await service.clear();
  assert.equal(await fs.readFile(path.join(root, file), 'utf8'), '{"ownerToken":"changed-test-token"}');
});

test('missing public photos can hydrate after an offline import without replacing drafts or local photo edits', async t => {
  const { root, gallery, service } = await fixture(t);
  await write(root, '.local/drafts.json', '[{"id":"new-offline-import"}]');
  await write(root, '.local/originals/new-offline-import/source.jpeg', 'keep new private photo');
  const loaded = await service.hydrateMissing();
  assert.equal(loaded.hydrated, 1); assert.equal(loaded.busy, false);
  assert.equal(await fs.readFile(path.join(root, picture), 'utf8'), 'processed image');
  assert.equal(await fs.readFile(path.join(root, '.local/drafts.json'), 'utf8'), '[{"id":"new-offline-import"}]');
  assert.equal(await fs.readFile(path.join(root, '.local/originals/new-offline-import/source.jpeg'), 'utf8'), 'keep new private photo');
  await write(root, picture, 'keep local edited photo');
  assert.equal((await service.hydrateMissing()).hydrated, 0);
  assert.equal(await fs.readFile(path.join(root, picture), 'utf8'), 'keep local edited photo');
  await service.sync();
  assert.equal(await fs.readFile(path.join(gallery, '.local/drafts.json'), 'utf8'), '[{"id":"new-offline-import"}]');
  assert.equal(await fs.readFile(path.join(gallery, picture), 'utf8'), 'keep local edited photo');
  await service.clear();
  const baseline = JSON.parse(await fs.readFile(path.join(root, '.local/nas-cache.json'), 'utf8'));
  assert.ok(baseline.clearedAt); assert.ok(baseline.files.every(file => !file.path.startsWith('public/media/')));
  await write(root, '.local/drafts.json', '[{"id":"second-import"}]');
  await write(root, '.local/originals/second-import/source.jpeg', 'second private photo');
  await service.sync();
  assert.equal(await fs.readFile(path.join(gallery, '.local/drafts.json'), 'utf8'), '[{"id":"second-import"}]');
});

test('missing-media hydration refuses incomplete or mismatched archives and never overwrites new files', async t => {
  const { root, gallery, service } = await fixture(t);
  await fs.unlink(path.join(gallery, picture));
  await assert.rejects(service.hydrateMissing(), /缺少上线所需/);
  await write(gallery, picture, 'processed image');
  await write(gallery, 'public/data/site.json', JSON.stringify({ ...site, revision: 2 }));
  await assert.rejects(service.hydrateMissing(), /已上线版本不同/);
  await write(gallery, 'public/data/site.json', JSON.stringify(site));
  await service.hydrateMissing();
  await write(root, picture, 'unsynced local image');
  await service.hydrateMissing();
  assert.equal(await fs.readFile(path.join(root, picture), 'utf8'), 'unsynced local image');
});

test('force-quit staging leftovers can be retried without deleting normal photo files', async t => {
  const { root, gallery, service } = await fixture(t);
  const photoTemporary = picture + '.' + id + '.nas-tmp';
  const metadataTemporary = 'public/data/site.json.' + id + '.nas-tmp';
  const originalTemporary = '.local/originals/' + id + '/source.jpeg.' + id + '.nas-tmp';
  await write(root, photoTemporary, 'incomplete image copy');
  await write(root, metadataTemporary, 'incomplete metadata copy');
  await write(gallery, originalTemporary, 'interrupted NAS copy');
  await service.download();
  await assert.rejects(fs.access(path.join(root, photoTemporary)), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(root, metadataTemporary)), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(root, originalTemporary)), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(root, picture), 'utf8'), 'processed image');
  assert.equal(await fs.readFile(path.join(gallery, '.local/originals/' + id + '/source.jpeg'), 'utf8'), 'private source image');
  await service.sync();
  await assert.rejects(fs.access(path.join(gallery, originalTemporary)), { code: 'ENOENT' });
  const regular = picture + '.not-a-uuid.nas-tmp';
  await write(root, regular, 'keep unrecognized file');
  await assert.rejects(service.clear(), /尚未同步/);
  assert.equal(await fs.readFile(path.join(root, regular), 'utf8'), 'keep unrecognized file');
});

test('a clean older app workspace follows the latest NAS main before downloading metadata', async t => {
  const { root, gallery, archiveRoot } = await fixture(t);
  const git = async (cwd, ...args) => (await execute('git', args, { cwd })).stdout;
  const identity = async cwd => { await git(cwd, 'config', 'user.name', 'Cache test'); await git(cwd, 'config', 'user.email', 'cache@example.invalid'); };
  await write(root, '.gitignore', '.local/\npublic/media/\n');
  await git(root, 'init', '-b', 'main'); await identity(root);
  await git(root, 'add', '.'); await git(root, 'commit', '-m', 'initial content');
  const copy = path.join(archiveRoot, 'git-template');
  await execute('git', ['clone', '--no-checkout', root, copy]);
  await fs.rm(path.join(gallery, '.git'), { recursive: true });
  await fs.cp(path.join(copy, '.git'), path.join(gallery, '.git'), { recursive: true });
  await fs.copyFile(path.join(root, '.gitignore'), path.join(gallery, '.gitignore'));
  await identity(gallery);
  const latest = { ...site, revision: 2 };
  await write(gallery, 'public/data/site.json', JSON.stringify(latest));
  await git(gallery, 'add', 'public/data/site.json'); await git(gallery, 'commit', '-m', 'published new library');
  const service = createNASCacheService(root, { archiveRoot, isConnected: async () => true });
  assert.equal((await service.download()).cached, true);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'public/data/site.json'), 'utf8')), latest);
  assert.equal((await git(root, 'rev-parse', 'HEAD')).trim(), (await git(gallery, 'rev-parse', 'HEAD')).trim());
  await write(root, 'public/data/site.json', JSON.stringify({ ...latest, revision: 3 }));
  await assert.rejects(service.download(), /尚未同步/);
  assert.equal(JSON.parse(await fs.readFile(path.join(root, 'public/data/site.json'), 'utf8')).revision, 3);
});

test('disconnecting during a download preserves originals and never cleans existing photos', async t => {
  const { root, gallery, service, onCheck, disconnect } = await fixture(t);
  let checks = 0;
  onCheck(async () => { if (++checks === 3) disconnect(); });
  await assert.rejects(service.download(), /NAS 未连接/);
  assert.equal(await fs.readFile(path.join(gallery, picture), 'utf8'), 'processed image');
  assert.equal(await fs.readFile(path.join(gallery, '.local/originals/' + id + '/source.jpeg'), 'utf8'), 'private source image');
  await assert.rejects(fs.access(path.join(root, '.local/nas-cache.json')), { code: 'ENOENT' });
  assert.equal(service.isBusy(), false);
});

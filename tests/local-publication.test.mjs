import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-publication-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  const previous = { photos: [], buildingOverrides: {} }, current = { photos: [{ id: 'approved', title: '校园照片' }], buildingOverrides: {} };
  const bytes = Buffer.from(JSON.stringify(current) + '\n');
  await fs.writeFile(path.join(root, 'public/data/site.json'), bytes);
  await fs.writeFile(path.join(root, '.local/drafts.json'), JSON.stringify([{ id: 'private-draft' }]));
  const commands = [], requests = [];
  const run = async (tool, args) => {
    commands.push([tool, ...args]);
    if (options.onCommand) await options.onCommand(tool, args, root);
    if (tool === 'git') {
      if (args[0] === 'status') return options.dirty ?? ' M public/data/site.json\0';
      if (args[0] === 'branch') return options.branch ?? 'main\n';
      if (args[0] === 'remote') return 'https://github.com/DrivingGodJ/nsfz-campus-gallery.git\n';
      if (args[0] === 'show') return JSON.stringify(previous);
      if (args[0] === 'rev-list') return '0\t0\n';
      if (args[0] === 'rev-parse') return 'a'.repeat(40) + '\n';
    }
    if (tool === 'gh' && args[0] === 'api') return JSON.stringify({ workflow_runs: [{ head_sha: 'a'.repeat(40), created_at: new Date().toISOString(), status: 'completed', conclusion: options.conclusion || 'success', html_url: 'https://github.com/DrivingGodJ/nsfz-campus-gallery/actions/runs/1' }] });
    return '';
  };
  const fetcher = async (url, settings) => {
    requests.push([url, settings?.method || 'GET']);
    if (url.startsWith(LIKES_API)) {
      const { photoIds } = JSON.parse(settings.body);
      return Response.json({ likes: Object.fromEntries(photoIds.map(id => [id, { count: 0, liked: false, ...(options.unsynced ? { available: false } : {}) }])) }, { status: options.likesStatus || 200 });
    }
    const published = options.remoteLibrary || current;
    return new Response(JSON.stringify(published), { status: options.responseStatus || 200 });
  };
  const service = createPublicationService(root, { run, fetcher, wait: () => new Promise(resolve => setImmediate(resolve)), maxPolls: 3 });
  return { root, service, commands, requests };
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

test('unrelated program changes and wrong branches cannot be committed by the review app', async t => {
  for (const options of [{ dirty: ' M src/editor.tsx\0' }, { branch: 'feature/unrelated' }]) {
    const { service, commands } = await fixture(t, options);
    await assert.rejects(service.start());
    assert.ok(!commands.some(row => ['add', 'commit', 'push'].includes(row[1])));
  }
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

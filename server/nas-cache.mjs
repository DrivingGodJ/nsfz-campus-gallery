import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { UserError, writeJSON } from './storage.mjs';
import { cleanPublicationBuilds } from './local-publication.mjs';

const execute = promisify(execFile);
// Only these disposable copies are removed. Project source and library metadata
// remain available for the editor and the online-media preview.
export const PHOTO_CACHE_PATHS = ['public/media', '.local/originals', '.local/draft-media', '.local/removed', '.local/backups', '.local/mail-submissions'];
const PRIVATE_SETTINGS = '.local/submission-service.json';
const METADATA_PATHS = ['public/data/site.json', 'public/data/campus.json', '.local/drafts.json', '.local/submission-reviews.json', PRIVATE_SETTINGS];
const CONTENT_PATHS = [...PHOTO_CACHE_PATHS, ...METADATA_PATHS];
// The running Vite server still references its optimized modules after reload.
const DERIVED_CACHE_PATHS = ['.local/deployment/media-assets'];
const STAGED_COPY = /\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.nas-tmp$/;
const exists = file => fs.lstat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
const digest = async file => {
  const hash = crypto.createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
};
const inside = (root, file) => file === root || file.startsWith(root + path.sep);

async function hasFiles(file) {
  let stats;
  try { stats = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (!stats.isDirectory()) return stats.isFile() || stats.isSymbolicLink();
  for (const name of await fs.readdir(file)) if (await hasFiles(path.join(file, name))) return true;
  return false;
}

async function inventory(root, paths = CONTENT_PATHS) {
  const rows = [];
  const canonicalRoot = await fs.realpath(root);
  async function visit(relative) {
    const file = path.join(root, relative);
    let stats;
    try { stats = await fs.lstat(file); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (STAGED_COPY.test(path.basename(file)) && !stats.isDirectory()) return;
    if (stats.isSymbolicLink()) {
      const target = await fs.readlink(file), resolved = await fs.realpath(file);
      if (path.isAbsolute(target) || !inside(canonicalRoot, resolved)) throw new UserError('照片缓存中存在指向工程外的软链接，未进行复制或清理：' + relative);
      rows.push({ path: relative, link: target, sha256: crypto.createHash('sha256').update(target).digest('hex'), bytes: 0 });
    } else if (stats.isDirectory()) {
      for (const name of (await fs.readdir(file)).sort()) await visit(path.join(relative, name));
    } else if (stats.isFile()) {
      if (!inside(canonicalRoot, await fs.realpath(file))) throw new UserError('照片缓存路径指向工程外，未进行复制或清理：' + relative);
      rows.push({ path: relative, sha256: await digest(file), bytes: stats.size });
    }
    else throw new UserError('照片缓存中存在无法复制的文件，未进行清理：' + relative);
  }
  for (const relative of paths) await visit(relative);
  return rows;
}

async function cleanStagedCopies(root, connected) {
  const canonicalRoot = await fs.realpath(root);
  async function visit(directory, recursive) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!inside(canonicalRoot, await fs.realpath(directory))) throw new UserError('照片缓存目录指向工程外，未清理临时副本。');
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (STAGED_COPY.test(entry.name) && !entry.isDirectory()) { await connected(); await fs.unlink(file); }
      else if (recursive && entry.isDirectory()) await visit(file, true);
    }
  }
  for (const relative of PHOTO_CACHE_PATHS) {
    const directory = path.join(root, relative);
    if (await fs.lstat(directory).then(stats => stats.isDirectory(), error => { if (error.code === 'ENOENT') return false; throw error; })) await visit(directory, true);
  }
  for (const relative of new Set(METADATA_PATHS.map(file => path.dirname(file)))) await visit(path.join(root, relative), false);
}

async function same(root, row) {
  const file = path.join(root, row.path);
  try {
    const stats = await fs.lstat(file);
    return row.link !== undefined
      ? stats.isSymbolicLink() && await fs.readlink(file) === row.link
      : stats.isFile() && !stats.isSymbolicLink() && stats.size === row.bytes && await digest(file) === row.sha256;
  } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function mountedArchive(archiveRoot) {
  const parts = path.resolve(archiveRoot).split(path.sep);
  if (parts[1] !== 'Volumes' || !parts[2]) return false;
  const volume = path.join('/Volumes', parts[2]);
  try {
    const [mount, parent, archive] = await Promise.all([fs.stat(volume), fs.stat('/Volumes'), fs.lstat(archiveRoot)]);
    return mount.isDirectory() && mount.dev !== parent.dev && archive.isDirectory() && !archive.isSymbolicLink();
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; }
}

export function createNASCacheService(root, { archiveRoot, configFile = process.env.CAMPUS_NAS_CONFIG || path.join(root, '.local/nas-archive.json'), isConnected = mountedArchive, run = async (tool, args, options) => (await execute(tool, args, { ...options, maxBuffer: 1024 * 1024 })).stdout } = {}) {
  const manifestFile = path.join(root, '.local/nas-cache.json');
  const modeFile = path.join(root, '.local/nas-library.json');
  const mode = async () => {
    try { return JSON.parse(await fs.readFile(modeFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const setDownloaded = async downloaded => { const value = await mode(); if (value?.version === 1) await writeJSON(modeFile, { ...value, downloaded }); };
  let operation = '', progress = '';
  async function location() {
    let configured = archiveRoot;
    if (!configured) {
      try { configured = JSON.parse(await fs.readFile(configFile, 'utf8')).archiveRoot; }
      catch (error) { if (error.code === 'ENOENT') return null; throw new UserError('NAS 归档设置无法读取，原有文件已保留。'); }
    }
    if (typeof configured !== 'string' || !path.isAbsolute(configured)) throw new UserError('NAS 归档目录无效，原有文件已保留。');
    return { archiveRoot: configured, gallery: path.join(configured, 'nsfz-campus-gallery'), media: path.join(configured, 'nsfz-campus-media') };
  }
  async function requireConnected() {
    const target = await location();
    if (!target) throw new UserError('尚未设置 NAS 归档位置。');
    if (!await isConnected(target.archiveRoot)) throw new UserError('NAS 未连接，请先连接“工程”共享。照片已保留在本地。', 409);
    if (!await exists(path.join(target.gallery, 'public/data/site.json')) || !await exists(path.join(target.gallery, '.git/HEAD'))) throw new UserError('NAS 工程归档尚未准备完整，原有文件已保留。', 409);
    return target;
  }
  async function manifest() {
    try { return JSON.parse(await fs.readFile(manifestFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function status() {
    let target;
    try { target = await location(); } catch (error) { return { configured: true, connected: false, cached: false, busy: !!operation, operation, message: error.message }; }
    const connected = !!target && await isConnected(target.archiveRoot);
    const cached = (await Promise.all(PHOTO_CACHE_PATHS.map(file => hasFiles(path.join(root, file))))).some(Boolean);
    const saved = await manifest();
    const primary = (await mode())?.version === 1;
    return { configured: !!target, connected, cached, busy: !!operation, operation, message: progress || (!target ? '' : connected ? primary ? cached ? '直接使用 NAS · 本地副本随修改更新。' : '直接使用 NAS，不保留本地照片。' : cached ? '照片已下载到本地。' : 'NAS 已连接，可以下载照片。' : 'NAS 未连接。'), syncedAt: saved?.syncedAt, downloadedAt: saved?.downloadedAt, ...(primary ? { storage: 'nas' } : {}) };
  }
  async function primaryRoot() { return (await mode())?.version === 1 ? (await location())?.gallery : null; }

  // NAS owns photos and annotations. Only small metadata is mirrored for Git;
  // photo bytes are copied to this machine solely after an explicit download.
  async function mirror() {
    return lock('mirror', async () => {
      const target = await requireConnected(), settings = await mode();
      if (settings?.version !== 1) return;
      const read = async (base, file, fallback) => {
        try { return JSON.parse(await fs.readFile(path.join(base, file), 'utf8')); }
        catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
      };
      const photoState = async base => [...(await read(base, 'public/data/site.json', { photos: [] })).photos.map(photo => ({ ...photo, _draft: false })), ...(await read(base, '.local/drafts.json', [])).map(photo => ({ ...photo, _draft: true }))];
      const previous = new Map((await photoState(root)).map(photo => [photo.id, photo]));
      const current = await photoState(target.gallery);
      const next = new Map(current.map(photo => [photo.id, photo]));
      if (settings.downloaded) {
        const ids = new Set([...previous.keys(), ...current.map(photo => photo.id)]);
        for (const id of ids) {
          const before = previous.get(id), after = next.get(id);
          if (before && after && JSON.stringify(before.files) === JSON.stringify(after.files) && before.depthUpdatedAt === after.depthUpdatedAt
            && before._draft === after._draft) continue;
          if (!/^[a-f0-9-]{36}$/.test(id)) throw new UserError('照片编号无效，未更新本地副本。');
          const paths = ['public/media/' + id, '.local/draft-media/' + id, '.local/originals/' + id, '.local/removed/' + id + '.json'];
          const rows = await inventory(target.gallery, paths), keys = new Set(rows.map(row => row.path));
          await transfer(target.gallery, root, rows, requireConnected);
          for (const row of await inventory(root, paths)) if (!keys.has(row.path) && /\/(thumbnail\.webp|preview\.webp|display\.webp|download\.jpg|depth\.webp|source\.[a-z0-9]+|[a-f0-9-]{36}\.json)$/.test(row.path)) {
            await requireConnected(); await fs.unlink(path.join(root, row.path));
          }
        }
      }
      const rows = await inventory(target.gallery, METADATA_PATHS);
      await transfer(target.gallery, root, rows, requireConnected);
    });
  }
  async function finishPublication({ commit }) {
    const target = await requireConnected();
    const local = await fs.readFile(path.join(root, 'public/data/site.json'));
    if (!(await fs.readFile(path.join(target.gallery, 'public/data/site.json'))).equals(local)) throw new UserError('NAS 内容刚刚发生变化，未更新归档版本。', 409);
    const status = (await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: target.gallery })).trim();
    if (status.split('\n').some(line => line && line.trim().slice(2).trim() !== 'public/data/site.json')) throw new UserError('NAS 工程还有程序修改，未覆盖归档。', 409);
    if (!/^[a-f0-9]{40}$/.test(commit)) throw new UserError('上线提交编号无效。');
    await run('git', ['fetch', 'origin', 'main'], { cwd: target.gallery });
    const mode = (await run('git', ['ls-tree', commit, '--', 'public/data/site.json'], { cwd: target.gallery })).trim().split(/\s+/)[0];
    if (!['100644', '100755'].includes(mode)) throw new UserError('上线版本的内容索引无效，未更新 NAS 归档。');
    // Staging the identical published file permits a safe fast-forward without
    // temporarily replacing NAS annotations with the previous version.
    await run('git', ['add', '--', 'public/data/site.json'], { cwd: target.gallery });
    // SMB repositories often ignore execute bits. Match the published index
    // mode as well as its identical content before the fast-forward.
    await run('git', ['update-index', mode === '100755' ? '--chmod=+x' : '--chmod=-x', '--', 'public/data/site.json'], { cwd: target.gallery });
    await run('git', ['merge', '--ff-only', '--no-edit', commit], { cwd: target.gallery });
  }
  async function lock(name, action) {
    if (operation) throw new UserError('照片缓存正在处理，请稍后再试。', 423);
    operation = name;
    try { return await action(); }
    finally { operation = ''; progress = ''; }
  }
  async function compareLibraryVersion(target) {
    const [local, remote] = await Promise.all([fs.readFile(path.join(root, 'public/data/site.json')), fs.readFile(path.join(target.gallery, 'public/data/site.json'))]);
    if (local.equals(remote)) return;
    const conflict = () => new UserError('本地内容库与 NAS 版本不同，且有尚未同步的修改。请先完成上线与同步，未覆盖本地资料。', 409);
    if (!await exists(path.join(root, '.git/HEAD'))) throw conflict();
    let drafts = [];
    try { drafts = JSON.parse(await fs.readFile(path.join(root, '.local/drafts.json'), 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (drafts.length || (await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root })).trim()
      || (await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: target.gallery })).trim()) throw conflict();
    for (const row of await inventory(root, PHOTO_CACHE_PATHS)) if (!await same(target.gallery, row)) throw conflict();
    const commit = (await run('git', ['rev-parse', 'HEAD'], { cwd: target.gallery })).trim();
    if (!/^[a-f0-9]{40}$/.test(commit)) throw conflict();
    progress = '正在更新本地工程到 NAS 的已上线版本…';
    await run('git', ['fetch', target.gallery, 'main'], { cwd: root });
    await requireConnected();
    await run('git', ['merge', '--ff-only', '--no-edit', commit], { cwd: root });
    if (!(await fs.readFile(path.join(root, 'public/data/site.json'))).equals(remote)) throw conflict();
  }
  async function record(target, rows, dates) {
    await writeJSON(manifestFile, { archiveRoot: target.archiveRoot, files: rows, ...dates });
  }
  async function transfer(sourceRoot, destinationRoot, rows, connected, { onlyMissing = false } = {}) {
    const canonicalDestination = await fs.realpath(destinationRoot);
    let count = 0;
    for (const row of rows) {
      progress = '正在复制并校验照片 ' + (++count) + ' / ' + rows.length;
      await connected();
      if (await same(destinationRoot, row)) {
        if (row.path === PRIVATE_SETTINGS) await fs.chmod(path.join(destinationRoot, row.path), 0o600);
        continue;
      }
      if (onlyMissing && await exists(path.join(destinationRoot, row.path))) continue;
      if (!await same(sourceRoot, row)) throw new UserError('复制过程中源文件发生变化，现有文件已保留，请重试。', 409);
      const destination = path.join(destinationRoot, row.path), temporary = destination + '.' + crypto.randomUUID() + '.nas-tmp';
      let parent = path.dirname(destination);
      while (!await exists(parent)) parent = path.dirname(parent);
      if (!inside(canonicalDestination, await fs.realpath(parent))) throw new UserError('照片缓存目标路径指向工程外，未替换文件。');
      // Never recursively recreate the archive root if SMB disappears between
      // the mount check and a write. Each new directory needs its real parent.
      let directory = destinationRoot;
      for (const part of path.relative(destinationRoot, path.dirname(destination)).split(path.sep).filter(Boolean)) {
        directory = path.join(directory, part);
        try { await fs.mkdir(directory); }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      try {
        if (row.link !== undefined) await fs.symlink(row.link, temporary);
        else await fs.copyFile(path.join(sourceRoot, row.path), temporary, constants.COPYFILE_FICLONE);
        const staged = { ...row, path: path.relative(destinationRoot, temporary) };
        if (!await same(destinationRoot, staged)) throw new UserError('照片复制校验失败，原有文件已保留。');
        await connected();
        if (!await same(sourceRoot, row)) throw new UserError('复制过程中源文件发生变化，原有文件已保留。', 409);
        if (onlyMissing) {
          // link() never replaces a file that another process created while
          // this copy was in flight. The temporary copy is removed below.
          try { await fs.link(temporary, destination); }
          catch (error) { if (error.code !== 'EEXIST') throw error; }
        } else await fs.rename(temporary, destination);
        if (row.path === PRIVATE_SETTINGS) await fs.chmod(destination, 0o600);
      } finally { await fs.rm(temporary, { force: true }); }
    }
  }
  async function checkPublishedFiles(target) {
    const site = JSON.parse(await fs.readFile(path.join(target.gallery, 'public/data/site.json'), 'utf8'));
    for (const photo of site.photos) for (const file of Object.values(photo.files || {})) {
      if (typeof file !== 'string' || !/^media\/[a-f0-9-]{36}\/(thumbnail\.webp|preview\.webp|display\.webp|download\.jpg|depth\.webp)$/.test(file) || !await exists(path.join(target.gallery, 'public', file))) throw new UserError('NAS 的照片归档尚不完整，未替换本地资料。', 409);
    }
  }
  async function hydrateMissing() {
    return lock('hydrate', async () => {
      const target = await requireConnected();
      await cleanStagedCopies(root, requireConnected);
      const siteBytes = await fs.readFile(path.join(root, 'public/data/site.json'));
      const site = JSON.parse(siteBytes), keys = new Set();
      for (const photo of site.photos) for (const file of Object.values(photo.files || {})) {
        if (typeof file !== 'string' || !/^media\/[a-f0-9-]{36}\/(thumbnail\.webp|preview\.webp|display\.webp|download\.jpg|depth\.webp)$/.test(file)) throw new UserError('照片文件路径无效，未覆盖本地照片。');
        keys.add(path.join('public', file));
      }
      const previous = await manifest();
      if (!previous || previous.archiveRoot !== target.archiveRoot) {
        const saved = await exists(path.join(root, '.git/HEAD'))
          ? Buffer.from(await run('git', ['show', 'HEAD:public/data/site.json'], { cwd: root })) : siteBytes;
        if (!(await fs.readFile(path.join(target.gallery, 'public/data/site.json'))).equals(saved)) throw new UserError('NAS 内容库与本地已上线版本不同，未覆盖本地草稿。请先核对工程版本。', 409);
      }
      const missing = [], archived = [];
      for (const file of keys) {
        const localExists = await exists(path.join(root, file)), archiveExists = await exists(path.join(target.gallery, file));
        if (!localExists && !archiveExists) throw new UserError('NAS 缺少上线所需的照片，未覆盖本地草稿：' + file, 409);
        if (!localExists) missing.push(file);
        if (archiveExists) archived.push(file);
      }
      progress = '正在从 NAS 补齐上线所需的公开照片，保留新草稿…';
      const rows = await inventory(target.gallery, archived);
      const missingPaths = new Set(missing);
      await transfer(target.gallery, root, rows.filter(row => missingPaths.has(row.path)), requireConnected, { onlyMissing: true });
      if (!(await fs.readFile(path.join(root, 'public/data/site.json'))).equals(siteBytes)) throw new UserError('补齐照片时本地内容库发生变化，未覆盖修改，请重试。', 409);
      const baseline = new Map(previous?.archiveRoot === target.archiveRoot ? (previous.files || []).map(row => [row.path, row]) : []);
      for (const row of [...rows, ...await inventory(target.gallery, METADATA_PATHS)]) if (!baseline.has(row.path)) baseline.set(row.path, row);
      await record(target, [...baseline.values()], { downloadedAt: previous?.downloadedAt, syncedAt: previous?.syncedAt, clearedAt: previous?.clearedAt });
      return { ...await status(), busy: false, operation: '', hydrated: missing.length };
    });
  }
  async function download() {
    return lock('download', async () => {
      const target = await requireConnected();
      if ((await mode())?.version === 1) {
        progress = '正在下载 NAS 照片，后续修改会同步更新这份本地副本…';
        const rows = await inventory(target.gallery);
        await transfer(target.gallery, root, rows, requireConnected);
        for (const row of rows) if (!await same(root, row)) throw new UserError('本地副本校验尚未完成，已下载文件保留，请重试。');
        await record(target, rows, { downloadedAt: new Date().toISOString() });
        await setDownloaded(true);
        return { ...await status(), busy: false, operation: '' };
      }
      await cleanStagedCopies(root, requireConnected);
      await compareLibraryVersion(target);
      await checkPublishedFiles(target);
      progress = '正在核对 NAS 与本地照片…';
      const local = await inventory(root);
      for (const row of local) if (!await same(target.gallery, row)) throw new UserError('本地有尚未同步的照片或资料，请先上线并同步，再下载。未覆盖本地修改。', 409);
      const rows = await inventory(target.gallery);
      await transfer(target.gallery, root, rows.filter(row => !METADATA_PATHS.includes(row.path)), requireConnected, { onlyMissing: true });
      await transfer(target.gallery, root, rows.filter(row => METADATA_PATHS.includes(row.path)), requireConnected, { onlyMissing: true });
      for (const row of rows) if (!await same(root, row)) throw new UserError('下载校验尚未完成，已下载文件保留，请重试。');
      await record(target, rows, { downloadedAt: new Date().toISOString() });
      await setDownloaded(true);
      return { ...await status(), busy: false, operation: '' };
    });
  }
  async function remove() {
    return lock('remove', async () => {
      const target = await requireConnected();
      await cleanStagedCopies(root, requireConnected);
      progress = '正在核对 NAS 备份，确认后清理本地照片…';
      const rows = await inventory(root);
      for (const row of rows) if (!await same(target.gallery, row)) throw new UserError('有照片或资料尚未同步到 NAS，未清理本地文件。请先上线并同步。', 409);
      await requireConnected();
      // Recheck metadata just before deleting. Requests made through the editor
      // are blocked while busy; exact-file removal also preserves new files.
      for (const row of rows) if (!await same(root, row)) throw new UserError('本地文件刚刚发生变化，未继续清理。', 409);
      const deleted = [];
      for (const row of rows.filter(row => PHOTO_CACHE_PATHS.some(prefix => row.path.startsWith(prefix + path.sep)))) {
        await requireConnected();
        if (!await same(root, row) || !await same(target.gallery, row)) throw new UserError('清理过程中照片发生变化，剩余文件已保留。', 409);
        await fs.unlink(path.join(root, row.path)); deleted.push(row.path);
      }
      async function empty(directory) {
        let entries;
        try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
        for (const entry of entries) if (entry.isDirectory()) await empty(path.join(directory, entry.name));
        try { await fs.rmdir(directory); } catch (error) { if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) throw error; }
      }
      for (const relative of PHOTO_CACHE_PATHS) await empty(path.join(root, relative));
      for (const relative of DERIVED_CACHE_PATHS) await fs.rm(path.join(root, relative), { recursive: true, force: true });
      const deployment = path.join(root, '.local/deployment');
      const temporary = await fs.readdir(deployment).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
      for (const name of temporary) if (/^media-assets\.[a-f0-9-]{36}\.tmp$/.test(name)) await fs.rm(path.join(deployment, name), { recursive: true, force: true });
      await cleanPublicationBuilds(path.join(root, '.local/publication'));
      const previous = await manifest();
      await record(target, rows.filter(row => METADATA_PATHS.includes(row.path)), { syncedAt: previous?.syncedAt, clearedAt: new Date().toISOString() });
      await setDownloaded(false);
      return { ...await status(), busy: false, operation: '', deleted: deleted.length };
    });
  }
  async function sync({ commit } = {}) {
    return lock('sync', async () => {
      const target = await requireConnected();
      await cleanStagedCopies(root, requireConnected);
      await cleanStagedCopies(target.gallery, requireConnected);
      progress = '正在将上线后的工程与照片同步到 NAS…';
      if (commit) {
        if (!/^[a-f0-9]{40}$/.test(commit)) throw new UserError('上线提交编号无效，未更新 NAS 工程。');
        if ((await run('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: target.gallery })).trim()) throw new UserError('网站已上线，但 NAS 工程有未提交的修改，未覆盖归档。照片仍保留在本地，请处理后重试同步。', 409);
        await run('git', ['fetch', 'origin', 'main'], { cwd: target.gallery });
        await requireConnected();
        await run('git', ['merge', '--ff-only', '--no-edit', commit], { cwd: target.gallery });
      }
      const rows = await inventory(root), previous = await manifest();
      const baseline = new Map(previous?.archiveRoot === target.archiveRoot ? (previous.files || []).map(row => [row.path, row]) : []);
      // A different NAS edit must never be silently replaced by a cache copy.
      for (const row of rows) if (await exists(path.join(target.gallery, row.path)) && !await same(target.gallery, row) && !(baseline.has(row.path) && await same(target.gallery, baseline.get(row.path)))) throw new UserError('网站已上线，但 NAS 照片或资料已在别处修改，未覆盖归档。照片仍保留在本地，请先核对。', 409);
      await transfer(root, target.gallery, rows.filter(row => !METADATA_PATHS.includes(row.path)), requireConnected);
      await transfer(root, target.gallery, rows.filter(row => METADATA_PATHS.includes(row.path)), requireConnected);
      for (const row of rows) if (!await same(target.gallery, row) || !await same(root, row)) throw new UserError('网站已上线，但 NAS 同步校验尚未完成。本地照片已保留，请重试。');
      await record(target, rows, { downloadedAt: previous?.downloadedAt, syncedAt: new Date().toISOString() });
      return { ...await status(), busy: false, operation: '' };
    });
  }
  return { status, download, hydrateMissing, clear: remove, remove, sync, requireConnected, primaryRoot, mirror, finishPublication, isBusy: () => !!operation };
}

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { ASSET_PATTERN, UserError, writeJSON } from './storage.mjs';
import { PHOTO_DOWNLOAD_MAX_BYTES } from './photo-preview.mjs';
import { MEDIA_BASE_URL } from './media-publication.mjs';

export const PUBLIC_SITE = 'https://drivinggodj.github.io/nsfz-campus-gallery/';
export const LIKES_API = 'https://likes.drivinggodj.dpdns.org/api/likes';
const REPOSITORY = 'DrivingGodJ/nsfz-campus-gallery';
const CONTENT = /^(public\/data\/site\.json|public\/media\/[a-f0-9-]{36}\/(thumbnail\.webp|preview\.webp|display\.webp|download\.jpg|depth\.webp))$/;
export const contentPath = value => CONTENT.test(value);
export function changedPaths(porcelain) {
  const entries = porcelain.split('\0'), result = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!entry) continue;
    result.push(entry.slice(3));
    if (/[RC]/.test(entry.slice(0, 2))) result.push(entries[++i]);
  }
  return [...new Set(result)];
}
export function photoChanges(previous, current) {
  const old = new Map(previous.photos.map(photo => [photo.id, photo]));
  const next = new Map(current.photos.map(photo => [photo.id, photo]));
  return {
    added: current.photos.filter(photo => !old.has(photo.id)).length,
    updated: current.photos.filter(photo => old.has(photo.id) && JSON.stringify(old.get(photo.id)) !== JSON.stringify(photo)).length,
    removed: previous.photos.filter(photo => !next.has(photo.id)).length,
    buildingChanged: JSON.stringify(previous.buildingOverrides) !== JSON.stringify(current.buildingOverrides)
  };
}
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function cleanPublicationBuilds(directory) {
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  // These are disposable checks, never the public content or private originals.
  // Keep every publication record, log and unrecognized directory.
  for (const entry of entries) if (entry.isDirectory() && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(entry.name)) {
    await fs.rm(path.join(directory, entry.name, 'build'), { recursive: true, force: true });
  }
}
export function publicationError(message) {
  if (String(message).includes('图片托管尚未登录')) return '图片托管尚未登录。请先完成 Cloudflare 登录授权，再重试上线。照片已保存在 NAS。';
  if (/ENOSPC|no space left on device/i.test(String(message))) return '磁盘空间不足，未完成上线。照片与审核记录已保留，临时构建文件会自动清理；释放空间后可重试。';
  return redact(message);
}
function redact(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, '').replace(/\bgh[pousr]_[A-Za-z0-9_]+/g, '[已隐藏凭证]').replace(/(Bearer\s+)\S+/gi, '$1[已隐藏凭证]');
}
export function runCommand(command, args, { cwd, env = process.env, timeout = 180000, onOutput = () => {}, maxOutputChars = 250000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let output = '', expired = false;
    const read = chunk => { const text = redact(chunk.toString()); output = (output + text).slice(-maxOutputChars); onOutput(text); };
    child.stdout.on('data', read); child.stderr.on('data', read);
    const timer = setTimeout(() => { expired = true; child.kill('SIGTERM'); }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(new UserError(error.code === 'ENOENT' ? '找不到上线所需的工具，请重新安装审核应用或检查项目。' : error.message)); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && !expired) resolve(output);
      else reject(new UserError(expired ? '这一步等待过久，请检查网络后重试。已保存内容仍在本地。' : (output.trim().slice(-2500) || '这一步执行失败，已保存内容仍在本地。')));
    });
  });
}
async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export function createPublicationService(root, { run = runCommand, fetcher = fetch, wait = delay, pollMs = 6000, maxPolls = 150, mediaRoot = process.env.CAMPUS_MEDIA_ROOT || path.resolve(root, '../nsfz-campus-media'), beforePublish, afterPublish, sourceRoot = root, incremental = false } = {}) {
  const directory = path.join(root, '.local/publication'), lockFile = path.join(directory, 'lock.json');
  const hashes = new Map();
  let active = null, latestPlan = null, planning;
  const command = (tool, args, options = {}) => run(tool, args, { cwd: root, ...options });
  const git = (...args) => command('git', args);
  const mediaGit = (...args) => command('git', args, { cwd: mediaRoot });
  async function commitMedia(files) {
    const message = 'Publish reviewed campus photos';
    const args = ['commit', '-m', message, '--', ...files];
    try { return await mediaGit(...args); }
    catch (error) {
      if (!error.message.includes('a NUL byte in commit log message')) throw error;
      const file = path.resolve(mediaRoot, (await mediaGit('rev-parse', '--git-path', 'COMMIT_EDITMSG')).trim());
      const bytes = await fs.readFile(file);
      // SMB can retain the previous length after Git truncates this disposable
      // file. Repair only our exact message plus trailing padding, never edits.
      if (!bytes.includes(0) || bytes.toString().replace(/\0+$/, '') !== message + '\n') throw error;
      if (await fs.access(path.join(path.dirname(file), 'index.lock')).then(() => true, () => false)) throw error;
      const temporary = file + '.' + crypto.randomUUID() + '.tmp';
      try {
        await fs.writeFile(temporary, message + '\n', { flag: 'wx' });
        await fs.rename(temporary, file);
        return await mediaGit(...args);
      } finally { await fs.rm(temporary, { force: true }); }
    }
  }
  const gh = (...args) => command('gh', args);
  const externalMedia = () => fs.access(path.join(mediaRoot, '.git')).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
  async function hash(file, fresh) {
    const stat = await fs.stat(file), key = [stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
    const cached = hashes.get(file);
    if (!fresh && cached?.key === key) return cached.value;
    const value = await fileHash(file);
    hashes.set(file, { key, value, bytes: stat.size });
    return value;
  }
  const npm = async (script, args = [], env = {}) => {
    const cli = process.env.CAMPUS_NPM_CLI || path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
    const environment = { ...process.env, ...env };
    // Tests own their temporary libraries; retain only the marker that skips native UI tests.
    if (script === 'test') {
      for (const key of Object.keys(environment)) if (key.startsWith('CAMPUS_') && key !== 'CAMPUS_DESKTOP_APP') delete environment[key];
      environment.MINIFLARE_CACHE_DIR = path.join(root, '.local/miniflare-cache');
    }
    return command(process.execPath, [cli, 'run', script, ...args], { timeout: 600000, env: environment, onOutput: text => { if (active) fs.appendFile(path.join(directory, active.id + '.log'), text).catch(() => {}); } });
  };
  async function publishing() {
    if (active?.running) return true;
    try {
      const lock = JSON.parse(await fs.readFile(lockFile, 'utf8'));
      try { process.kill(lock.pid, 0); return true; } catch { return false; }
    } catch { return false; }
  }
  async function snapshot() {
    if (active) return structuredClone(active);
    try {
      const saved = JSON.parse(await fs.readFile(path.join(directory, 'latest.json'), 'utf8'));
      if (saved.running && !(await publishing())) return { ...saved, running: false, status: 'failed', message: '上次上线被中断。内容已保留，可以重新上线。' };
      return saved.status === 'failed' ? { ...saved, message: publicationError(saved.message) } : saved;
    } catch { return { running: false, status: 'idle', message: '' }; }
  }
  async function plan(fresh = false, allowMissingMedia = false) {
    const paths = changedPaths(await git('status', '--porcelain=v1', '-z', '--untracked-files=all'));
    const branch = (await git('branch', '--show-current')).trim();
    const remote = (await git('remote', 'get-url', 'origin')).trim();
    if (branch !== 'main' || !/^https:\/\/github\.com\/DrivingGodJ\/nsfz-campus-gallery(?:\.git)?\/?$/i.test(remote)) throw new UserError('请选择附中影像项目的 main 内容库；应用只向这个项目发布。');
    const other = paths.filter(file => !contentPath(file));
    if (other.length) throw new UserError('项目还有未完成的程序修改，暂时不能自动上线。照片已保留。需要先处理：' + other.slice(0, 5).join('、'));
    const [current, drafts, previousText, counts] = await Promise.all([
      fs.readFile(path.join(sourceRoot, 'public/data/site.json'), 'utf8').then(JSON.parse),
      fs.readFile(path.join(sourceRoot, '.local/drafts.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return []; throw error; }),
      command('git', ['show', 'origin/main:public/data/site.json'], { maxOutputChars: Infinity }),
      git('rev-list', '--left-right', '--count', 'HEAD...origin/main')
    ]);
    const [ahead, behind] = counts.trim().split(/\s+/).map(Number);
    if (behind) throw new UserError('GitHub 上已有更新，本地内容库需要先同步。应用不会覆盖你审核好的照片。');
    const fingerprint = crypto.createHash('sha256').update(await git('rev-parse', 'HEAD'));
    for (const file of paths) {
      fingerprint.update(file);
      try { fingerprint.update(await fs.readFile(path.join(root, file))); }
      catch (error) { if (error.code !== 'ENOENT') throw error; fingerprint.update('deleted'); }
    }
    // The backup repository changes during a normal publish; this fingerprint
    // covers only the source that must stay unchanged while images upload.
    const sourceFingerprint = fingerprint.copy().update(JSON.stringify(current));
    let media;
    if (incremental && !fresh) {
      latestPlan = { ...photoChanges(JSON.parse(previousText), current), files: paths, saved: current.photos.length, drafts: drafts.length, ahead, siteURL: PUBLIC_SITE };
      return latestPlan;
    }
    const useExternalMedia = await externalMedia();
    if (!useExternalMedia) {
      const ignored = await fs.readFile(path.join(root, '.gitignore'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
      if (/^\/?public\/media\/?\s*$/m.test(ignored)) throw new UserError('图片库未就绪，请先恢复项目旁的 nsfz-campus-media 图片内容库后再上线。');
    }
    if (useExternalMedia) {
      const [mediaBranch, mediaRemote, mediaCounts, mediaStatus, mediaHead] = await Promise.all([
        mediaGit('branch', '--show-current'), mediaGit('remote', 'get-url', 'origin'),
        mediaGit('rev-list', '--left-right', '--count', 'HEAD...origin/main'),
        mediaGit('status', '--porcelain=v1', '-z', '--untracked-files=all'), mediaGit('rev-parse', 'HEAD')
      ]);
      if (mediaBranch.trim() !== 'main' || !/^https:\/\/github\.com\/DrivingGodJ\/nsfz-campus-media(?:\.git)?\/?$/i.test(mediaRemote.trim())) throw new UserError('图片内容库不正确，请选择附中影像图片仓库的 main 分支。');
      const [mediaAhead, mediaBehind] = mediaCounts.trim().split(/\s+/).map(Number);
      if (mediaBehind) throw new UserError('GitHub 图片库已有更新，请先同步图片库后再上线。');
      if (current.photos.some(photo => !Number.isInteger(photo.downloadBytes) || photo.downloadBytes <= 0 || photo.downloadBytes > PHOTO_DOWNLOAD_MAX_BYTES || !ASSET_PATTERN.test(photo.files?.download))) throw new UserError('下载图片资料超过 5 MB 或路径无效，请先压缩后发布。');
      const previous = new Map(JSON.parse(previousText).photos.map(photo => [photo.id, photo]));
      const changedMedia = new Set(changedPaths(mediaStatus));
      const assets = [...new Set(current.photos.flatMap(photo => Object.entries(photo.files ?? {}).filter(([kind, file]) => {
        const old = previous.get(photo.id);
        return !incremental || !old || old.files?.[kind] !== file || kind === 'depth' && old.depthUpdatedAt !== photo.depthUpdatedAt || changedMedia.has(file);
      }).map(([, file]) => file)))].sort();
      if (assets.some(file => !ASSET_PATTERN.test(file))) throw new UserError('照片文件路径不正确，未上传任何私人原片。');
      const mediaPaths = changedPaths(mediaStatus);
      const unrelated = mediaPaths.filter(file => !ASSET_PATTERN.test(file) && file !== 'README.md');
      if (unrelated.length) throw new UserError('图片内容库还有其他修改，请先处理：' + unrelated.slice(0, 5).join('、'));
      const files = [], manifest = [], missingAssets = [];
      fingerprint.update(mediaHead).update(mediaStatus);
      for (const file of assets) {
        let localHash, bytes, missing = false;
        try {
          const localFile = path.join(sourceRoot, 'public', file);
          localHash = await hash(localFile, fresh);
          bytes = hashes.get(localFile).bytes;
          if (file.endsWith('/download.jpg') && bytes > PHOTO_DOWNLOAD_MAX_BYTES) throw new UserError('下载图片超过 5 MB，请先压缩后发布。');
        }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          if (!allowMissingMedia) throw new UserError('缺少已审核的照片文件：' + file);
          missing = true;
        }
        let storedHash = 'missing';
        try { storedHash = await hash(path.join(mediaRoot, file), fresh); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (missing) {
          if (storedHash === 'missing') throw new UserError('照片尚未在 NAS 归档中找到，请先恢复照片：' + file);
          localHash = storedHash;
          bytes = hashes.get(path.join(mediaRoot, file)).bytes;
          missingAssets.push(file);
        }
        if (mediaPaths.includes(file) && localHash !== storedHash) throw new UserError('图片库中的照片文件有未同步的修改，未覆盖。请先核对：' + file);
        // Ignored public/media files must still participate in the publication check.
        fingerprint.update(file).update(localHash).update(storedHash);
        sourceFingerprint.update(file).update(localHash);
        manifest.push({ key: file, bytes, sha256: localHash });
        if (localHash !== storedHash || mediaPaths.includes(file)) files.push(file);
      }
      if (mediaPaths.includes('README.md')) {
        try { fingerprint.update(await hash(path.join(mediaRoot, 'README.md'), fresh)); files.push('README.md'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; throw new UserError('图片内容库的说明文件已删除，请先恢复后再上线。'); }
      }
      media = { assets, manifest, files, missingAssets, ahead: mediaAhead, baseURL: MEDIA_BASE_URL };
    }
    latestPlan = { ...photoChanges(JSON.parse(previousText), current), files: media ? paths.filter(file => !file.startsWith('public/media/')) : paths, media, fingerprint: fingerprint.digest('hex'), sourceFingerprint: sourceFingerprint.digest('hex'), saved: current.photos.length, drafts: drafts.length, ahead, siteURL: PUBLIC_SITE };
    return latestPlan;
  }
  async function status() {
    const publication = await snapshot();
    if (publication.running && latestPlan) return { publication, plan: latestPlan, problem: '' };
    try {
      planning ||= plan(false, !!beforePublish).finally(() => { planning = null; });
      return { publication, plan: await planning, problem: '' };
    }
    catch (error) { return { publication, plan: null, problem: error.message }; }
  }
  async function update(patch) {
    Object.assign(active, patch);
    await writeJSON(path.join(directory, 'latest.json'), active);
  }
  async function acquire() {
    await fs.mkdir(directory, { recursive: true });
    if (await publishing()) throw new UserError('已经有一个上线任务正在执行，请等待完成。', 409);
    const create = () => fs.writeFile(lockFile, JSON.stringify({ pid: process.pid }), { flag: 'wx' });
    try { await create(); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (await publishing()) throw new UserError('另一窗口正在上线，请等待完成。', 409);
      // Remove only a stale lock owned by a process that has exited.
      await fs.rm(lockFile, { force: true });
      try { await create(); }
      catch (error) { if (error.code === 'EEXIST') throw new UserError('另一窗口正在上线，请等待完成。', 409); throw error; }
    }
  }
  async function verifyAssets(expected, prepared) {
    const assets = prepared.media ? prepared.media.assets : prepared.files.filter(file => file.startsWith('public/media/')).map(file => file.slice(7));
    const manifest = new Map(prepared.media?.manifest.map(asset => [asset.key, asset]) || []);
    let pending = assets;
    for (let attempt = 0; attempt < 10; attempt++) {
      let next = 0;
      const retry = [];
      await Promise.all(Array.from({ length: Math.min(6, pending.length) }, async () => {
        while (next < pending.length) {
          const file = pending[next++], origin = new URL(PUBLIC_SITE).origin;
          let asset;
          try { asset = await fetcher((prepared.media?.baseURL || PUBLIC_SITE) + file + '?review=' + expected, { method: 'HEAD', cache: 'no-store', headers: { Origin: origin }, signal: AbortSignal.timeout(25000) }); }
          catch { retry.push(file); continue; }
          if (!asset.ok) {
            if ([404, 429, 500, 502, 503, 504].includes(asset.status)) { retry.push(file); continue; }
            throw new UserError('照片托管未通过检查，有照片文件尚未加载成功。照片和上线记录已保留，可以稍后重试。');
          }
          // A deployment response can arrive before every edge serves the new
          // version. Wait for the expected bytes, including same-path updates.
          if (incremental && asset.headers.get('etag')?.replace(/^W\//, '').replaceAll('"', '') !== manifest.get(file)?.sha256.slice(0, 32)) { retry.push(file); continue; }
          if (prepared.media) {
            const cors = asset.headers.get('access-control-allow-origin');
            const mime = file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
            const length = asset.headers.get('content-length');
            // Native Static Assets can return only its content-hash ETag on HEAD.
            const validMetadata = length === null ? Boolean(asset.headers.get('etag')?.trim()) : Number(length) === manifest.get(file).bytes;
            if (![origin, '*'].includes(cors) || asset.headers.get('content-type')?.split(';')[0].trim() !== mime
              || !validMetadata) throw new UserError('照片托管的跨域、图片类型或文件大小检查未通过。照片和备份已保留，请检查托管配置后重试。');
          }
        }
      }));
      if (!retry.length) return;
      if (attempt === 9) throw new UserError('照片托管未通过检查，有照片文件尚未加载成功。照片和上线记录已保留，可以稍后重试。');
      await update({ message: '照片已上传，正在等待公开图片生效…' });
      await wait(pollMs);
      pending = retry;
    }
  }
  async function verifyWebsite(expected, prepared) {
    const local = JSON.parse(await fs.readFile(path.join(root, 'public/data/site.json'), 'utf8'));
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await fetcher(PUBLIC_SITE + 'data/site.json?review=' + expected, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
      // Static validation may reorder fields (for example aerial altitude).
      // Compare the entire library while ignoring JSON object key order.
      if (response.ok && isDeepStrictEqual(await response.json().catch(() => null), local)) {
        await verifyAssets(expected, prepared);
        return;
      }
      await wait(pollMs);
    }
    throw new UserError('GitHub 已完成发布，但还没确认到最新网页。请检查网站，或稍后重新上线。');
  }
  async function verifyLikes() {
    const site = JSON.parse(await fs.readFile(path.join(root, 'public/data/site.json'), 'utf8'));
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        for (let index = 0; index < site.photos.length; index += 50) {
          const ids = site.photos.slice(index, index + 50).map(photo => photo.id);
          const response = await fetcher(LIKES_API + '/read', { method: 'POST', cache: 'no-store',
            headers: { Origin: new URL(PUBLIC_SITE).origin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ photoIds: ids }), signal: AbortSignal.timeout(25000) });
          if (!response.ok) throw new Error('likes unavailable');
          const data = await response.json();
          if (ids.some(id => !Number.isSafeInteger(data.likes?.[id]?.count) || data.likes[id].count < 0
            || typeof data.likes[id].liked !== 'boolean' || data.likes[id].available === false)) throw new Error('likes not synced');
        }
        return;
      } catch { if (attempt < 3) await wait(pollMs); }
    }
    throw new UserError('网站已发布，但未能确认照片点赞名单已同步。照片与上线记录已保留，请稍后重试。');
  }
  async function execute() {
    let result;
    try {
      await cleanPublicationBuilds(directory);
      await update({ step: 0, message: '正在核对 GitHub、登录状态与最新内容…' });
      await beforePublish?.();
      if (incremental) await npm('media:deploy', ['--', '--auth-check']);
      await gh('auth', 'status', '--hostname', 'github.com');
      await git('fetch', 'origin', 'main');
      if (await externalMedia()) await mediaGit('fetch', 'origin', 'main');
      const prepared = await plan(true);
      if (prepared.media) {
        const variable = JSON.parse(await gh('api', `repos/${REPOSITORY}/actions/variables/MEDIA_BASE_URL`));
        if (variable.value !== prepared.media.baseURL) throw new UserError('网站的图片库地址尚未配置正确，请先同步 GitHub 的 MEDIA_BASE_URL 设置。');
      }
      await command(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'whoami', '--config', 'worker/wrangler.jsonc']);
      await update({ step: 1, message: '正在检查照片、模型与网站功能…' });
      if (!incremental) await npm('test');
      await npm('likes:check');
      await npm('build', ['--', '--outDir', path.join(directory, active.id, 'build')], { PAGES_BASE_PATH: '/nsfz-campus-gallery/', VITE_LIKES_API_URL: 'https://likes.drivinggodj.dpdns.org/api/likes', ...(prepared.media ? { VITE_MEDIA_BASE_URL: prepared.media.baseURL } : {}) });
      // Check again before staging, including edits made outside this window.
      const checked = await plan(true);
      if (checked.fingerprint !== prepared.fingerprint) throw new UserError('检查过程中内容库发生变化。请重新核对后上线。');
      await update({ step: 2, message: '正在保存上线记录并提交到 GitHub…' });
      if (prepared.media) {
        for (const file of prepared.media.files.filter(file => ASSET_PATTERN.test(file))) {
          const destination = path.join(mediaRoot, file);
          await fs.mkdir(path.dirname(destination), { recursive: true });
          const temporary = destination + '.' + crypto.randomUUID() + '.tmp';
          try {
            await fs.copyFile(path.join(sourceRoot, 'public', file), temporary);
            if (await fileHash(temporary) !== prepared.media.manifest.find(asset => asset.key === file).sha256) throw new UserError('照片在备份过程中发生变化，原有备份已保留，请重试。');
            await fs.rename(temporary, destination);
          } finally { await fs.rm(temporary, { force: true }); }
        }
        if (prepared.media.files.length) {
          await mediaGit('add', '--', ...prepared.media.files);
          await commitMedia(prepared.media.files);
        }
        // A previous failed push may have already committed the matching files.
        if (prepared.media.files.length || prepared.media.ahead) await mediaGit('push', 'origin', 'main');
        await update({ step: 2, message: '图片已备份，正在上传照片托管并检查公开图片…' });
        try { await npm('media:deploy', [], incremental ? { CAMPUS_MEDIA_SOURCE_ROOT: sourceRoot, CAMPUS_MEDIA_CHANGED: JSON.stringify(prepared.media.assets) } : {}); }
        catch (error) { throw new UserError('照片托管上传失败，尚未提交本次网站更新。照片与 GitHub 图片备份已保留，可以重试。\n' + publicationError(error.message)); }
        await verifyAssets(active.id, prepared);
        if ((await plan(true)).sourceFingerprint !== prepared.sourceFingerprint) throw new UserError('上传过程中内容库发生变化，尚未提交本次网站更新。请重新核对后上线。');
      }
      if (prepared.files.length) {
        await git('add', '--', ...prepared.files);
        await git('commit', '-m', 'Publish reviewed campus photos');
      }
      const commit = (await git('rev-parse', 'HEAD')).trim();
      const began = new Date();
      await update({ commit });
      if (prepared.files.length || prepared.ahead) await git('push', 'origin', 'main');
      else await gh('workflow', 'run', 'pages.yml', '--ref', 'main');
      await update({ step: 3, message: '已提交，等待 GitHub 检查并发布网站…' });
      let completed = false;
      for (let attempt = 0; attempt < maxPolls; attempt++) {
        const data = JSON.parse(await gh('api', `repos/${REPOSITORY}/actions/workflows/pages.yml/runs?head_sha=${commit}&per_page=10`));
        const current = data.workflow_runs.find(row => row.head_sha === commit && new Date(row.created_at).getTime() >= began.getTime() - 5000);
        if (current) {
          await update({ runURL: current.html_url });
          if (current.status === 'completed') {
            if (current.conclusion !== 'success') throw new UserError('GitHub 发布未成功，照片和提交记录已保留。可以查看发布记录，修正后重试。');
            completed = true; break;
          }
        }
        await wait(pollMs);
      }
      if (!completed) throw new UserError('GitHub 仍在发布。请查看发布记录；稍后可以重试，内容已保留。');
      await update({ step: 4, message: '正在确认网站已更新，并同步照片点赞名单…' });
      await verifyWebsite(commit, prepared);
      await update({ websiteVerified: true });
      try { await npm('likes:deploy:only'); }
      catch (error) { throw new UserError('网站已发布，但点赞服务同步失败。照片已保留，可以重试上线。\n' + publicationError(error.message)); }
      await verifyLikes();
      if (afterPublish) {
        await update({ step: 4, message: '网站已更新，正在同步工程和照片到 NAS…' });
        try { await afterPublish({ commit }); }
        catch (error) { throw new UserError('网站已上线，但 NAS 同步尚未完成。本地照片和修改已保留，请连接 NAS 后重试。\n' + publicationError(error.message)); }
      }
      result = { step: 5, status: 'completed', message: '上线完成。网站已更新，照片可以正常点赞。', finishedAt: new Date().toISOString() };
    } catch (error) {
      result = { status: 'failed', message: publicationError(error.message), finishedAt: new Date().toISOString() };
    } finally {
      await cleanPublicationBuilds(directory).catch(error => console.error('发布临时文件清理失败：' + publicationError(error.message)));
      await fs.rm(lockFile, { force: true });
      await update({ ...result, running: false });
    }
  }
  async function start() {
    // NAS mode accepts immediately; planning and checks run under the publish
    // lock without downloading the library onto this machine.
    if (!incremental) await plan(true, !!beforePublish);
    await acquire();
    active = { id: crypto.randomUUID(), running: true, status: 'running', step: 0, message: '正在准备上线…', startedAt: new Date().toISOString(), siteURL: PUBLIC_SITE };
    await update({});
    void execute();
    return snapshot();
  }
  return { status, start, publishing, snapshot };
}

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { isDeepStrictEqual } from 'node:util';
import { UserError, writeJSON } from './storage.mjs';

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
  if (/ENOSPC|no space left on device/i.test(String(message))) return '磁盘空间不足，未完成上线。照片与审核记录已保留，临时构建文件会自动清理；释放空间后可重试。';
  return redact(message);
}
function redact(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, '').replace(/\bgh[pousr]_[A-Za-z0-9_]+/g, '[已隐藏凭证]').replace(/(Bearer\s+)\S+/gi, '$1[已隐藏凭证]');
}
export function runCommand(command, args, { cwd, env = process.env, timeout = 180000, onOutput = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let output = '', expired = false;
    const read = chunk => { const text = redact(chunk.toString()); output = (output + text).slice(-250000); onOutput(text); };
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
export function createPublicationService(root, { run = runCommand, fetcher = fetch, wait = delay, pollMs = 6000, maxPolls = 150 } = {}) {
  const directory = path.join(root, '.local/publication'), lockFile = path.join(directory, 'lock.json');
  let active = null;
  const command = (tool, args, options = {}) => run(tool, args, { cwd: root, ...options });
  const git = (...args) => command('git', args);
  const gh = (...args) => command('gh', args);
  const npm = async (script, args = [], env = {}) => {
    const cli = process.env.CAMPUS_NPM_CLI || path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
    return command(process.execPath, [cli, 'run', script, ...args], { timeout: 600000, env: { ...process.env, ...env }, onOutput: text => { if (active) fs.appendFile(path.join(directory, active.id + '.log'), text).catch(() => {}); } });
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
      return saved;
    } catch { return { running: false, status: 'idle', message: '' }; }
  }
  async function plan() {
    const paths = changedPaths(await git('status', '--porcelain=v1', '-z', '--untracked-files=all'));
    const branch = (await git('branch', '--show-current')).trim();
    const remote = (await git('remote', 'get-url', 'origin')).trim();
    if (branch !== 'main' || !/^https:\/\/github\.com\/DrivingGodJ\/nsfz-campus-gallery(?:\.git)?\/?$/i.test(remote)) throw new UserError('请选择附中影像项目的 main 内容库；应用只向这个项目发布。');
    const other = paths.filter(file => !contentPath(file));
    if (other.length) throw new UserError('项目还有未完成的程序修改，暂时不能自动上线。照片已保留。需要先处理：' + other.slice(0, 5).join('、'));
    const [current, drafts, previousText, counts] = await Promise.all([
      fs.readFile(path.join(root, 'public/data/site.json'), 'utf8').then(JSON.parse),
      fs.readFile(path.join(root, '.local/drafts.json'), 'utf8').then(JSON.parse).catch(error => { if (error.code === 'ENOENT') return []; throw error; }),
      git('show', 'origin/main:public/data/site.json'),
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
    return { ...photoChanges(JSON.parse(previousText), current), files: paths, fingerprint: fingerprint.digest('hex'), saved: current.photos.length, drafts: drafts.length, ahead, siteURL: PUBLIC_SITE };
  }
  async function status() {
    const publication = await snapshot();
    try { return { publication, plan: await plan(), problem: '' }; }
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
  async function verifyWebsite(expected, changed) {
    const local = JSON.parse(await fs.readFile(path.join(root, 'public/data/site.json'), 'utf8'));
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await fetcher(PUBLIC_SITE + 'data/site.json?review=' + expected, { cache: 'no-store', signal: AbortSignal.timeout(25000) });
      // Static validation may reorder fields (for example aerial altitude).
      // Compare the entire library while ignoring JSON object key order.
      if (response.ok && isDeepStrictEqual(await response.json().catch(() => null), local)) {
        for (const file of changed.filter(file => file.startsWith('public/media/'))) {
          const asset = await fetcher(PUBLIC_SITE + file.slice(7) + '?review=' + expected, { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(25000) });
          if (!asset.ok) throw new UserError('网站已发布，但有照片文件尚未加载成功。请稍后重新上线。');
        }
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
      await gh('auth', 'status', '--hostname', 'github.com');
      await git('fetch', 'origin', 'main');
      const prepared = await plan();
      await command(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'whoami', '--config', 'worker/wrangler.jsonc']);
      await update({ step: 1, message: '正在检查照片、模型与网站功能…' });
      await npm('test');
      await npm('likes:check');
      await npm('build', ['--', '--outDir', path.join(directory, active.id, 'build')], { PAGES_BASE_PATH: '/nsfz-campus-gallery/', VITE_LIKES_API_URL: 'https://likes.drivinggodj.dpdns.org/api/likes' });
      // Check again before staging, including edits made outside this window.
      const checked = await plan();
      if (checked.fingerprint !== prepared.fingerprint) throw new UserError('检查过程中内容库发生变化。请重新核对后上线。');
      await update({ step: 2, message: '正在保存上线记录并提交到 GitHub…' });
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
      await verifyWebsite(commit, prepared.files);
      await update({ websiteVerified: true });
      try { await npm('likes:deploy:only'); }
      catch (error) { throw new UserError('网站已发布，但点赞服务同步失败。照片已保留，可以重试上线。\n' + publicationError(error.message)); }
      await verifyLikes();
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
    await plan();
    await acquire();
    active = { id: crypto.randomUUID(), running: true, status: 'running', step: 0, message: '正在准备上线…', startedAt: new Date().toISOString(), siteURL: PUBLIC_SITE };
    await update({});
    void execute();
    return snapshot();
  }
  return { status, start, publishing, snapshot };
}

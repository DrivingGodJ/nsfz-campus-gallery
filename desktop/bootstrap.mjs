import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || '');
let server, starting, shutdown, stopping = false;
function stop(exitCode = 0) {
  if (shutdown) return shutdown;
  stopping = true;
  shutdown = (async () => {
    // A quit during startup must close the server as soon as creation finishes.
    try { await starting; } catch { /* reported by startup below */ }
    try { await server?.close(); }
    catch (error) { console.error(error); exitCode = 1; }
    process.exit(exitCode);
  })();
  return shutdown;
}
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
if (process.env.CAMPUS_DESKTOP_APP === '1') {
  // The parent keeps the write end open. EOF means the application has ended,
  // including a crash or Force Quit; closing just its window keeps this intact.
  process.stdin.once('end', () => stop());
  process.stdin.resume();
}
starting = (async () => {
  const port = Number(process.env.CAMPUS_REVIEW_PORT ?? 5188);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('审核器端口无效。');
  const template = process.env.CAMPUS_PROJECT_TEMPLATE;
  if (template) {
    const git = (args, cwd = root) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const remote = git(['remote', 'get-url', 'origin'], template);
    if (remote !== 'https://github.com/DrivingGodJ/nsfz-campus-gallery.git') throw new Error('应用内工程来源不正确。');
    if (!await fs.access(path.join(root, '.git')).then(() => true).catch(() => false)) {
      await fs.mkdir(path.dirname(root), { recursive: true });
      // The application carries code and metadata; photos are downloaded separately.
      git(['clone', '--no-hardlinks', '--branch', 'main', template, root], path.dirname(root));
      git(['remote', 'set-url', 'origin', remote]);
    }
    const exclude = path.join(root, '.git/info/exclude');
    const ignored = await fs.readFile(exclude, 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; return ''; });
    if (!ignored.split('\n').includes('/node_modules')) await fs.appendFile(exclude, '\n/node_modules\n');
    {
      const installed = git(['rev-parse', 'HEAD'], template);
      if (git(['rev-parse', 'HEAD']) !== installed && !git(['status', '--porcelain'])) {
        git(['fetch', '--no-tags', template, 'main']);
        try { git(['merge', '--ff-only', 'FETCH_HEAD']); }
        catch { console.log('工作区有独立修改，已保留当前内容库。'); }
      }
    }
    const modules = path.join(root, 'node_modules'), bundledModules = path.join(template, 'node_modules');
    const current = await fs.lstat(modules).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (current?.isSymbolicLink()) await fs.unlink(modules);
    if (!current || current.isSymbolicLink()) await fs.symlink(bundledModules, modules, 'dir');
    for (const name of ['photo-ids.json', 'submission-campus.json']) {
      await fs.copyFile(path.join(template, 'worker/src', name), path.join(root, 'worker/src', name));
    }
    const components = process.env.CAMPUS_DEPTH_COMPONENTS;
    if (components) {
      await fs.mkdir(path.join(root, '.local'), { recursive: true });
      for (const name of ['depth-tools', 'models']) {
        const bundled = path.join(components, name);
        if (!await fs.access(bundled).then(() => true).catch(() => false)) continue;
        const target = path.join(root, '.local', name), current = await fs.lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
        if (current?.isSymbolicLink()) await fs.unlink(target);
        if (!current || current.isSymbolicLink()) await fs.symlink(bundled, target, 'dir');
      }
    }
  }
  await fs.access(path.join(root, 'server/local-editor.mjs'));
  process.chdir(root);
  process.env.MINIFLARE_CACHE_DIR = path.join(root, '.local/miniflare-cache');
  const { createServer } = await import(pathToFileURL(path.join(root, 'node_modules/vite/dist/node/index.js')).href);
  server = await createServer({ root, cacheDir: path.join(root, '.local/vite'), configFile: path.join(root, 'vite.config.ts'), configLoader: 'runner', server: { host: '127.0.0.1', port, strictPort: true }, clearScreen: false });
  if (stopping) return;
  await server.listen();
  if (stopping) return;
  const address = server.httpServer.address();
  console.log('REVIEW_APP_READY ' + JSON.stringify({ url: `http://127.0.0.1:${address.port}/editor.html?desktop=1` }));
})();
try { await starting; }
catch (error) { console.error(error); await stop(1); }

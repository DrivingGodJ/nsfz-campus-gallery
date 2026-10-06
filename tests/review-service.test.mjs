import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const bootstrap = path.join(root, 'desktop/bootstrap.mjs');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function exitWithin(service) {
  let timer;
  try {
    return await Promise.race([service.exited, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Service did not exit: ' + service.output())), 10000);
    })]);
  } finally { clearTimeout(timer); }
}

async function library(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-review-lifecycle-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'public/data'), { recursive: true });
  await fs.copyFile(path.join(root, 'public/data/campus.json'), path.join(directory, 'public/data/campus.json'));
  return directory;
}

function launch(t, args, environment = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root, env: { ...process.env, CAMPUS_DESKTOP_APP: '1', CAMPUS_REVIEW_PORT: '0', ...environment },
    stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32'
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    child.stdin.end();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    await Promise.race([exited, delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (process.platform !== 'win32') {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already closed */ }
    }
  });
  return { child, exited, output: () => output };
}

async function until(check, output = () => '', timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(50);
  }
  assert.fail('Lifecycle did not finish: ' + output());
}

function ready(service) {
  return until(() => {
    const line = service.output().split('\n').find(value => value.startsWith('REVIEW_APP_READY '));
    if (line) return JSON.parse(line.slice(17)).url;
    assert.equal(service.child.exitCode, null, service.output());
  }, service.output);
}

async function portReleased(url) {
  const { hostname, port } = new URL(url);
  await until(() => new Promise(resolve => {
    const socket = net.connect({ host: hostname, port: Number(port) });
    socket.once('connect', () => { socket.destroy(); resolve(false); });
    socket.once('error', error => { socket.destroy(); resolve(error.code === 'ECONNREFUSED'); });
  }));
}

test('review service closes its port and real database worker on application quit', { timeout: 40000 }, async t => {
  const directory = await library(t);
  const service = launch(t, [bootstrap, root], { CAMPUS_CONTENT_ROOT: directory });
  const url = await ready(service);
  assert.equal((await fetch(url)).status, 200);
  const response = await fetch(new URL('/api/likes/read', url), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ photoIds: [] })
  });
  assert.equal(response.status, 200, service.output());
  assert.deepEqual(await response.json(), { likes: {} });
  const workers = process.platform === 'win32' ? [] : execFileSync('ps', ['-axo', 'pid,pgid,comm'], { encoding: 'utf8' })
    .split('\n').map(line => line.trim().split(/\s+/))
    .filter(row => Number(row[1]) === service.child.pid && row[2]?.includes('workerd')).map(row => Number(row[0]));
  if (process.platform !== 'win32') assert.ok(workers.length, 'must exercise shutdown with a database worker running');
  service.child.stdin.end();
  assert.deepEqual(await exitWithin(service), { code: 0, signal: null });
  await portReleased(url);
  for (const pid of workers) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});

test('review service also stops when the application lifetime pipe closes', { timeout: 30000 }, async t => {
  const service = launch(t, [bootstrap, root], { CAMPUS_CONTENT_ROOT: await library(t) });
  const url = await ready(service);
  service.child.stdin.end();
  assert.deepEqual(await exitWithin(service), { code: 0, signal: null });
  await portReleased(url);
});

test('quitting during service creation leaves no listener and never opens the editor', { timeout: 30000 }, async t => {
  const directory = await library(t);
  const fixture = path.join(directory, 'startup');
  await fs.mkdir(path.join(fixture, 'server'), { recursive: true });
  await fs.mkdir(path.join(fixture, 'node_modules/vite/dist/node'), { recursive: true });
  await fs.writeFile(path.join(fixture, 'server/local-editor.mjs'), '');
  // Deliberately slow creation exercises the real bootstrap's early-quit path.
  await fs.writeFile(path.join(fixture, 'node_modules/vite/package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(fixture, 'node_modules/vite/dist/node/index.js'), `
    import fs from 'node:fs/promises';
    export async function createServer() {
      console.log('CREATING_SERVICE');
      await new Promise(resolve => setTimeout(resolve, 250));
      return {
        listen() { throw new Error('must not start listening after application exit'); },
        close() { return fs.writeFile(${JSON.stringify(path.join(directory, 'closed'))}, 'closed'); }
      };
    }
  `);
  const service = launch(t, [bootstrap, fixture]);
  await until(() => service.output().includes('CREATING_SERVICE'), service.output);
  service.child.kill('SIGTERM');
  service.child.stdin.end(); // Repeated shutdown requests must remain harmless.
  assert.deepEqual(await service.exited, { code: 0, signal: null });
  assert.equal(await fs.readFile(path.join(directory, 'closed'), 'utf8'), 'closed');
  assert.ok(!service.output().includes('REVIEW_APP_READY'));
});

test('Mac window close preserves the editor and service; reopen reuses them; application quit cleans up', {
  // The app's publish checks must not open a second native window over the
  // user's ongoing review session. Standalone Mac test runs exercise it.
  skip: process.platform !== 'darwin' || process.env.CAMPUS_DESKTOP_APP === '1', timeout: 60000
}, async t => {
  const directory = await library(t), resources = path.join(directory, 'Resources');
  await fs.mkdir(path.join(resources, 'runtime/bin'), { recursive: true });
  await fs.symlink(process.execPath, path.join(resources, 'runtime/bin/node'));
  await fs.copyFile(bootstrap, path.join(resources, 'bootstrap.mjs'));
  await fs.writeFile(path.join(resources, 'project.json'), JSON.stringify({ root }));
  const binary = path.join(directory, 'ReviewAppLifecycle');
  execFileSync('/usr/bin/swiftc', ['-parse-as-library', '-D', 'REVIEW_APP_TESTING',
    '-framework', 'AppKit', '-framework', 'WebKit', '-framework', 'UniformTypeIdentifiers',
    path.join(root, 'desktop/ReviewApp.swift'), path.join(root, 'tests/helpers/ReviewAppLifecycle.swift'), '-o', binary]);
  // Select an available port so tests do not interrupt an open review application.
  const reservation = net.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(binary, [resources, String(port)], {
    env: { ...process.env, CAMPUS_CONTENT_ROOT: directory }, stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const result = await exited;
  assert.deepEqual(result, { code: 0, signal: null }, output);
  assert.match(output, /WINDOW_CLOSED_SERVICE_ALIVE/);
  assert.match(output, /REOPENED_SAME_EDITOR_AND_SERVICE/);
  const pid = Number(/SERVICE_PID (\d+)/.exec(output)?.[1]);
  assert.ok(pid, output);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
  assert.throws(() => process.kill(-pid, 0), { code: 'ESRCH' });
  await portReleased(`http://127.0.0.1:${port}`);
});

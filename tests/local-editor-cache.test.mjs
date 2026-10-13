import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { localEditorPlugin } from '../server/local-editor.mjs';

const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'campus-editor-cache-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
  await fs.mkdir(path.join(root, '.local'), { recursive: true });
  await fs.writeFile(path.join(root, 'public/data/site.json'), '{"revision":0,"photos":[],"buildingOverrides":{}}');
  await fs.writeFile(path.join(root, 'public/data/campus.json'), '{}');
  const config = path.join(root, '.local/nas-archive.json');
  await fs.writeFile(config, JSON.stringify({ archiveRoot: path.join(root, 'not-a-mounted-NAS') }));
  const previous = { content: process.env.CAMPUS_CONTENT_ROOT, nas: process.env.CAMPUS_NAS_CONFIG };
  delete process.env.CAMPUS_CONTENT_ROOT; process.env.CAMPUS_NAS_CONFIG = config;
  t.after(() => {
    for (const [key, value] of [['CAMPUS_CONTENT_ROOT', previous.content], ['CAMPUS_NAS_CONFIG', previous.nas]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  let middleware;
  const server = http.createServer((req, res) => { void middleware(req, res, () => { res.statusCode = 404; res.end('not found'); }); });
  const plugin = localEditorPlugin();
  plugin.configureServer({ config: { root, logger: { error() {} } }, httpServer: server, middlewares: { use(fn) { middleware = fn; } } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const html = plugin.transformIndexHtml('<html><head></head></html>', { path: '/index.html' });
  const token = /content="([a-f0-9]+)"/.exec(html)[1];
  function request(route, { method = 'GET', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port: address.port, path: route, method, headers }, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject); req.end(body);
    });
  }
  return { root, server, port: address.port, plugin, token, request };
}

test('local editor and preview receive a session token; cache status is local and CSRF protected', async t => {
  const { plugin, token, request } = await fixture(t);
  for (const page of ['/', '/index.html', '/editor.html']) assert.ok(plugin.transformIndexHtml('<head>', { path: page }).includes(token));
  assert.equal(plugin.transformIndexHtml('<head>', { path: '/submit.html' }), '<head>');
  const state = await request('/__local/cache/status');
  assert.equal(state.status, 200); assert.equal(state.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(state.body), { configured: true, connected: false, cached: false, busy: false, operation: '', message: 'NAS 未连接。' });
  assert.equal((await request('/__local/cache/status', { headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await request('/__local/cache/download', { method: 'POST' })).status, 403);
  assert.equal((await request('/__local/cache/photos', { method: 'DELETE', headers: { 'x-local-editor-token': token, Origin: 'https://other.example' } })).status, 403);
  assert.equal((await request('/__local/cache/download', { method: 'POST', headers: { 'x-local-editor-token': token } })).status, 409);
});

test('missing public previews stream through localhost; private sources and foreign requests never reach hosting', async t => {
  const { request } = await fixture(t);
  const requested = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => { requested.push([url, options.method]); return new Response('image bytes', { headers: { 'content-type': 'image/webp', 'content-length': '11' } }); });
  const result = await request('/media/' + id + '/thumbnail.webp?v=test');
  assert.equal(result.status, 200); assert.equal(result.body, 'image bytes');
  assert.equal(result.headers['content-type'], 'image/webp'); assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(requested, [['https://photos.drivinggodj.dpdns.org/media/' + id + '/thumbnail.webp?v=test', 'GET']]);
  assert.equal((await request('/media/' + id + '/source.jpeg')).status, 404);
  assert.equal((await request('/__local/draft-media/' + id + '/source.jpeg')).status, 404);
  assert.equal((await request('/media/' + id + '/thumbnail.webp', { headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal(requested.length, 1);
});

test('a write still receiving its upload body prevents preview-window cleanup and publication', async t => {
  const { port, token, request } = await fixture(t);
  const writeDone = new Promise((resolve, reject) => {
    const writing = http.request({ hostname: '127.0.0.1', port, path: '/__local/photo/' + id, method: 'PUT', headers: { 'x-local-editor-token': token, 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.on('end', resolve);
    });
    writing.on('error', reject); writing.write('{"photo":');
    (async () => {
      try {
        let response;
        for (let i = 0; i < 30; i++) {
          response = await request('/__local/cache/photos', { method: 'DELETE', headers: { 'x-local-editor-token': token } });
          if (response.status === 423) break;
          await new Promise(done => setTimeout(done, 5));
        }
        assert.equal(response.status, 423);
        assert.match(JSON.parse(response.body).error, /正在保存或生成/);
        const publishing = await request('/__local/release/start', { method: 'POST', headers: { 'x-local-editor-token': token } });
        assert.equal(publishing.status, 423); assert.match(JSON.parse(publishing.body).error, /正在处理本地照片/);
        writing.end('{}}');
      } catch (error) { writing.destroy(); reject(error); }
    })();
  });
  await writeDone;
  assert.equal((await request('/__local/cache/photos', { method: 'DELETE', headers: { 'x-local-editor-token': token } })).status, 409, 'the completed write releases its busy count');
});

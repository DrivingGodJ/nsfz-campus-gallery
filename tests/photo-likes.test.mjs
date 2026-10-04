import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { getPlatformProxy } from 'wrangler';
import { handleLikes } from '../worker/src/likes.mjs';
import { persistentVisitor, createLikesClient, VISITOR_KEY } from '../src/likes-api.ts';
import { sortPhotos } from '../src/photo-sort.ts';

const origin = 'https://campus.example';
async function fixture() {
  const proxy = await getPlatformProxy({ configPath: new URL('../worker/wrangler.jsonc', import.meta.url).pathname, persist: false, remoteBindings: false });
  await proxy.env.DB.prepare(await fs.readFile(new URL('../worker/migrations/0001_likes.sql', import.meta.url), 'utf8')).run();
  const ids = [crypto.randomUUID(), crypto.randomUUID()], visitorId = crypto.randomUUID();
  const env = { ...proxy.env, ALLOWED_ORIGINS: origin };
  const request = (path, body, method = path === 'read' ? 'POST' : 'PUT', headers = {}) =>
    new Request('https://likes.example/api/likes/' + path, { method,
      headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
      ...(!['GET', 'OPTIONS'].includes(method) ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
  const call = async (path, body, method, headers) => handleLikes(request(path, body, method, headers), env, new Set(ids));
  return { proxy, env, ids, visitorId, request, call };
}

test('D1 enforces one like per browser/photo under concurrent retries and unlike is idempotent', async () => {
  const f = await fixture();
  try {
    const repeated = await Promise.all(Array.from({ length: 20 }, () => f.call(f.ids[0], { visitorId: f.visitorId, liked: true })));
    assert.ok(repeated.every(response => response.status === 200));
    assert.ok((await Promise.all(repeated.map(response => response.json()))).every(value => value.count === 1 && value.liked));
    await Promise.all(Array.from({ length: 15 }, () => f.call(f.ids[0], { visitorId: crypto.randomUUID(), liked: true })));
    let read = await (await f.call('read', { visitorId: f.visitorId, photoIds: f.ids })).json();
    assert.deepEqual(read.likes[f.ids[0]], { count: 16, liked: true });
    assert.deepEqual(read.likes[f.ids[1]], { count: 0, liked: false });
    for (let i = 0; i < 2; i++) assert.deepEqual(await (await f.call(f.ids[0], { visitorId: f.visitorId, liked: false })).json(), { photoId: f.ids[0], count: 15, liked: false });
    read = await (await f.call('read', { photoIds: f.ids })).json();
    assert.deepEqual(read.likes[f.ids[0]], { count: 15, liked: false }, 'Counts can be read without a persistent visitor ID');
  } finally { await f.proxy.dispose(); }
});

test('like API rejects untrusted origins, invalid bodies, unknown photos and rate-limited writes', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.call('read', { photoIds: f.ids }, undefined, { Origin: 'https://another.example' })).status, 403);
    assert.equal((await f.call('read', { photoIds: f.ids }, 'OPTIONS', { 'Access-Control-Request-Method': 'POST' })).status, 204);
    assert.equal((await f.call('read', { photoIds: f.ids }, 'GET')).status, 405);
    assert.equal((await f.call('read', '{broken')).status, 400);
    assert.equal((await f.call('read', { photoIds: f.ids }, undefined, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await f.call('read', { photoIds: Array.from({ length: 51 }, () => f.ids[0]) })).status, 400);
    assert.equal((await f.call('read', { photoIds: [crypto.randomUUID()] })).status, 400);
    assert.equal((await f.call(crypto.randomUUID(), { visitorId: f.visitorId, liked: true })).status, 404);
    assert.equal((await f.call(f.ids[0], { visitorId: "' OR 1=1 --", liked: true })).status, 400);
    assert.equal((await f.call(f.ids[0], { visitorId: f.visitorId, liked: 1 })).status, 400);
    assert.equal((await f.call(f.ids[0], { visitorId: f.visitorId, liked: true, junk: 'x'.repeat(9000) })).status, 413);
    const limited = await handleLikes(f.request(f.ids[0], { visitorId: f.visitorId, liked: true }),
      { ...f.env, LIKES_LIMITER: { limit: async () => ({ success: false }) } }, new Set(f.ids));
    assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
    const read = await f.call('read', { visitorId: f.visitorId, photoIds: f.ids });
    assert.equal(read.headers.get('Access-Control-Allow-Origin'), origin);
    assert.equal(read.headers.get('Cache-Control'), 'no-store');
    assert.equal(Object.values((await read.json()).likes).reduce((total, value) => total + value.count, 0), 0);
    const fail = await handleLikes(f.request('read', { photoIds: f.ids }), { ...f.env, DB: { prepare: () => { throw new Error('private DB error'); } } }, new Set(f.ids));
    assert.equal(fail.status, 503); assert.equal((await fail.text()).includes('private DB error'), false);
  } finally { await f.proxy.dispose(); }
});

test('browser identity persists across refreshes and storage failure cannot silently invent another identity', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const id = persistentVisitor(storage, crypto.randomUUID);
  assert.equal(persistentVisitor(storage, () => { throw new Error('should reuse'); }), id);
  values.set(VISITOR_KEY, 'damaged'); assert.notEqual(persistentVisitor(storage, crypto.randomUUID), id);
  assert.equal(persistentVisitor({ getItem: () => null, setItem: () => { throw new Error('blocked'); } }, crypto.randomUUID), '');
});

test('client batches large libraries, reports failures, and validates mutation responses', async () => {
  const ids = Array.from({ length: 121 }, () => crypto.randomUUID()), visitor = crypto.randomUUID(), requests = [];
  const transport = async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, ...options, body });
    if (url.endsWith('/read')) return Response.json({ likes: Object.fromEntries(body.photoIds.map(id => [id, { count: 7, liked: false }])) });
    return Response.json({ photoId: ids[0], count: 8, liked: true });
  };
  const client = createLikesClient('https://likes.example/api/likes/', visitor, transport);
  assert.equal(Object.keys(await client.read(ids)).length, 121);
  assert.deepEqual(requests.map(r => r.body.photoIds.length), [50, 50, 21]);
  assert.ok(requests.every(r => r.credentials === 'omit' && r.cache === 'no-store' && r.body.visitorId === visitor));
  assert.deepEqual(await client.set(ids[0], true), { count: 8, liked: true });
  assert.deepEqual(requests.at(-1).body, { visitorId: visitor, liked: true });
  await assert.rejects(createLikesClient('/api/likes', '', transport).set(ids[0], true), /无法保存/);
  await assert.rejects(createLikesClient('/api/likes', visitor, async () => Response.json({ error: '操作太频繁' }, { status: 429 })).set(ids[0], true), /操作太频繁/);
  await assert.rejects(createLikesClient('/api/likes', visitor, async () => Response.json({ likes: {} })).read([ids[0]]), /不完整/);
  await assert.rejects(createLikesClient('/api/likes', visitor, async () => Response.json({ photoId: ids[1], count: -1, liked: true })).set(ids[0], true), /未确认/);
});

test('three catalog sorts preserve original data, filters, stable ties and missing capture dates', () => {
  const photos = [
    { id: 'a', capturedAt: '2025-01-01T12:00' },
    { id: 'b', capturedAt: '2025-01-01T12:00' },
    { id: 'c', capturedAt: '' },
    { id: 'd', capturedAt: '2024-10-01', uploadedAt: '2026-10-04T10:00:00.000Z' }
  ];
  const before = JSON.stringify(photos), order = type => sortPhotos(photos, type, photos, { a: { count: 4 }, b: { count: 4 }, d: { count: 1 } }).map(p => p.id);
  assert.deepEqual(order('uploaded'), ['d', 'c', 'b', 'a']);
  assert.deepEqual(order('captured'), ['b', 'a', 'd', 'c']);
  assert.deepEqual(order('likes'), ['b', 'a', 'd', 'c']);
  assert.deepEqual(sortPhotos([photos[0], photos[2]], 'uploaded', photos).map(p => p.id), ['c', 'a']);
  assert.equal(JSON.stringify(photos), before);
});

test('unreachable likes are explained; external aborts and server quota errors retain their meaning', async () => {
  const id = crypto.randomUUID(), visitor = crypto.randomUUID();
  await assert.rejects(createLikesClient('/api/likes', visitor, async () => { throw new TypeError('Failed to fetch'); }).read([id]), /当前网络无法连接点赞服务/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(createLikesClient('/api/likes', visitor, async (url, options) => {
    assert.equal(options.signal.aborted, true); throw new DOMException('Aborted', 'AbortError');
  }).read([id], controller.signal), error => error.name === 'AbortError');
  await assert.rejects(createLikesClient('/api/likes', visitor, async () => Response.json({ error: '点赞服务已达到今日限额' }, { status: 503 })).read([id]), /今日限额/);
});

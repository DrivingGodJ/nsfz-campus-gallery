import { serviceFailure } from './service-errors.mjs';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const READ_BATCH_SIZE = 50;

class RequestError extends Error {
  /** @param {string} message @param {number} status */
  constructor(message, status = 400) { super(message); this.status = status; }
}

/** @param {Request} request */
async function bodyJSON(request) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') throw new RequestError('请使用 JSON 请求。', 415);
  if (Number(request.headers.get('Content-Length')) > 8192) throw new RequestError('请求过大。', 413);
  if (!request.body) throw new RequestError('缺少请求内容。');
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) { await reader.cancel(); throw new RequestError('请求过大。', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const data = JSON.parse(new TextDecoder().decode(bytes));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return /** @type {{ visitorId?: unknown, photoIds?: unknown, liked?: unknown }} */ (data);
  } catch { throw new RequestError('请求内容格式不正确。'); }
}

/** @param {unknown} value @param {boolean} required */
function visitorID(value, required) {
  if (!required && value === undefined) return '';
  if (typeof value !== 'string' || !UUID.test(value)) throw new RequestError('浏览器标识无效。');
  return value;
}

/** @param {Request} request @param {Env} env @param {Set<string>} publishedPhotos */
export async function handleLikes(request, env, publishedPhotos) {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean);
  // No wildcard and no implicit access when production has not been configured.
  if (!origin || !allowed.includes(origin)) return Response.json({ error: '网站来源未获允许。' }, { status: 403 });
  const headers = {
    'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'
  };
  /** @param {unknown} data @param {number} [status] */
  const json = (data, status = 200) => Response.json(data, { status, headers });
  const path = new URL(request.url).pathname;
  const read = path === '/api/likes/read';
  const match = /^\/api\/likes\/([a-f0-9-]{36})$/.exec(path);
  if (!read && !match) return json({ error: '接口不存在。' }, 404);
  const method = read ? 'POST' : 'PUT';
  if (request.method === 'OPTIONS') {
    if (request.headers.get('Access-Control-Request-Method') !== method) return json({ error: '请求方式不支持。' }, 405);
    return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': method,
      'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' } });
  }
  if (request.method !== method) return json({ error: '请求方式不支持。' }, 405);
  try {
    const data = await bodyJSON(request), visitor = visitorID(data.visitorId, !read);
    if (read) {
      const ids = data.photoIds;
      if (!Array.isArray(ids) || ids.length > READ_BATCH_SIZE || ids.some(id => typeof id !== 'string' || !UUID.test(id))) throw new RequestError('照片列表无效，请刷新页面。');
      const unique = /** @type {string[]} */ ([...new Set(ids)]);
      const known = unique.filter(id => publishedPhotos.has(id));
      // Pages and this Worker deploy separately. An unsynced photo must not
      // prevent the rest of the library from loading, or expose private totals.
      /** @type {Record<string, { count: number, liked: boolean, available?: boolean }>} */
      const likes = Object.fromEntries(unique.map(id => [id, publishedPhotos.has(id)
        ? { count: 0, liked: false } : { count: 0, liked: false, available: false }]));
      if (known.length) {
        const result = await env.DB.prepare(`SELECT photo_id, COUNT(*) AS count, MAX(visitor_id = ?) AS liked
          FROM photo_likes WHERE photo_id IN (${known.map(() => '?').join(',')}) GROUP BY photo_id`).bind(visitor, ...known).all();
        for (const row of result.results) likes[String(row.photo_id)] = { count: Number(row.count), liked: !!row.liked };
      }
      return json({ likes });
    }
    const id = match?.[1];
    if (!id || !UUID.test(id) || !publishedPhotos.has(id)) throw new RequestError('照片不存在。', 404);
    if (typeof data.liked !== 'boolean') throw new RequestError('点赞状态无效。');
    if (!(await env.LIKES_LIMITER.limit({ key: visitor })).success) {
      return new Response(JSON.stringify({ error: '操作太频繁，请稍后再试。' }), { status: 429,
        headers: { ...headers, 'Content-Type': 'application/json', 'Retry-After': '60' } });
    }
    // Desired-state writes and the returned totals are one D1 transaction. Retries cannot add a second like.
    const result = await env.DB.batch([
      env.DB.prepare(data.liked ? 'INSERT OR IGNORE INTO photo_likes (photo_id, visitor_id) VALUES (?, ?)' :
        'DELETE FROM photo_likes WHERE photo_id = ? AND visitor_id = ?').bind(id, visitor),
      env.DB.prepare('SELECT COUNT(*) AS count, COALESCE(MAX(visitor_id = ?), 0) AS liked FROM photo_likes WHERE photo_id = ?').bind(visitor, id)
    ]);
    const row = /** @type {{ count: number, liked: number }} */ (result[1].results[0]);
    return json({ photoId: id, count: Number(row.count), liked: !!row.liked });
  } catch (error) {
    if (error instanceof RequestError) return json({ error: error.message }, error.status);
    // Do not log identifiers, user input or database messages.
    console.error(JSON.stringify({ event: 'likes_request_failed', method: request.method }));
    const failure = serviceFailure(error);
    return json({ ...failure, error: failure.error.replaceAll('投稿', '点赞').replaceAll('当前标注已保留。', '') }, 503);
  }
}

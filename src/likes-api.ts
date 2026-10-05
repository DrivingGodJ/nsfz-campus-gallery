import { readServiceResponse } from '../server/service-response.mjs';
import type { PhotoLike, PhotoLikes } from './photo-sort';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const VISITOR_KEY = 'nsfz:likes:visitor';

export function persistentVisitor(storage: Pick<Storage, 'getItem' | 'setItem'>, randomUUID: () => string) {
  try {
    const existing = storage.getItem(VISITOR_KEY);
    if (existing && UUID.test(existing)) return existing;
    const id = randomUUID();
    if (!UUID.test(id)) return '';
    storage.setItem(VISITOR_KEY, id);
    return storage.getItem(VISITOR_KEY) === id ? id : '';
  } catch { return ''; }
}

function isLike(value: unknown): value is PhotoLike {
  if (!value || typeof value !== 'object') return false;
  const item = value as PhotoLike;
  return Number.isSafeInteger(item.count) && item.count >= 0 && typeof item.liked === 'boolean'
    && (item.available === undefined || typeof item.available === 'boolean');
}

export function createLikesClient(baseURL: string, visitorId: string, transport: typeof fetch = fetch) {
  const endpoint = baseURL.replace(/\/+$/, '');
  async function request(path: string, method: string, body: unknown, signal?: AbortSignal) {
    // Use a controller rather than AbortSignal.any, which older Safari versions lack.
    const controller = new AbortController();
    const abort = () => controller.abort(signal?.reason);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      let response;
      try {
        response = await transport(endpoint + path, { method, headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body), cache: 'no-store', credentials: 'omit', signal: controller.signal });
      } catch (reason) {
        if (signal?.aborted) throw reason;
        throw new Error('当前网络无法连接点赞服务，点赞结果尚未确认。请检查网络后重试。');
      }
      return await readServiceResponse(response);
    } finally { clearTimeout(timeout); signal?.removeEventListener('abort', abort); }
  }
  return {
    async read(photoIds: string[], signal?: AbortSignal): Promise<PhotoLikes> {
      const result: PhotoLikes = {};
      const unique = [...new Set(photoIds)];
      // Stay below D1's bound parameter limit and avoid opening an unbounded number of requests.
      for (let index = 0; index < unique.length; index += 50) {
        const ids = unique.slice(index, index + 50);
        const data = await request('/read', 'POST', { photoIds: ids, ...(visitorId ? { visitorId } : {}) }, signal);
        for (const id of ids) {
          if (!isLike(data.likes?.[id])) throw new Error('点赞数据不完整，请重试。');
          result[id] = data.likes[id];
        }
      }
      return result;
    },
    async set(photoId: string, liked: boolean): Promise<PhotoLike> {
      if (!visitorId) throw new Error('浏览器无法保存点赞标识，请允许网站存储后重试。');
      const data = await request('/' + encodeURIComponent(photoId), 'PUT', { visitorId, liked });
      if (data.photoId !== photoId || !isLike(data)) throw new Error('未确认点赞结果，请刷新后查看。');
      return { count: data.count, liked: data.liked };
    }
  };
}

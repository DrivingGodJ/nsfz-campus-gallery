import test from 'node:test';
import assert from 'node:assert/strict';
import { PhotoImageCache } from '../src/photo-image-cache.ts';
import { backgroundPhotoLoadingAllowed, PhotoPreloadVisibility } from '../src/photo-preloading.ts';
import { photoDisplayFile, photoLoadFiles } from '../src/photo-image.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(t, limit = 8, bytes = 12_000_000) {
  const requests = [], disposed = [];
  const cache = new PhotoImageCache((url, signal, priority) => new Promise((resolve, reject) => {
    const request = { url, signal, priority, finish(size = 100) {
      resolve({ src: 'blob:' + url, bytes: size, dispose: () => disposed.push(url) });
    }, fail() { reject(new Error('offline')); } };
    signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true });
    requests.push(request);
  }), limit, bytes);
  t.after(() => cache.dispose());
  return { cache, requests, disposed };
}

test('popular/visible images preload serially, and selecting a photo immediately cancels other requests', async t => {
  const { cache, requests } = fixture(t);
  cache.setBackground(['popular1', 'popular2', 'popular3']);
  assert.deepEqual(requests.map(r => r.url), ['popular1']);
  requests[0].finish(); await flush();
  assert.deepEqual(requests.map(r => r.url), ['popular1', 'popular2']);
  cache.select(['selected-thumbnail', 'selected-depth', 'selected-display']);
  assert.equal(requests[1].signal.aborted, true);
  assert.deepEqual(requests.slice(2).map(r => [r.url, r.priority]), [['selected-thumbnail', 'high']]);
  const consumer = new AbortController(), display = cache.acquire('selected-display', consumer.signal);
  assert.equal(requests.length, 3, 'the preview cannot start the display before depth');
  requests[2].finish(); await flush();
  assert.equal(requests[3].url, 'selected-depth');
  requests[3].finish(); await flush();
  assert.equal(requests[4].url, 'selected-display');
  requests[4].finish(); await display; consumer.abort(); await flush();
  assert.equal(requests.length, 5, 'popular3 does not compete with the selected photo');
  assert.equal(cache.peek('popular1'), 'blob:popular1', 'finished preloads are retained');
});

test('popular and visible photos preload thumbnail, depth and display in that order without evicting each other', async t => {
  const { cache, requests } = fixture(t, 24);
  const urls = Array.from({ length: 6 }, (_, i) => photoLoadFiles({ files: {
    thumbnail: `${i}-thumbnail`, depth: `${i}-depth`, display: `${i}-display`, download: `${i}-original`,
  } })).flat();
  cache.setBackground(urls);
  for (let i = 0; i < urls.length; i++) {
    assert.equal(requests.length, i + 1);
    assert.equal(requests[i].url, urls[i]);
    requests[i].finish(); await flush();
  }
  cache.setBackground(urls); await flush();
  assert.equal(requests.length, urls.length, 'completed assets do not cycle through eviction and download');
  urls.forEach(url => assert.equal(cache.peek(url), 'blob:' + url));
  assert.deepEqual(photoLoadFiles({ files: { thumbnail: 'only-thumbnail', download: 'original' } }), ['only-thumbnail']);
});

test('switching photos cancels queued depth/display requests, and a failed prerequisite does not deadlock the next tier', async t => {
  const { cache, requests } = fixture(t);
  cache.select(['old-thumbnail', 'old-depth', 'old-display']);
  const consumer = new AbortController(), display = cache.acquire('old-display', consumer.signal);
  const rejected = assert.rejects(display, { name: 'AbortError' });
  cache.select(['new-thumbnail', 'new-depth', 'new-display']);
  await rejected; consumer.abort(); await flush();
  assert.deepEqual(requests.map(r => r.url), ['old-thumbnail', 'new-thumbnail']);
  requests[1].fail(); await flush();
  assert.equal(requests[2].url, 'new-depth');
  requests[2].finish(); await flush();
  assert.equal(requests[3].url, 'new-display');
  requests[3].finish(); await flush();
  assert.equal(cache.peek('new-display'), 'blob:new-display');
});

test('clicking an image already being prefetched keeps its download, and the card and overlay share it', async t => {
  const { cache, requests } = fixture(t);
  cache.setBackground(['same', 'other']);
  cache.select(['same']);
  const card = new AbortController(), overlay = new AbortController();
  const first = cache.acquire('same', card.signal), second = cache.acquire('same', overlay.signal);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].signal.aborted, false, 'do not throw away progress on the clicked photo');
  card.abort(); await assert.rejects(first, { name: 'AbortError' });
  requests[0].finish();
  assert.equal(await second, 'blob:same');
  assert.equal(requests.length, 1);
  overlay.abort(); cache.select([]);
  const next = new AbortController();
  assert.equal(await cache.acquire('same', next.signal), 'blob:same');
  assert.equal(requests.length, 1, 're-entering reuses the downloaded bytes even without an HTTP cache');
  next.abort();
});

test('rapidly switching photos aborts the previous foreground download and immediately starts the new one', async t => {
  const { cache, requests } = fixture(t);
  cache.select(['old']);
  const consumer = new AbortController();
  const old = cache.acquire('old', consumer.signal);
  const rejected = assert.rejects(old, { name: 'AbortError' });
  cache.select(['new']);
  await rejected;
  consumer.abort();
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(requests[1].url, 'new');
  requests[1].finish(); await flush();
  assert.equal(cache.peek('new'), 'blob:new');
});

test('unused visible preloads stop on leaving the view, and hidden or restricted connections pause background work', async t => {
  const { cache, requests } = fixture(t);
  cache.setBackground(['visible']);
  cache.setBackground([]);
  assert.equal(requests[0].signal.aborted, true);
  cache.setAllowed(false); cache.setBackground(['later']); await flush();
  assert.equal(requests.length, 1);
  cache.select(['clicked']);
  assert.equal(requests[1].url, 'clicked', 'a click still works when speculative loading is disabled');
  requests[1].finish(); await flush(); cache.select([]); cache.setAllowed(true);
  cache.setBackground(['later']);
  assert.equal(requests.at(-1).url, 'later');
});

test('the cache evicts by count and bytes while protecting images still in use', async t => {
  const { cache, requests, disposed } = fixture(t, 2, 250);
  const held = new AbortController();
  const first = cache.acquire('held', held.signal); requests[0].finish(); await first;
  cache.setBackground(['second', 'third']); requests[1].finish(); await flush(); requests[2].finish(); await flush();
  assert.equal(cache.peek('held'), 'blob:held');
  assert.ok(disposed.includes('second'));
  assert.equal(cache.peek('third'), 'blob:third');
  held.abort();
  cache.select(['big']); requests.at(-1).finish(220); await flush();
  assert.equal(cache.peek('big'), 'blob:big');
  assert.equal(cache.peek('held'), undefined);
  assert.equal(cache.peek('third'), undefined);
});

test('preload failures do not block the queue, and selecting a failed photo retries immediately', async t => {
  const { cache, requests } = fixture(t);
  cache.setBackground(['broken', 'next']); requests[0].fail(); await flush();
  assert.equal(requests[1].url, 'next');
  requests[1].finish(); await flush();
  cache.setBackground(['broken', 'next']);
  assert.equal(requests.length, 2, 'a failed speculative request is not retried every timer tick');
  cache.select(['broken']);
  assert.equal(requests[2].url, 'broken');
  requests[2].finish(); await flush();
});

test('visibility requires continuous dwell, combines map/catalog visibility, and only warms three candidates', () => {
  const visible = new PhotoPreloadVisibility();
  visible.update('map', ['a', 'b', 'c', 'd'], 0);
  assert.deepEqual(visible.candidates(['d', 'c', 'b', 'a'], 1199), []);
  assert.deepEqual(visible.candidates(['d', 'c', 'b', 'a'], 1200), ['d', 'c', 'b']);
  visible.update('catalog', ['a'], 900);
  visible.update('map', [], 1300);
  assert.deepEqual(visible.candidates(['a', 'b'], 1300), ['a']);
  visible.update('catalog', [], 1400); visible.update('map', ['a'], 1500);
  assert.deepEqual(visible.candidates(['a'], 2699), []);
  assert.deepEqual(visible.candidates(['a'], 2700), ['a']);
});

test('hidden, offline and save-data connections suppress speculation, and the secondary tier never falls back to originals', () => {
  const normal = { hidden: false, online: true };
  assert.equal(backgroundPhotoLoadingAllowed(normal), true);
  for (const override of [{ hidden: true }, { online: false }, { saveData: true }, { effectiveType: '2g' }, { effectiveType: 'slow-2g' }]) assert.equal(backgroundPhotoLoadingAllowed({ ...normal, ...override }), false);
  assert.equal(photoDisplayFile({ files: { display: 'display.webp', preview: 'preview.webp', thumbnail: 'thumbnail.webp', download: 'download.jpg' } }), 'display.webp?v=2');
  assert.equal(photoDisplayFile({ files: { thumbnail: 'thumbnail.webp', download: 'download.jpg' } }), 'thumbnail.webp');
  assert.equal(photoDisplayFile({ files: { thumbnail: 'thumbnail.webp', preview: 'preview.webp', download: 'download.jpg' } }), 'thumbnail.webp');
});

test('shared image downloads report actual byte progress and reach completion only after the body ends', async t => {
  let stream;
  const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }), {
    headers: { 'content-length': '100', 'content-type': 'image/webp' },
  });
  const fetch = t.mock.method(globalThis, 'fetch', async () => response);
  const cache = new PhotoImageCache(), card = new AbortController(), overlay = new AbortController();
  t.after(() => { card.abort(); overlay.abort(); cache.dispose(); });
  const first = cache.acquire('display.webp', card.signal), second = cache.acquire('display.webp', overlay.signal);
  assert.equal(cache.progress('display.webp'), 0);
  stream.enqueue(new Uint8Array(40)); await flush();
  assert.equal(cache.progress('display.webp'), .4);
  stream.enqueue(new Uint8Array(30)); await flush();
  assert.equal(cache.progress('display.webp'), .7);
  stream.enqueue(new Uint8Array(30)); await flush();
  assert.equal(cache.progress('display.webp'), .99, 'receiving the declared bytes alone does not finish the resource');
  stream.close();
  assert.equal(await first, await second);
  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(cache.progress('display.webp'), 1);
});

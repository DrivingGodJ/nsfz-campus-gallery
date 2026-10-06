import test from 'node:test';
import assert from 'node:assert/strict';
import { loadImageElement } from '../src/depth-map.ts';

function images(t) {
  const instances = [];
  class FakeImage {
    naturalWidth = 2400;
    onload = null;
    onerror = null;
    src = '';
    decode = async () => {};
    removeAttribute(name) { if (name === 'src') this.src = ''; }
    constructor() { instances.push(this); }
  }
  const previous = globalThis.Image;
  globalThis.Image = FakeImage;
  t.after(() => { if (previous) globalThis.Image = previous; else delete globalThis.Image; });
  return instances;
}

test('secondary HD can resolve while the low-priority original is still loading and decoding', async t => {
  const created = images(t), controller = new AbortController();
  const secondary = loadImageElement('display.webp', 'secondary failed', { signal: controller.signal, fetchPriority: 'high' });
  const original = loadImageElement('download.jpg', 'original failed', { signal: controller.signal, fetchPriority: 'low' });
  assert.equal(created[0].fetchPriority, 'high');
  assert.equal(created[1].fetchPriority, 'low');
  let releaseDecode, upgraded = false;
  created[1].decode = () => new Promise(resolve => { releaseDecode = resolve; });
  original.then(() => { upgraded = true; });
  void created[1].onload();
  await created[0].onload();
  assert.equal(await secondary, created[0]);
  assert.equal(upgraded, false, 'the original is not safe to swap in before decoding');
  releaseDecode();
  assert.equal(await original, created[1]);
  controller.abort();
  assert.equal(created[1].src, 'download.jpg', 'a successfully decoded image stays usable by the overlay');
});

test('cancelling a pending original aborts its request and rejects even during decode', async t => {
  const created = images(t), controller = new AbortController();
  const pending = loadImageElement('download.jpg', 'original failed', { signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  let releaseDecode;
  created[0].decode = () => new Promise(resolve => { releaseDecode = resolve; });
  const decoding = created[0].onload();
  controller.abort();
  await rejected;
  assert.equal(created[0].src, '');
  assert.equal(created[0].onload, null);
  releaseDecode();
  await decoding;
});

test('an already cancelled request never starts downloading', async t => {
  const created = images(t), controller = new AbortController();
  controller.abort();
  await assert.rejects(loadImageElement('download.jpg', undefined, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(created[0].src, '');
});

test('failed originals reject without affecting a usable secondary HD image', async t => {
  const created = images(t);
  const secondary = loadImageElement('display.webp');
  const original = loadImageElement('download.jpg', '原图暂时无法载入。');
  const rejected = assert.rejects(original, /原图暂时无法载入/);
  created[1].onerror();
  await rejected;
  await created[0].onload();
  assert.equal(await secondary, created[0]);
});

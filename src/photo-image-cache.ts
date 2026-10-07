import { loadImageElement } from './depth-map.ts';

type Resource = { src: string; bytes: number; dispose: () => void };
type Loader = (url: string, signal: AbortSignal, priority: 'high' | 'low', onProgress: (fraction: number) => void) => Promise<Resource>;
type Entry = { controller: AbortController; promise: Promise<string>; users: number; touched: number; progress: number; resource?: Resource };
const cancelled = () => new DOMException('Image loading cancelled', 'AbortError');

async function fetchImage(url: string, signal: AbortSignal, priority: 'high' | 'low', onProgress: (fraction: number) => void): Promise<Resource> {
  // Blob URLs let the card and transition reuse the same bytes even when an
  // image host disables its HTTP cache. Aborting fetch also stops its body.
  const response = await fetch(url, { signal, priority });
  if (!response.ok) throw new Error('照片暂时无法载入，请稍后重试。');
  const total = Number(response.headers.get('content-length'));
  let blob: Blob;
  if (response.body && total > 0) {
    const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(new Uint8Array(value)); received += value.byteLength;
      onProgress(Math.min(.99, received / total));
    }
    blob = new Blob(chunks, { type: response.headers.get('content-type') || '' });
  } else blob = await response.blob();
  if (signal.aborted) throw cancelled();
  const src = URL.createObjectURL(blob);
  return { src, bytes: blob.size, dispose: () => URL.revokeObjectURL(src) };
}

export class PhotoImageCache {
  private entries = new Map<string, Entry>();
  private focus = new Set<string>();
  private background: string[] = [];
  private allowed = true;
  private sequence = 0;
  private failed = new Map<string, number>();
  private loader: Loader;
  private limit: number;
  private byteLimit: number;
  constructor(loader: Loader = fetchImage, limit = 8, byteLimit = 12_000_000) { this.loader = loader; this.limit = limit; this.byteLimit = byteLimit; }

  peek(url: string) { return this.entries.get(url)?.resource?.src; }
  progress(url: string) { return this.entries.get(url)?.progress ?? 0; }

  select(urls: string[]) {
    this.focus = new Set(urls);
    if (urls.length) {
      this.background = [];
      for (const [url, entry] of this.entries) if (!entry.resource && !this.focus.has(url)) this.cancel(url, entry);
      for (const url of urls) this.start(url, 'high');
    } else {
      for (const [url, entry] of this.entries) if (!entry.resource && !entry.users) this.cancel(url, entry);
      this.pump();
    }
    this.trim();
  }

  setBackground(urls: string[]) {
    this.background = [...new Set(urls)];
    for (const [url, entry] of this.entries) {
      if (!entry.resource && !entry.users && !this.focus.has(url) && !this.background.includes(url)) this.cancel(url, entry);
    }
    this.pump();
  }

  setAllowed(allowed: boolean) {
    this.allowed = allowed;
    if (!allowed) {
      for (const [url, entry] of this.entries) if (!entry.resource && !entry.users && !this.focus.has(url)) this.cancel(url, entry);
    } else this.pump();
  }

  acquire(url: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.reject(cancelled());
    // Foreground consumers always displace unrelated speculative requests.
    for (const [other, entry] of this.entries) if (other !== url && !entry.resource && !entry.users && !this.focus.has(other)) this.cancel(other, entry);
    const entry = this.start(url, 'high');
    entry.users++; entry.touched = ++this.sequence;
    return new Promise((resolve, reject) => {
      let released = false;
      const detach = () => { if (released) return; released = true; signal.removeEventListener('abort', release); entry.users--; };
      const release = () => {
        detach();
        if (!entry.resource && !entry.users && !this.focus.has(url)) this.cancel(url, entry);
        this.trim(); this.pump(); reject(cancelled());
      };
      signal.addEventListener('abort', release, { once: true });
      entry.promise.then(src => { if (!signal.aborted) resolve(src); }, error => {
        detach(); reject(error);
      });
    });
  }

  dispose() {
    this.background = []; this.focus.clear();
    for (const [url, entry] of this.entries) this.cancel(url, entry);
    this.failed.clear();
  }

  private start(url: string, priority: 'high' | 'low') {
    const existing = this.entries.get(url);
    if (existing) { existing.touched = ++this.sequence; return existing; }
    const controller = new AbortController();
    const entry: Entry = { controller, promise: Promise.resolve(''), users: 0, touched: ++this.sequence, progress: 0 };
    this.entries.set(url, entry);
    entry.promise = this.loader(url, controller.signal, priority, fraction => {
      if (!controller.signal.aborted && Number.isFinite(fraction)) entry.progress = Math.max(entry.progress, Math.min(.99, Math.max(0, fraction)));
    }).then(resource => {
      if (controller.signal.aborted || this.entries.get(url) !== entry) { resource.dispose(); throw cancelled(); }
      entry.resource = resource; entry.progress = 1; this.failed.delete(url); this.trim(); return resource.src;
    }, error => {
      if (this.entries.get(url) === entry) this.entries.delete(url);
      if (!controller.signal.aborted) this.failed.set(url, Date.now());
      throw error;
    });
    void entry.promise.then(() => this.pump(), () => this.pump());
    return entry;
  }

  private cancel(url: string, entry: Entry) {
    if (this.entries.get(url) !== entry) return;
    this.entries.delete(url); entry.controller.abort(); entry.resource?.dispose();
  }

  private pump() {
    if (!this.allowed || this.focus.size || [...this.entries.values()].some(entry => !entry.resource)) return;
    const url = this.background.find(url => !this.entries.has(url) && Date.now() - (this.failed.get(url) ?? -Infinity) > 30_000);
    if (url) this.start(url, 'low');
  }

  private trim() {
    const ready = [...this.entries].filter(([, entry]) => entry.resource);
    let count = ready.length, bytes = ready.reduce((sum, [, entry]) => sum + entry.resource!.bytes, 0);
    for (const [url, entry] of ready.sort((a, b) => a[1].touched - b[1].touched)) {
      if (count <= this.limit && bytes <= this.byteLimit) break;
      if (entry.users || this.focus.has(url)) continue;
      count--; bytes -= entry.resource!.bytes; this.cancel(url, entry);
    }
  }
}

export const photoImageCache = new PhotoImageCache();
export async function loadCachedImageElement(url: string, message: string, signal: AbortSignal) {
  const src = await photoImageCache.acquire(url, signal);
  return loadImageElement(src, message, { signal, fetchPriority: 'high' });
}

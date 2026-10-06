export const loadImageElement = (url: string, message = '图片加载失败。', options: {
  signal?: AbortSignal; fetchPriority?: 'high' | 'low' | 'auto';
} = {}) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  let settled = false;
  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    image.onload = image.onerror = null;
    options.signal?.removeEventListener('abort', abort);
    if (error) reject(error); else resolve(image);
  };
  const abort = () => {
    finish(new DOMException('Image loading cancelled', 'AbortError'));
    image.removeAttribute('src');
  };
  image.decoding = 'async';
  image.fetchPriority = options.fetchPriority || 'auto';
  image.onload = async () => {
    try { await image.decode(); } catch { /* Loaded pixels remain usable on older browsers. */ }
    if (!settled) finish(image.naturalWidth ? undefined : new Error(message));
  };
  image.onerror = () => finish(new Error(message));
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) { abort(); return; }
  image.src = url;
});

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { asset, type Photo } from './types';
import { photoDepthFile, photoDisplayFile } from './photo-image';
import { PhotoPerspectiveOverlay } from './PhotoPerspective';
import { loadCachedImageElement, photoImageCache } from './photo-image-cache';
import { depthGray, depthHistogram, depthLineRadius, depthTransitionFrame, parseLineColor, revealFront } from './depth-transition';
import { advanceOverlayClock, overlayPhotoAlpha, overlayProgress, type PhotoOverlayMode } from './photo-overlay';
import type { MapViewport } from './map-card-viewport';

type Prepared = {
  photo: HTMLImageElement; width: number; height: number; gray?: Uint8Array; histogram?: Uint32Array;
  mask: HTMLCanvasElement; line: HTMLCanvasElement; maskData: ImageData; lineData: ImageData;
  keep: Uint8Array; edge: Uint8Array; exitBase: Uint8Array;
};

export default function PhotoOverlay({ photo, viewport, imageSource, depthSource, theme, mode = 'off', cameraReady, onEntered, onExited }: {
  photo: Photo; viewport: MapViewport; imageSource?: string; depthSource?: string; theme: string;
  mode: PhotoOverlayMode; cameraReady: boolean; onEntered?: () => void; onExited?: () => void;
}) {
  const imageUrl = imageSource || asset(photoDisplayFile(photo)), thumbnailUrl = asset(photo.files.thumbnail);
  const depthFile = photoDepthFile(photo), depthUrl = depthSource || (depthFile ? asset(depthFile) : undefined);
  const canvas = useRef<HTMLCanvasElement>(null), still = useRef<HTMLImageElement>(null);
  const prepared = useRef<Prepared | null>(null), frame = useRef({ phase: 'entering' as 'entering' | 'exiting', progress: 0 });
  const secondary = useRef<{ image?: HTMLImageElement; state: 'loading' | 'loaded' | 'error' }>({ state: 'loading' });
  const callbacks = useRef({ onEntered, onExited }); callbacks.current = { onEntered, onExited };
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [message, setMessage] = useState('');
  const [stillSource, setStillSource] = useState<string>(), [quality, setQuality] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [depthReady, setDepthReady] = useState(false), [depthError, setDepthError] = useState(false), [retry, setRetry] = useState(0);
  const usesDepth = mode === 'entering' || mode === 'shown' || mode === 'exiting';
  const translucent = mode === 'translucent';

  useEffect(() => {
    if ((!usesDepth && !translucent) || !ready || (depthUrl && !depthReady && !depthError)) return;
    const controller = new AbortController();
    secondary.current = { state: 'loading' }; setQuality('loading');
    void loadCachedImageElement(imageUrl, '次高清照片暂时无法载入。', controller.signal)
      .then(image => {
        if (controller.signal.aborted) return;
        secondary.current = { image, state: 'loaded' }; setQuality('loaded'); setStillSource(image.src);
        if (prepared.current && frame.current.phase !== 'exiting') prepared.current.photo = image;
      })
      .catch(() => { if (!controller.signal.aborted) { secondary.current = { state: 'error' }; setQuality('error'); } });
    return () => controller.abort();
  }, [usesDepth, translucent, imageUrl, depthUrl, ready, depthReady, depthError, retry]);

  useEffect(() => {
    // Every photo loads thumbnail -> depth -> display; entry waits for decoded depth.
    if (!usesDepth && !translucent) return;
    const controller = new AbortController();
    setReady(false); setFailed(false); setMessage(''); prepared.current = null;
    setDepthReady(false); setDepthError(false); secondary.current = { state: 'loading' }; setQuality('loading');
    frame.current = { phase: 'entering', progress: 0 };
    let depth: HTMLImageElement | undefined, data: Prepared | undefined;
    const applyDepth = () => {
      if (!depth || !data || controller.signal.aborted || frame.current.phase === 'exiting') return;
      const context = data.mask.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(depth, 0, 0, data.width, data.height);
      data.gray = depthGray(context.getImageData(0, 0, data.width, data.height).data);
      data.histogram = depthHistogram(data.gray);
      for (let i = 0; i < data.exitBase.length; i++) data.maskData.data[i * 4 + 3] = 255;
    };
    const prepare = (picture: HTMLImageElement) => {
      setStillSource(picture.src);
      if (!usesDepth) { setReady(true); return; }
      // The animation canvas is small; the finished <img> keeps the display resolution.
      const scale = 720 / Math.max(picture.naturalWidth, picture.naturalHeight);
      const width = Math.max(1, Math.round(picture.naturalWidth * scale)), height = Math.max(1, Math.round(picture.naturalHeight * scale));
      const mask = document.createElement('canvas'), line = document.createElement('canvas');
      mask.width = line.width = width; mask.height = line.height = height;
      data = { photo: picture, width, height,
        mask, line, maskData: new ImageData(width, height), lineData: new ImageData(width, height),
        keep: new Uint8Array(width * height), edge: new Uint8Array(width * height), exitBase: new Uint8Array(width * height).fill(255) };
      prepared.current = data; applyDepth(); setReady(true);
    };
    void (async () => {
      const thumbnail = await loadCachedImageElement(thumbnailUrl, '缩略图暂时无法载入。', controller.signal).catch(() => undefined);
      if (controller.signal.aborted) return;
      if (thumbnail) prepare(thumbnail);
      if (depthUrl) {
        try {
          depth = await loadCachedImageElement(depthUrl, '深度图加载失败，请重试。', controller.signal);
          if (controller.signal.aborted) return;
          applyDepth(); setDepthReady(true);
        } catch {
          if (controller.signal.aborted) return;
          setDepthError(true); setMessage('深度图加载失败，请重试。');
        }
      } else if (usesDepth) { setDepthError(true); setMessage('这张照片还没有深度图，暂时无法开始转场。'); }
      if (!thumbnail) {
        try {
          const display = await loadCachedImageElement(imageUrl, '照片暂时无法载入，请返回后重试。', controller.signal);
          if (!controller.signal.aborted) prepare(display);
        } catch (error) { if (!controller.signal.aborted) { setMessage((error as Error).message); setFailed(true); } }
      }
    })();
    return () => controller.abort();
  }, [usesDepth, translucent, imageUrl, thumbnailUrl, depthUrl, retry]);

  const exitOpacity = useRef(1);
  const draw = (phase: 'entering' | 'exiting', progress: number) => {
    const target = canvas.current, data = prepared.current, image = still.current;
    if (!target || !data || !image) return;
    const context = target.getContext('2d');
    if (!context) return;
    if (target.width !== data.width || target.height !== data.height) { target.width = data.width; target.height = data.height; }
    target.dataset.phase = phase; target.dataset.progress = String(progress);
    context.globalCompositeOperation = 'source-over'; context.clearRect(0, 0, data.width, data.height);
    const complete = phase === 'entering' && progress >= 1;
    image.style.opacity = complete ? '1' : '0'; target.style.opacity = '1';
    if (complete || (phase === 'entering' && progress <= 0) || (phase === 'exiting' && progress >= 1)) return;
    context.drawImage(data.photo, 0, 0, data.width, data.height);
    if (!data.gray || !data.histogram) {
      target.style.opacity = String(phase === 'entering' ? progress : (1 - progress) * exitOpacity.current); return;
    }
    const { keep, line } = depthTransitionFrame({ gray: data.gray, width: data.width, height: data.height,
      front: revealFront(data.histogram, progress), radius: depthLineRadius(data.width), keep: data.keep, line: data.edge });
    const color = getComputedStyle(document.documentElement).getPropertyValue('--green').trim();
    const { r, g, b } = parseLineColor(color); target.dataset.lineColor = color;
    for (let i = 0; i < keep.length; i++) {
      const alpha = overlayPhotoAlpha(phase, keep[i], data.exitBase[i]);
      data.maskData.data[i * 4 + 3] = 255 - alpha;
      data.lineData.data[i * 4] = r; data.lineData.data[i * 4 + 1] = g; data.lineData.data[i * 4 + 2] = b;
      data.lineData.data[i * 4 + 3] = phase === 'exiting' ? Math.round(line[i] * data.exitBase[i] / 255) : line[i];
    }
    data.mask.getContext('2d')?.putImageData(data.maskData, 0, 0);
    data.line.getContext('2d')?.putImageData(data.lineData, 0, 0);
    context.globalCompositeOperation = 'destination-out'; context.drawImage(data.mask, 0, 0);
    context.globalCompositeOperation = 'source-over'; context.drawImage(data.line, 0, 0);
  };
  useEffect(() => {
    if (!usesDepth) {
      canvas.current?.getContext('2d')?.clearRect(0, 0, canvas.current.width, canvas.current.height);
      if (still.current) still.current.style.opacity = translucent ? '.5' : '0';
      frame.current = { phase: 'entering', progress: 0 }; return;
    }
    if (mode === 'exiting' && (!ready || !depthReady)) { callbacks.current.onExited?.(); return; }
    if (failed) { (mode === 'exiting' ? callbacks.current.onExited : callbacks.current.onEntered)?.(); return; }
    if (!ready || !cameraReady || !depthReady || !prepared.current?.gray) return;
    if (mode === 'shown') { frame.current = { phase: 'entering', progress: 1 }; draw('entering', 1); return; }
    const phase = mode === 'exiting' ? 'exiting' : 'entering', data = prepared.current!;
    if (phase === 'exiting') {
      // Exit keeps the last rendered picture and mask, including a partial entry.
      const previous = frame.current;
      exitOpacity.current = previous.phase === 'entering' ? previous.progress : exitOpacity.current * (1 - previous.progress);
      if (data.gray && previous.progress < 1) {
        for (let i = 0; i < data.exitBase.length; i++) data.exitBase[i] = 255 - data.maskData.data[i * 4 + 3];
      } else data.exitBase.fill(255);
    }
    const duration = 1600;
    let clock = { elapsed: 0, rate: 1 }, handle = 0, previous: number | undefined, drawn = -1;
    const step = (now: number) => {
      const displayProgress = secondary.current.state === 'loading' ? Math.min(.99, photoImageCache.progress(imageUrl)) : 1;
      const loaded = phase === 'exiting' ? 1 : displayProgress;
      clock = advanceOverlayClock(clock, previous === undefined ? 0 : now - previous, loaded, duration);
      previous = now;
      const progress = overlayProgress(clock.elapsed, duration);
      frame.current = { phase, progress };
      // A stalled download needs no repeated pixel-mask work for the same frame.
      if (progress >= 1 || Math.abs(progress - drawn) >= .0001) { draw(phase, progress); drawn = progress; }
      if (clock.elapsed < duration) handle = requestAnimationFrame(step);
      else (phase === 'exiting' ? callbacks.current.onExited : callbacks.current.onEntered)?.();
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [mode, usesDepth, translucent, ready, depthReady, failed, cameraReady]);
  useEffect(() => { if (ready && usesDepth && depthReady) draw(frame.current.phase, frame.current.progress); }, [theme, quality, depthReady]);

  const status = depthError ? message : !ready ? message || '正在载入缩略图…' : !depthReady ? '正在载入深度图…' : quality === 'error' ? '次高清照片加载失败，已保留缩略图。' : quality === 'loading' ? '正在载入次高清照片…' : message;
  return <>
    {usesDepth && status && <p className="photo-overlay-status" role="status" aria-live="polite">{!depthError && (!ready && !failed || quality === 'loading' || !depthReady) && <LoaderCircle size={14} className="photo-image-spinner" aria-hidden="true" />}{status}{(depthError && depthUrl || quality === 'error') && <button type="button" className="text-button" onClick={event => { event.stopPropagation(); setRetry(value => value + 1); }}>重试</button>}</p>}
    <PhotoPerspectiveOverlay photo={photo} viewport={viewport}>
      <img ref={still} className="photo-overlay-still" src={mode !== 'off' ? stillSource : undefined} alt="" draggable={false} />
      <canvas ref={canvas} className="depth-transition-layer" aria-hidden="true" />
    </PhotoPerspectiveOverlay>
  </>;
}

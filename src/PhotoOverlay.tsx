import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { asset, type Photo } from './types';
import { photoDepthFile, photoDisplayFile } from './photo-image';
import { PhotoPerspectiveOverlay } from './PhotoPerspective';
import { loadImageElement } from './depth-map';
import { loadCachedImageElement, photoImageCache } from './photo-image-cache';
import { depthGray, depthHistogram, depthLineRadius, depthTransitionFrame, parseLineColor, revealFront } from './depth-transition';
import { advanceOverlayClock, overlayPhotoAlpha, overlayProgress, type PhotoOverlayMode } from './photo-overlay';
import type { MapViewport } from './map-card-viewport';

type Prepared = {
  photo: HTMLImageElement; width: number; height: number; gray?: Uint8Array; histogram?: Uint32Array; entryProgress: number;
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
  const depthSettled = useRef(!depthUrl);
  const callbacks = useRef({ onEntered, onExited }); callbacks.current = { onEntered, onExited };
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [message, setMessage] = useState('');
  const [stillSource, setStillSource] = useState<string>(), [quality, setQuality] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [depthReady, setDepthReady] = useState(!depthUrl), [retry, setRetry] = useState(0);
  const usesDepth = mode === 'entering' || mode === 'shown' || mode === 'exiting';
  const translucent = mode === 'translucent';

  useEffect(() => {
    if (!usesDepth && !translucent) return;
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
  }, [usesDepth, translucent, imageUrl, retry]);

  useEffect(() => {
    // The thumbnail starts the wipe; neither the display image nor depth gates it.
    if (!usesDepth) return;
    const controller = new AbortController();
    setReady(false); setFailed(false); setMessage(''); prepared.current = null;
    depthSettled.current = !depthUrl; setDepthReady(!depthUrl);
    let depth: HTMLImageElement | undefined, data: Prepared | undefined;
    const applyDepth = () => {
      if (!depth || !data || controller.signal.aborted || frame.current.phase === 'exiting') return;
      const context = data.mask.getContext('2d', { willReadFrequently: true });
      if (!context) return;
      context.drawImage(depth, 0, 0, data.width, data.height);
      data.gray = depthGray(context.getImageData(0, 0, data.width, data.height).data);
      data.histogram = depthHistogram(data.gray);
      // A late depth map continues from the already visible thumbnail alpha.
      data.entryProgress = frame.current.progress;
      for (let i = 0; i < data.exitBase.length; i++) data.maskData.data[i * 4 + 3] = Math.round(255 * (1 - data.entryProgress));
    };
    if (depthUrl) void loadCachedImageElement(depthUrl, '深度图载入失败。', controller.signal)
      .then(image => { depth = image; applyDepth(); })
      .catch(() => { if (!controller.signal.aborted) setMessage('深度图暂时无法载入，本次使用渐隐过渡。'); })
      .finally(() => { if (!controller.signal.aborted) { depthSettled.current = true; setDepthReady(true); } });
    void loadImageElement(thumbnailUrl, '照片暂时无法载入，请返回后重试。', { signal: controller.signal, fetchPriority: 'high' })
      .catch(() => loadCachedImageElement(imageUrl, '照片暂时无法载入，请返回后重试。', controller.signal))
      .then(thumbnail => {
        if (controller.signal.aborted) return;
        const picture = secondary.current.image || thumbnail;
        setStillSource(picture.src);
        // The animation canvas is small; the finished <img> keeps the display resolution.
        const scale = 720 / Math.max(picture.naturalWidth, picture.naturalHeight);
        const width = Math.max(1, Math.round(picture.naturalWidth * scale)), height = Math.max(1, Math.round(picture.naturalHeight * scale));
        const mask = document.createElement('canvas'), line = document.createElement('canvas');
        mask.width = line.width = width; mask.height = line.height = height;
        data = { photo: picture, width, height, entryProgress: 0,
          mask, line, maskData: new ImageData(width, height), lineData: new ImageData(width, height),
          keep: new Uint8Array(width * height), edge: new Uint8Array(width * height), exitBase: new Uint8Array(width * height).fill(255) };
        prepared.current = data; applyDepth(); setReady(true);
      })
      .catch(error => { if (!controller.signal.aborted) { setMessage(error.message); setFailed(true); } });
    return () => controller.abort();
  }, [usesDepth, imageUrl, thumbnailUrl, depthUrl]);

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
    const sweep = phase === 'entering' ? data.entryProgress >= 1 ? 1 : Math.max(0, (progress - data.entryProgress) / (1 - data.entryProgress)) : progress;
    const { keep, line } = depthTransitionFrame({ gray: data.gray, width: data.width, height: data.height,
      front: revealFront(data.histogram, sweep), radius: depthLineRadius(data.width), keep: data.keep, line: data.edge });
    const color = getComputedStyle(document.documentElement).getPropertyValue('--green').trim();
    const { r, g, b } = parseLineColor(color); target.dataset.lineColor = color;
    for (let i = 0; i < keep.length; i++) {
      const alpha = phase === 'entering' ? Math.round(255 * data.entryProgress + (1 - data.entryProgress) * overlayPhotoAlpha(phase, keep[i])) : overlayPhotoAlpha(phase, keep[i], data.exitBase[i]);
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
    if (mode === 'exiting' && !ready) { callbacks.current.onExited?.(); return; }
    if (failed) { (mode === 'exiting' ? callbacks.current.onExited : callbacks.current.onEntered)?.(); return; }
    if (!ready || !cameraReady) return;
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
      const depthProgress = depthSettled.current || !depthUrl ? 1 : Math.min(.99, photoImageCache.progress(depthUrl));
      const loaded = phase === 'exiting' ? 1 : Math.min(displayProgress, depthProgress);
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
  }, [mode, usesDepth, translucent, ready, failed, cameraReady]);
  useEffect(() => { if (ready && usesDepth) draw(frame.current.phase, frame.current.progress); }, [theme, quality, depthReady]);

  const status = !ready ? message || '正在载入照片…' : quality === 'error' ? '次高清照片加载失败，已保留缩略图。' : quality === 'loading' ? '正在载入次高清照片…' : !depthReady ? '正在载入深度图…' : message;
  return <>
    {usesDepth && status && <p className="photo-overlay-status" role="status" aria-live="polite">{(!ready && !failed || quality === 'loading' || !depthReady) && <LoaderCircle size={14} className="photo-image-spinner" aria-hidden="true" />}{status}{quality === 'error' && <button type="button" className="text-button" onClick={event => { event.stopPropagation(); setRetry(value => value + 1); }}>重试</button>}</p>}
    <PhotoPerspectiveOverlay photo={photo} viewport={viewport}>
      <img ref={still} className="photo-overlay-still" src={mode !== 'off' ? stillSource : undefined} alt="" draggable={false} />
      <canvas ref={canvas} className="depth-transition-layer" aria-hidden="true" />
    </PhotoPerspectiveOverlay>
  </>;
}

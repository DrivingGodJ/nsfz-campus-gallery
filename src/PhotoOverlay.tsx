import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { asset, type Photo } from './types';
import { photoDepthFile, photoPreviewFile } from './photo-image';
import { PhotoPerspectiveOverlay } from './PhotoPerspective';
import { loadImageElement } from './depth-map';
import { loadCachedImageElement } from './photo-image-cache';
import { depthGray, depthHistogram, depthLineRadius, depthTransitionFrame, parseLineColor, revealFront } from './depth-transition';
import { advanceOverlayClock, OVERLAY_WAITING_RATE, overlayPhotoAlpha, overlayProgress, type PhotoOverlayMode } from './photo-overlay';
import type { MapViewport } from './map-card-viewport';

type Prepared = {
  photo: HTMLImageElement; width: number; height: number; gray?: Uint8Array; histogram?: Uint32Array;
  mask: HTMLCanvasElement; line: HTMLCanvasElement; maskData: ImageData; lineData: ImageData;
  keep: Uint8Array; edge: Uint8Array; exitBase: Uint8Array;
};

type OriginalImage = { url: string; state: 'loading' | 'loaded' | 'error'; image?: HTMLImageElement };

export default function PhotoOverlay({ photo, viewport, imageSource, originalSource, depthSource, theme, mode = 'off', cameraReady, onEntered, onExited }: {
  photo: Photo; viewport: MapViewport; imageSource?: string; originalSource?: string; depthSource?: string; theme: string;
  mode: PhotoOverlayMode; cameraReady: boolean; onEntered?: () => void; onExited?: () => void;
}) {
  const imageUrl = imageSource || asset(photoPreviewFile(photo));
  const depthFile = photoDepthFile(photo), depthUrl = depthSource || (depthFile ? asset(depthFile) : undefined);
  const canvas = useRef<HTMLCanvasElement>(null), still = useRef<HTMLImageElement>(null), full = useRef<HTMLImageElement>(null);
  const originalLayer = useRef<HTMLDivElement>(null);
  const prepared = useRef<Prepared | null>(null), frame = useRef({ phase: 'entering' as 'entering' | 'exiting', progress: 0 });
  const callbacks = useRef({ onEntered, onExited }); callbacks.current = { onEntered, onExited };
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [message, setMessage] = useState('');
  const [stillSource, setStillSource] = useState<string>();
  const [original, setOriginal] = useState<OriginalImage | null>(null), [retry, setRetry] = useState(0);
  const usesDepth = mode === 'entering' || mode === 'shown' || mode === 'exiting';
  const translucent = mode === 'translucent';
  const originalImage = useRef<HTMLImageElement | undefined>(undefined);
  originalImage.current = original && original.url === originalSource ? original.image : undefined;
  const originalPending = usesDepth && !!originalSource && originalSource !== imageUrl && (!original || original.url !== originalSource || original.state === 'loading');
  const waitingForOriginal = useRef(originalPending); waitingForOriginal.current = originalPending;

  useEffect(() => {
    if (!usesDepth || !ready || !originalSource || originalSource === imageUrl) { setOriginal(null); return; }
    const controller = new AbortController();
    setOriginal({ url: originalSource, state: 'loading' });
    // Start the original only after the secondary image and depth are usable,
    // so even browsers without request-priority support load the transition first.
    void loadImageElement(originalSource, '原图暂时无法载入。', { signal: controller.signal, fetchPriority: 'low' })
      .then(image => { if (!controller.signal.aborted) setOriginal({ url: originalSource, state: 'loaded', image }); })
      .catch(() => { if (!controller.signal.aborted) setOriginal({ url: originalSource, state: 'error' }); });
    return () => controller.abort();
  }, [usesDepth, ready, imageUrl, originalSource, retry]);

  useEffect(() => {
    // Half opacity is a plain image: no depth request, mask, or animated wipe.
    if (!usesDepth && !translucent) return;
    const controller = new AbortController();
    if (translucent) {
      void loadCachedImageElement(imageUrl, '照片暂时无法载入。', controller.signal)
        .then(picture => { if (!controller.signal.aborted) setStillSource(picture.src); })
        .catch(() => { /* Cancellation or a failed photo must not interrupt map interaction. */ });
      return () => controller.abort();
    }
    setReady(false); setFailed(false); setMessage('');
    void (async () => {
      // Fetch the secondary HD image and its depth map together. Neither waits for the original.
      const [picture, depth] = await Promise.all([
        loadCachedImageElement(imageUrl, '照片暂时无法载入，请返回后重试。', controller.signal),
        depthUrl ? loadCachedImageElement(depthUrl, '深度图载入失败。', controller.signal).catch(() => {
          if (!controller.signal.aborted) setMessage('深度图暂时无法载入，本次使用渐隐过渡。');
          return undefined;
        }) : undefined,
      ]);
      if (controller.signal.aborted) return;
      setStillSource(picture.src);
      // Only the wipe uses a small canvas; the finished image stays sharp.
      const scale = Math.min(1, 720 / Math.max(picture.naturalWidth, picture.naturalHeight));
      const width = Math.max(1, Math.round(picture.naturalWidth * scale)), height = Math.max(1, Math.round(picture.naturalHeight * scale));
      const mask = document.createElement('canvas'), line = document.createElement('canvas');
      mask.width = line.width = width; mask.height = line.height = height;
      let gray: Uint8Array | undefined;
      if (depth) {
        const context = mask.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('照片叠加载入失败，请返回后重试。');
        context.drawImage(depth, 0, 0, width, height);
        gray = depthGray(context.getImageData(0, 0, width, height).data);
      }
      prepared.current = { photo: picture, width, height, gray, histogram: gray ? depthHistogram(gray) : undefined,
        mask, line, maskData: new ImageData(width, height), lineData: new ImageData(width, height),
        keep: new Uint8Array(width * height), edge: new Uint8Array(width * height), exitBase: new Uint8Array(width * height).fill(255) };
      setReady(true);
    })().catch(error => { if (!controller.signal.aborted) { setMessage(error.message); setFailed(true); } });
    return () => controller.abort();
  }, [usesDepth, translucent, imageUrl, depthUrl]);

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
    if (full.current) {
      full.current.style.transition = complete ? '' : 'none';
      full.current.style.opacity = complete && full.current.complete && full.current.naturalWidth ? '1' : '0';
    }
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
      data.maskData.data[i * 4 + 3] = 255 - overlayPhotoAlpha(phase, keep[i], data.exitBase[i]);
      data.lineData.data[i * 4] = r; data.lineData.data[i * 4 + 1] = g; data.lineData.data[i * 4 + 2] = b;
      data.lineData.data[i * 4 + 3] = phase === 'exiting' ? Math.round(line[i] * data.exitBase[i] / 255) : line[i];
    }
    data.mask.getContext('2d')?.putImageData(data.maskData, 0, 0);
    data.line.getContext('2d')?.putImageData(data.lineData, 0, 0);
    context.globalCompositeOperation = 'destination-out'; context.drawImage(data.mask, 0, 0);
    context.globalCompositeOperation = 'source-over'; context.drawImage(data.line, 0, 0);
  };
  const exitOpacity = useRef(1);
  useEffect(() => {
    if (!usesDepth) {
      canvas.current?.getContext('2d')?.clearRect(0, 0, canvas.current.width, canvas.current.height);
      if (still.current) still.current.style.opacity = mode === 'translucent' ? '.5' : '0';
      if (full.current) full.current.style.opacity = '0';
      frame.current = { phase: 'entering', progress: 0 }; return;
    }
    if (mode === 'exiting' && !ready) { callbacks.current.onExited?.(); return; }
    if (failed) { (mode === 'exiting' ? callbacks.current.onExited : callbacks.current.onEntered)?.(); return; }
    if (!ready || !cameraReady) return;
    if (mode === 'shown') { frame.current = { phase: 'entering', progress: 1 }; draw('entering', 1); return; }
    const phase = mode === 'exiting' ? 'exiting' : 'entering', data = prepared.current!;
    if (phase === 'exiting') {
      // Freeze the best available image for the exit, even if a pending original finishes midway.
      data.photo = originalImage.current || data.photo;
      // Escape during entry reveals the model from the current frame, without
      // flashing a complete photo or restarting the camera motion.
      const previous = frame.current;
      exitOpacity.current = previous.phase === 'entering' ? previous.progress : exitOpacity.current * (1 - previous.progress);
      if (data.gray && data.histogram) {
        const base = depthTransitionFrame({ gray: data.gray, width: data.width, height: data.height, front: revealFront(data.histogram, previous.progress) }).keep;
        for (let i = 0; i < base.length; i++) data.exitBase[i] = overlayPhotoAlpha(previous.phase, base[i], data.exitBase[i]);
      } else data.exitBase.fill(255);
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 200 : 1600;
    const shouldSlow = () => phase === 'entering' && !reducedMotion && waitingForOriginal.current;
    let clock = { elapsed: 0, rate: shouldSlow() ? OVERLAY_WAITING_RATE : 1 };
    let handle = 0, previous: number | undefined;
    const step = (now: number) => {
      clock = advanceOverlayClock(clock, previous === undefined ? 0 : now - previous, shouldSlow());
      previous = now;
      const progress = overlayProgress(clock.elapsed, duration);
      frame.current = { phase, progress }; draw(phase, progress);
      if (clock.elapsed < duration) handle = requestAnimationFrame(step);
      else (phase === 'exiting' ? callbacks.current.onExited : callbacks.current.onEntered)?.();
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [mode, usesDepth, ready, failed, cameraReady]);
  useEffect(() => { if (ready && usesDepth) draw(frame.current.phase, frame.current.progress); }, [theme]);

  const revealOriginal = () => {
    if (mode === 'shown' && full.current?.complete && full.current.naturalWidth) {
      full.current.style.transition = '';
      full.current.style.opacity = '1';
    }
  };
  useEffect(() => {
    const layer = originalLayer.current, image = originalImage.current;
    if (!layer || !image || !usesDepth) return;
    // Reuse the decoded element itself: assigning its URL to another <img>
    // could download the original again when the server disallows caching.
    image.className = 'photo-overlay-still photo-overlay-original';
    image.alt = ''; image.draggable = false;
    image.style.opacity = '0';
    layer.replaceChildren(image); full.current = image;
    getComputedStyle(image).opacity;
    revealOriginal();
    return () => { full.current = null; layer.replaceChildren(); };
  }, [original, usesDepth]);
  useEffect(revealOriginal, [original, mode]);
  const awaitingOriginal = (mode === 'entering' || mode === 'shown') && ready && !!originalSource && originalSource !== imageUrl && original?.url === originalSource && original.state !== 'loaded';
  const originalFailed = awaitingOriginal && original?.state === 'error';
  const status = awaitingOriginal ? originalFailed ? '原图加载失败，已保留次高清照片。' : '正在加载原图…' : message || (!ready ? '正在载入照片…' : '');

  return <>
    {usesDepth && status && <p className="photo-overlay-status" role="status" aria-live="polite">{(!ready && !failed || awaitingOriginal && !originalFailed) && <LoaderCircle size={14} className="photo-image-spinner" aria-hidden="true" />}{status}{originalFailed && <button type="button" className="text-button" onClick={event => { event.stopPropagation(); setRetry(value => value + 1); }}>重试</button>}</p>}
    <PhotoPerspectiveOverlay photo={photo} viewport={viewport}>
      <img ref={still} className="photo-overlay-still" src={mode !== 'off' ? stillSource : undefined} alt="" draggable={false} />
      <div ref={originalLayer} className="photo-overlay-original-layer" />
      <canvas ref={canvas} className="depth-transition-layer" aria-hidden="true" />
    </PhotoPerspectiveOverlay>
  </>;
}

import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { asset, type Photo } from './types';
import { photoDepthFile, photoPreviewFile } from './photo-image';
import { PhotoPerspectiveOverlay } from './PhotoPerspective';
import { loadImageElement } from './depth-map';
import { depthGray, depthHistogram, depthLineRadius, depthTransitionFrame, parseLineColor, revealFront } from './depth-transition';
import { overlayPhotoAlpha, overlayProgress, type PhotoOverlayMode } from './photo-overlay';
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
  const imageUrl = imageSource || asset(photoPreviewFile(photo));
  const depthFile = photoDepthFile(photo), depthUrl = depthSource || (depthFile ? asset(depthFile) : undefined);
  const canvas = useRef<HTMLCanvasElement>(null), still = useRef<HTMLImageElement>(null);
  const prepared = useRef<Prepared | null>(null), frame = useRef({ phase: 'entering' as 'entering' | 'exiting', progress: 0 });
  const callbacks = useRef({ onEntered, onExited }); callbacks.current = { onEntered, onExited };
  const [ready, setReady] = useState(false), [failed, setFailed] = useState(false), [message, setMessage] = useState('');
  const usesDepth = mode === 'entering' || mode === 'shown' || mode === 'exiting';

  useEffect(() => {
    // Half opacity is a plain image: no depth request, mask, or animated wipe.
    if (!usesDepth) return;
    let active = true;
    setReady(false); setFailed(false); setMessage('');
    void (async () => {
      const picture = await loadImageElement(imageUrl, '照片暂时无法载入，请返回后重试。');
      let depth: HTMLImageElement | undefined;
      if (depthUrl) {
        try { depth = await loadImageElement(depthUrl, '深度图载入失败。'); }
        catch { if (active) setMessage('深度图暂时无法载入，本次使用渐隐过渡。'); }
      }
      if (!active) return;
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
    })().catch(error => { if (active) { setMessage(error.message); setFailed(true); } });
    return () => { active = false; };
  }, [usesDepth, imageUrl, depthUrl]);

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
      frame.current = { phase: 'entering', progress: 0 }; return;
    }
    if (failed) { (mode === 'exiting' ? callbacks.current.onExited : callbacks.current.onEntered)?.(); return; }
    if (!ready || !cameraReady) return;
    if (mode === 'shown') { frame.current = { phase: 'entering', progress: 1 }; draw('entering', 1); return; }
    const phase = mode === 'exiting' ? 'exiting' : 'entering', data = prepared.current!;
    if (phase === 'exiting') {
      // Escape during entry reveals the model from the current frame, without
      // flashing a complete photo or restarting the camera motion.
      const previous = frame.current;
      exitOpacity.current = previous.phase === 'entering' ? previous.progress : exitOpacity.current * (1 - previous.progress);
      if (data.gray && data.histogram) {
        const base = depthTransitionFrame({ gray: data.gray, width: data.width, height: data.height, front: revealFront(data.histogram, previous.progress) }).keep;
        for (let i = 0; i < base.length; i++) data.exitBase[i] = overlayPhotoAlpha(previous.phase, base[i], data.exitBase[i]);
      } else data.exitBase.fill(255);
    }
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 200 : 1600;
    let handle = 0, started: number | undefined;
    const step = (now: number) => {
      started ??= now;
      const progress = overlayProgress(now - started, duration);
      frame.current = { phase, progress }; draw(phase, progress);
      if (now - started < duration) handle = requestAnimationFrame(step);
      else (phase === 'exiting' ? callbacks.current.onExited : callbacks.current.onEntered)?.();
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [mode, usesDepth, ready, failed, cameraReady]);
  useEffect(() => { if (ready && usesDepth) draw(frame.current.phase, frame.current.progress); }, [theme]);

  return <>
    {usesDepth && (!ready || message) && <p className="photo-overlay-status" role="status">{!ready && !failed && <LoaderCircle size={14} className="photo-image-spinner" />}{message || '正在载入照片…'}</p>}
    <PhotoPerspectiveOverlay photo={photo} viewport={viewport}>
      <img ref={still} className="photo-overlay-still" src={mode !== 'off' ? imageUrl : undefined} alt="" draggable={false} />
      <canvas ref={canvas} className="depth-transition-layer" aria-hidden="true" />
    </PhotoPerspectiveOverlay>
  </>;
}

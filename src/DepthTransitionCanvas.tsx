import { useEffect, useRef, useState, type RefObject } from 'react';
import { depthLineRadius, depthTransitionFrame, depthTransitionLayers, parseLineColor, revealFront, transitionProgress, type DepthTransitionSettings } from './depth-transition';
import { loadImageElement } from './depth-map';

type Props = {
  run: number; playing: boolean; depthUrl: string; imageUrl: string;
  gray: Uint8Array; histogram: Uint32Array; width: number; height: number;
  settings: DepthTransitionSettings;
  // The scrubber is uncontrolled on purpose: dragging it must not re-render the
  // whole map at pointer rate, so the canvas owns the value and the readout.
  scrubber?: RefObject<HTMLInputElement | null>; readout?: RefObject<HTMLSpanElement | null>;
  onScrub: () => void; onFinish: () => void;
};

const load = (url: string) => loadImageElement(url, '转场照片加载失败。');

// Composites the photo over the depth map one depth step at a time, leaving the
// blue edge behind the front. The three layers share the frame geometry, so the
// canvas is drawn at the depth map's own resolution and scaled by CSS.
export default function DepthTransitionCanvas({ run, playing, depthUrl, imageUrl, gray, histogram, width, height, settings, scrubber, readout, onScrub, onFinish }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const images = useRef<{ depth: HTMLImageElement; photo: HTMLImageElement } | null>(null);
  const buffers = useRef<{ mask: HTMLCanvasElement; line: HTMLCanvasElement; maskData: ImageData; lineData: ImageData; keep: Uint8Array; edge: Uint8Array } | null>(null);
  const elapsed = useRef(0), progress = useRef(0);
  const [ready, setReady] = useState(false);
  const live = useRef({ gray, histogram, width, height, settings, scrubber, readout, onFinish });
  live.current = { gray, histogram, width, height, settings, scrubber, readout, onFinish };

  useEffect(() => {
    let active = true;
    Promise.all([load(depthUrl), load(imageUrl)])
      .then(([depth, photo]) => { if (active) { images.current = { depth, photo }; setReady(true); } })
      .catch(() => { if (active) onFinish(); });
    return () => { active = false; };
    // onFinish is read through the caller's closure; re-running on it would restart the load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depthUrl, imageUrl]);

  // The edge colour only touches the RGB channels, so it is baked into the line
  // buffer once instead of on every frame.
  useEffect(() => {
    const mask = document.createElement('canvas'), line = document.createElement('canvas');
    mask.width = line.width = width; mask.height = line.height = height;
    const { r, g, b } = parseLineColor(settings.color);
    const lineData = new ImageData(width, height);
    for (let index = 0; index < width * height; index++) {
      lineData.data[index * 4] = r; lineData.data[index * 4 + 1] = g; lineData.data[index * 4 + 2] = b;
    }
    buffers.current = { mask, line, maskData: new ImageData(width, height), lineData,
      keep: new Uint8Array(width * height), edge: new Uint8Array(width * height) };
  }, [width, height, settings.color]);

  const draw = (value: number) => {
    const target = canvas.current, loaded = images.current, prepared = buffers.current;
    if (!target || !loaded || !prepared) return;
    const context = target.getContext('2d');
    if (!context) return;
    const { gray: values, histogram: counts, width: w, height: h, settings: current } = live.current;
    const { keep, line } = depthTransitionFrame({ gray: values, width: w, height: h, direction: current.direction, softness: current.softness,
      radius: depthLineRadius(w, current.width), core: current.core, glow: current.glow,
      front: revealFront(counts, value, current.direction), keep: prepared.keep, line: prepared.edge });
    for (let index = 0; index < values.length; index++) {
      prepared.maskData.data[index * 4 + 3] = keep[index];
      prepared.lineData.data[index * 4 + 3] = line[index];
    }
    prepared.mask.getContext('2d')?.putImageData(prepared.maskData, 0, 0);
    prepared.line.getContext('2d')?.putImageData(prepared.lineData, 0, 0);
    // Photo first, punch out everything the front has not reached, drop the depth
    // map behind the holes when it is the chosen background, then lay the edge on
    // top. Leaving the holes empty is what shows the 3D model through.
    for (const layer of depthTransitionLayers(current.background)) {
      if (layer === 'photo') {
        context.globalCompositeOperation = 'source-over';
        context.drawImage(loaded.photo, 0, 0, w, h);
        context.globalCompositeOperation = 'destination-out';
        context.drawImage(prepared.mask, 0, 0);
      } else if (layer === 'depth') {
        context.globalCompositeOperation = 'destination-over';
        context.drawImage(loaded.depth, 0, 0, w, h);
      } else {
        context.globalCompositeOperation = 'source-over';
        context.drawImage(prepared.line, 0, 0);
      }
    }
  };

  // Reports the position back to the scrubber without going through React.
  const report = (value: number) => {
    progress.current = value;
    const { scrubber: slider, readout: label } = live.current;
    if (slider?.current) slider.current.value = String(value);
    if (label?.current) label.current.textContent = Math.round(value * 100) + '%';
  };

  // Scrubbing is handled straight on the input: the loop is paused and the frame
  // follows the thumb.
  useEffect(() => {
    const slider = scrubber?.current;
    if (!slider) return;
    const scrub = () => { onScrub(); draw(progress.current = Number(slider.value) || 0); };
    slider.addEventListener('input', scrub);
    return () => slider.removeEventListener('input', scrub);
    // onScrub is stable enough for a listener that only fires on user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, scrubber, run]);

  // A new run either plays from the start or picks up wherever the thumb is.
  useEffect(() => {
    if (!ready) return;
    const start = playing ? 0 : (scrubber?.current ? Number(scrubber.current.value) || 0 : progress.current);
    elapsed.current = 0;
    report(start);
    draw(start);
    if (!playing) return;
    let handle = 0, previous = performance.now(), stopped = false;
    const step = (now: number) => {
      if (stopped) return;
      elapsed.current += Math.max(0, now - previous);
      previous = now;
      const { settings: current, onFinish: finish } = live.current;
      const value = transitionProgress(elapsed.current, current.duration, current.easing);
      report(value); draw(value);
      if (elapsed.current >= current.duration) { finish(); return; }
      handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => { stopped = true; cancelAnimationFrame(handle); };
  }, [playing, ready, run]);

  // Changing a setting redraws the frame the transition is parked on.
  useEffect(() => { if (ready) draw(progress.current); }, [ready, settings]);

  return <canvas ref={canvas} className="depth-transition-layer" width={width} height={height} aria-hidden="true" />;
}

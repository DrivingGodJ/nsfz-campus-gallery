import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CardSizing } from './CardHandle';
import { FULL_MAP_VIEWPORT, type MapViewport } from './map-card-viewport';

export function useViewerCards(ready: boolean, galleryOpen: boolean, photoOpen: boolean) {
  const container = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [heights, setHeights] = useState({ galleryMobile: 46, photoMobile: 65, galleryDesktop: 100, photoDesktop: 100 });
  useLayoutEffect(() => {
    const node = container.current;
    if (!ready || !node) return;
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update); observer.observe(node);
    return () => observer.disconnect();
  }, [ready]);
  const mobile = size.width <= 760;
  const inset = mobile ? 0 : 12;
  const card = (kind: 'gallery' | 'photo') => {
    const key = `${kind}${mobile ? 'Mobile' : 'Desktop'}` as keyof typeof heights;
    const max = mobile ? 85 : Math.max(0, 100 - 24 / Math.max(1, size.height) * 100);
    const min = Math.min(max, Math.max(25, (kind === 'photo' ? 230 : 180) / Math.max(1, size.height) * 100));
    const value = Math.max(min, Math.min(max, heights[key]));
    const initial = mobile ? kind === 'photo' ? 65 : 46 : 100;
    const width = mobile ? size.width : kind === 'photo' ? Math.min(520, Math.max(320, size.width * .42)) : size.width >= 1600 ? 390 : size.width <= 1100 ? 320 : 355;
    const height = size.height * value / 100;
    const style: CSSProperties = { width: mobile ? '100%' : width, height, bottom: inset, [kind === 'gallery' ? 'left' : 'right']: inset };
    const sizing: CardSizing = { value, min, max, initial, length: size.height, onChange: next => setHeights(previous => ({ ...previous, [key]: next })) };
    return { style, sizing, width, height };
  };
  const gallery = card('gallery'), photo = card('photo'), active = photoOpen ? photo : galleryOpen ? gallery : null;
  let viewport: MapViewport = FULL_MAP_VIEWPORT;
  if (active && size.width && size.height) {
    if (mobile) viewport = { left: 0, top: 0, width: 1, height: Math.max(.05, 1 - active.height / size.height) };
    else {
      const covered = (active.width + 24) / size.width;
      viewport = { left: photoOpen ? 0 : covered, top: 0, width: Math.max(.05, 1 - covered), height: 1 };
    }
  }
  return { container, gallery, photo, viewport };
}

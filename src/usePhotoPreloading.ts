import { useCallback, useEffect, useMemo, useRef } from 'react';
import { asset, type Photo } from './types';
import { photoDepthFile, photoDisplayFile } from './photo-image';
import { photoImageCache } from './photo-image-cache';
import { sortPhotos, type PhotoLikes } from './photo-sort';
import { backgroundPhotoLoadingAllowed, PHOTO_PRELOAD_POPULAR_COUNT, PhotoPreloadVisibility } from './photo-preloading';

export function prioritizePhoto(photo: Photo | null) {
  const depth = photo && photoDepthFile(photo);
  photoImageCache.select(photo ? [asset(photoDisplayFile(photo)), ...(depth ? [asset(depth)] : [])] : []);
}

export function usePhotoPreloading(photos: Photo[] | undefined, selected: Photo | null, likes: PhotoLikes, likesReady: boolean, galleryOpen: boolean, catalogPhotos: Photo[]) {
  const visibility = useRef(new PhotoPreloadVisibility());
  const catalog = useRef<HTMLDivElement>(null);
  const ranked = useMemo(() => sortPhotos(photos || [], likesReady ? 'likes' : 'uploaded', photos || [], likes), [photos, likes, likesReady]);
  const reportMapVisible = useCallback((ids: string[]) => visibility.current.update('map', ids, performance.now()), []);
  useEffect(() => { prioritizePhoto(selected); }, [selected]);
  useEffect(() => {
    const root = catalog.current;
    visibility.current.update('catalog', [], performance.now());
    if (!root || !galleryOpen || typeof IntersectionObserver === 'undefined') return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.preloadPhotoId!;
        if (entry.isIntersecting && entry.intersectionRatio >= .6) visible.add(id); else visible.delete(id);
      }
      visibility.current.update('catalog', [...visible], performance.now());
    }, { root, threshold: [.6] });
    root.querySelectorAll('[data-preload-photo-id]').forEach(node => observer.observe(node));
    return () => { observer.disconnect(); visibility.current.update('catalog', [], performance.now()); };
  }, [galleryOpen, catalogPhotos]);
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean; effectiveType?: string } }).connection;
    const update = () => {
      photoImageCache.setAllowed(backgroundPhotoLoadingAllowed({ hidden: document.hidden, online: navigator.onLine, saveData: connection?.saveData, effectiveType: connection?.effectiveType }));
      const popular = likesReady ? ranked.slice(0, PHOTO_PRELOAD_POPULAR_COUNT) : [];
      const visible = new Set(visibility.current.candidates(ranked.map(photo => photo.id), performance.now()));
      photoImageCache.setBackground(selected ? [] : [...popular, ...ranked.filter(photo => visible.has(photo.id))].map(photo => asset(photoDisplayFile(photo))));
    };
    update();
    const timer = window.setInterval(update, 250);
    document.addEventListener('visibilitychange', update); window.addEventListener('online', update); window.addEventListener('offline', update); connection?.addEventListener('change', update);
    return () => {
      window.clearInterval(timer); document.removeEventListener('visibilitychange', update); window.removeEventListener('online', update); window.removeEventListener('offline', update); connection?.removeEventListener('change', update);
    };
  }, [ranked, likesReady, selected]);
  useEffect(() => () => { photoImageCache.select([]); photoImageCache.setBackground([]); }, []);
  return { catalog, reportMapVisible };
}

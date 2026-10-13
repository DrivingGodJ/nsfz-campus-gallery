import { useCallback, useEffect, useMemo, useRef } from 'react';
import { asset, type Photo } from './types';
import { photoLoadFiles } from './photo-image';
import { photoImageCache } from './photo-image-cache';
import { sortPhotos, type PhotoLikes } from './photo-sort';
import { backgroundPhotoLoadingAllowed, PHOTO_PRELOAD_POPULAR_COUNT, PhotoPreloadVisibility } from './photo-preloading';

export function prioritizePhoto(photo: Photo | null) {
  photoImageCache.select(photo ? photoLoadFiles(photo).map(asset) : []);
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
    const visible = new Set<HTMLElement>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        if (entry.isIntersecting && entry.intersectionRatio >= .6) visible.add(element); else visible.delete(element);
      }
      visibility.current.update('catalog', [...new Set([...visible].map(element => element.dataset.preloadPhotoId!))], performance.now());
    }, { root, threshold: [.6] });
    root.querySelectorAll('[data-preload-photo-id]').forEach(node => observer.observe(node));
    return () => { observer.disconnect(); visibility.current.update('catalog', [], performance.now()); };
  }, [galleryOpen, catalogPhotos]);
  useEffect(() => {
    const connection = (navigator as Navigator & { connection?: EventTarget & { saveData?: boolean; effectiveType?: string } }).connection;
    const rankedIds = ranked.map(photo => photo.id);
    const resources = new Map(ranked.map(photo => [photo.id, photoLoadFiles(photo).map(asset)]));
    const popular = likesReady ? ranked.slice(0, PHOTO_PRELOAD_POPULAR_COUNT).flatMap(photo => resources.get(photo.id)!) : [];
    let timer: number | undefined;
    const update = () => {
      const allowed = backgroundPhotoLoadingAllowed({ hidden: document.hidden, online: navigator.onLine, saveData: connection?.saveData, effectiveType: connection?.effectiveType });
      photoImageCache.setAllowed(allowed);
      if (selected || !allowed) {
        if (timer !== undefined) { window.clearInterval(timer); timer = undefined; }
        photoImageCache.setBackground([]); return;
      }
      if (timer === undefined) timer = window.setInterval(update, 250);
      const visible = visibility.current.candidates(rankedIds, performance.now());
      photoImageCache.setBackground([...popular, ...visible.flatMap(id => resources.get(id)!)]);
    };
    update();
    document.addEventListener('visibilitychange', update); window.addEventListener('online', update); window.addEventListener('offline', update); connection?.addEventListener('change', update);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update); window.removeEventListener('online', update); window.removeEventListener('offline', update); connection?.removeEventListener('change', update);
    };
  }, [ranked, likesReady, selected]);
  useEffect(() => () => { photoImageCache.select([]); photoImageCache.setBackground([]); }, []);
  return { catalog, reportMapVisible };
}

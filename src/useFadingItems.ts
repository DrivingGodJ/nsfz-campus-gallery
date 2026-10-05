import { useEffect, useLayoutEffect, useState } from 'react';
import { PHOTO_FADE_MS, reconcileFadingItems, type FadingItem } from './fading-items';

export function useFadingItems<T extends { id: string }>(items: T[]) {
  const [entries, setEntries] = useState<FadingItem<T>[]>(() => items.map(item => ({ item, expiresAt: null })));
  useLayoutEffect(() => {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    setEntries(previous => reconcileFadingItems(previous, items, performance.now(), reduced ? 0 : PHOTO_FADE_MS));
  }, [items]);
  useEffect(() => {
    const deadline = Math.min(...entries.flatMap(entry => entry.expiresAt === null ? [] : [entry.expiresAt]));
    if (!Number.isFinite(deadline)) return;
    const timer = setTimeout(() => setEntries(previous => previous.filter(entry => entry.expiresAt === null || entry.expiresAt > performance.now())), Math.max(1, deadline - performance.now()));
    return () => clearTimeout(timer);
  }, [entries]);
  return entries;
}

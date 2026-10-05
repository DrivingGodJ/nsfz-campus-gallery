export const PHOTO_FADE_MS = 220;
export type FadingItem<T> = { item: T; expiresAt: number | null };

// Keep disappearing items at their original positions until opacity reaches
// zero. Reappearing items cancel their removal instead of mounting again.
export function reconcileFadingItems<T extends { id: string }>(previous: FadingItem<T>[], current: T[], now: number, duration = PHOTO_FADE_MS): FadingItem<T>[] {
  const next = new Map(current.map(item => [item.id, item]));
  const result: FadingItem<T>[] = [];
  for (const entry of previous) {
    const item = next.get(entry.item.id);
    if (item) { result.push({ item, expiresAt: null }); next.delete(item.id); }
    else {
      const expiresAt = entry.expiresAt ?? now + duration;
      if (expiresAt > now) result.push({ ...entry, expiresAt });
    }
  }
  for (const item of next.values()) result.push({ item, expiresAt: null });
  return result;
}

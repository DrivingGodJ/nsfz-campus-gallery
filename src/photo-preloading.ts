export const PHOTO_PRELOAD_DWELL_MS = 1200;
export const PHOTO_PRELOAD_VISIBLE_COUNT = 3;
export const PHOTO_PRELOAD_POPULAR_COUNT = 3;

// A photograph must remain visible continuously. Leaving and returning starts
// a new dwell, while appearing in both the map and catalog keeps the same one.
export class PhotoPreloadVisibility {
  private sources = new Map<string, Set<string>>();
  private since = new Map<string, number>();
  update(source: string, ids: string[], now: number) {
    this.sources.set(source, new Set(ids));
    const visible = new Set([...this.sources.values()].flatMap(ids => [...ids]));
    for (const id of this.since.keys()) if (!visible.has(id)) this.since.delete(id);
    for (const id of visible) if (!this.since.has(id)) this.since.set(id, now);
  }
  candidates(rankedIds: string[], now: number) {
    return rankedIds.filter(id => this.since.has(id) && now - this.since.get(id)! >= PHOTO_PRELOAD_DWELL_MS).slice(0, PHOTO_PRELOAD_VISIBLE_COUNT);
  }
}

export function backgroundPhotoLoadingAllowed(environment: { hidden: boolean; online: boolean; saveData?: boolean; effectiveType?: string }) {
  return !environment.hidden && environment.online && !environment.saveData && !['slow-2g', '2g'].includes(environment.effectiveType || '');
}

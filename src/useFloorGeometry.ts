import { useEffect, useMemo, type DependencyList } from 'react';
import { floorGeometryCache } from './floor-geometry-cache';

export function useFloorGeometry<T>(floor: number | undefined, dependencies: DependencyList, create: () => T) {
  const cache = useMemo(() => floorGeometryCache<T>(), dependencies);
  const value = cache.get(floor, create);
  useEffect(() => { cache.prune(); }, [cache, value]);
  useEffect(() => { cache.retain(); return () => cache.release(); }, [cache]);
  return value;
}

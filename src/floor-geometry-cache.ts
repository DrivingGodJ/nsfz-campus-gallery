import * as THREE from 'three';

function disposeGeometries(value: unknown, disposed = new Set<THREE.BufferGeometry>()) {
  if (value instanceof THREE.BufferGeometry) {
    if (!disposed.has(value)) { disposed.add(value); value.dispose(); }
  } else if (value && typeof value === 'object') {
    if (Array.isArray(value) && typeof value[0] === 'number') return;
    for (const child of Object.values(value)) disposeGeometries(child, disposed);
  }
}

// One mounted building owns four recent floor states. Geometry changes create
// a fresh cache; pruning runs after commit so the live mesh is never disposed.
export function floorGeometryCache<T>() {
  const values = new Map<number | undefined, T>();
  let disposal: ReturnType<typeof setTimeout> | undefined;
  return {
    get(floor: number | undefined, create: () => T) {
      const value = values.has(floor) ? values.get(floor)! : create();
      values.delete(floor); values.set(floor, value);
      return value;
    },
    prune() {
      while (values.size > 4) {
        const oldest = values.keys().next().value;
        disposeGeometries(values.get(oldest)); values.delete(oldest);
      }
    },
    retain() { clearTimeout(disposal); },
    release() {
      // StrictMode replays effect setup after cleanup. Delay disposal one turn
      // so that replay retains the live buffers instead of abandoning them.
      disposal = setTimeout(() => { for (const value of values.values()) disposeGeometries(value); values.clear(); }, 0);
    },
  };
}

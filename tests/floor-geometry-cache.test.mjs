import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { floorGeometryCache } from '../src/floor-geometry-cache.ts';

test('recent floor buffers are reused, bounded, refreshed after eviction and retained through StrictMode cleanup', async () => {
  const cache = floorGeometryCache(), disposed = [], builds = [];
  const create = floor => () => {
    builds.push(floor);
    const geometry = new THREE.BoxGeometry();
    geometry.addEventListener('dispose', () => disposed.push(floor));
    return { body: [geometry], alias: geometry, outline: [1, 2, 3] };
  };
  const first = cache.get(1, create(1));
  for (const floor of [2, 3, 4]) { cache.get(floor, create(floor)); cache.prune(); }
  assert.equal(cache.get(1, create(1)), first, 'Revisiting the recent floor reuses the exact buffers and their BVH');
  cache.get(5, create(5));
  assert.deepEqual(disposed, [], 'Buffers stay alive until the scene commits the replacement');
  cache.prune();
  assert.deepEqual(disposed, [2], 'Only the least recently visited state is evicted, once per geometry');
  cache.release(); cache.retain();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(cache.get(1, create(1)), first, 'StrictMode effect replay cancels cleanup and retains the mounted mesh');
  const recreated = cache.get(2, create(2)); cache.prune();
  assert.notEqual(recreated, first);
  assert.deepEqual(builds, [1, 2, 3, 4, 5, 2]);
  assert.deepEqual(disposed, [2, 3]);
  cache.release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(disposed.sort(), [1, 2, 2, 3, 4, 5], 'Final unmount disposes every retained geometry, including aliased bodies');
  const editedBuilding = floorGeometryCache();
  assert.notEqual(editedBuilding.get(1, create(1)), first, 'New building data receives a fresh cache');
  editedBuilding.release();
});

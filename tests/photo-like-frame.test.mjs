import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoLikeFrame } from '../src/photo-like-frame.ts';

test('photo frames become steadily redder with likes and stay neutral without valid counts', () => {
  const strength = count => parseFloat(photoLikeFrame(count)['--photo-like-red']);
  assert.equal(strength(), 0);
  for (const count of [0, -5, NaN, Infinity]) assert.equal(strength(count), 0);
  const values = [1, 4, 16, 100, 10000].map(strength);
  assert.equal(values[0], 20);
  assert.ok(values.every((value, index) => value > (values[index - 1] ?? 0) && value < 100));
});

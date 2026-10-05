import test from 'node:test';
import assert from 'node:assert/strict';
import { overlayPhotoAlpha, overlayProgress } from '../src/photo-overlay.ts';
import { depthHistogram, depthTransitionFrame, revealFront } from '../src/depth-transition.ts';

test('both depth fronts advance far to near, and exit grows the model instead of retracting the photo', () => {
  const gray = new Uint8Array([0, 20, 70, 120, 180, 240, 255, 255]), histogram = depthHistogram(gray);
  const pixels = (phase, progress) => [...depthTransitionFrame({ gray, width: 8, height: 1, front: revealFront(histogram, progress) }).keep].map(value => overlayPhotoAlpha(phase, value));
  assert.deepEqual(pixels('entering', 0), Array(8).fill(0));
  assert.deepEqual(pixels('entering', 1), Array(8).fill(255));
  assert.deepEqual(pixels('exiting', 0), Array(8).fill(255));
  assert.deepEqual(pixels('exiting', 1), Array(8).fill(0));
  assert.ok(pixels('entering', .5)[7] > pixels('entering', .5)[0], 'entry shows the distant photo first');
  assert.ok(pixels('exiting', .5)[7] < pixels('exiting', .5)[0], 'exit shows the distant model first');
  for (let step = 1; step <= 10; step++) {
    const a = pixels('exiting', (step - 1) / 10), b = pixels('exiting', step / 10);
    b.forEach((alpha, index) => assert.ok(alpha <= a[index], 'model never disappears again during exit'));
  }
});

test('interrupting entry reveals the model from the current partially visible photo', () => {
  for (const base of [0, 60, 127, 255]) {
    assert.equal(overlayPhotoAlpha('exiting', 255, base), base, 'exit starts without a full-photo flash');
    assert.equal(overlayPhotoAlpha('exiting', 0, base), 0);
    assert.ok(overlayPhotoAlpha('exiting', 127, base) <= base);
  }
});

test('wipe progress has smooth bounded endpoints', () => {
  assert.equal(overlayProgress(-1, 1600), 0);
  assert.equal(overlayProgress(0, 1600), 0);
  assert.equal(overlayProgress(800, 1600), .5);
  assert.equal(overlayProgress(1600, 1600), 1);
  assert.equal(overlayProgress(9000, 1600), 1);
});

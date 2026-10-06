import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceOverlayClock, OVERLAY_WAITING_RATE, overlayPhotoAlpha, overlayProgress } from '../src/photo-overlay.ts';
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

test('waiting for an original slows entry without waiting indefinitely', () => {
  const normal = advanceOverlayClock({ elapsed: 0, rate: 1 }, 800, false);
  const waiting = advanceOverlayClock({ elapsed: 0, rate: OVERLAY_WAITING_RATE }, 800, true);
  assert.equal(normal.elapsed, 800);
  assert.ok(overlayProgress(waiting.elapsed, 1600) < overlayProgress(normal.elapsed, 1600));
  const finished = advanceOverlayClock(waiting, 6400 - 800, true);
  assert.equal(overlayProgress(finished.elapsed, 1600), 1, 'a stalled request still lets the photo appear');
});

test('an original becoming ready restores speed continuously without skipping or rewinding', () => {
  const waiting = advanceOverlayClock({ elapsed: 0, rate: OVERLAY_WAITING_RATE }, 1000, true);
  assert.deepEqual(advanceOverlayClock(waiting, 0, false), waiting, 'loading state alone cannot move the reveal front');
  let clock = waiting;
  for (let i = 0; i < 60; i++) {
    const next = advanceOverlayClock(clock, 16, false);
    assert.ok(next.elapsed > clock.elapsed);
    assert.ok(next.elapsed - clock.elapsed <= 16, 'the animation never runs faster than normal to catch up');
    assert.ok(next.rate >= clock.rate && next.rate <= 1);
    clock = next;
  }
  assert.ok(clock.rate > .99, 'normal playback returns promptly');
  assert.ok(advanceOverlayClock(clock, 1000, false).elapsed >= 1600);
});

test('adaptive playback is independent of frame rate and can slow again on retry', () => {
  const start = { elapsed: 200, rate: OVERLAY_WAITING_RATE };
  const whole = advanceOverlayClock(start, 1000, false);
  let split = start;
  for (let i = 0; i < 100; i++) split = advanceOverlayClock(split, 10, false);
  assert.ok(Math.abs(split.elapsed - whole.elapsed) < 1e-8);
  assert.ok(Math.abs(split.rate - whole.rate) < 1e-8);
  const retried = advanceOverlayClock(whole, 16, true);
  assert.ok(retried.rate < whole.rate && retried.rate > OVERLAY_WAITING_RATE);
  assert.ok(retried.elapsed > whole.elapsed);
  assert.deepEqual(advanceOverlayClock(whole, -50, true), whole, 'clock corrections do not move backwards');
});

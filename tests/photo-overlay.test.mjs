import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceOverlayClock, overlayPhotoAlpha, overlayProgress } from '../src/photo-overlay.ts';
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

test('a thumbnail starts entry immediately while incoming display bytes limit its progress', () => {
  const normal = advanceOverlayClock({ elapsed: 0, rate: 1 }, 800, 1);
  const waiting = advanceOverlayClock({ elapsed: 0, rate: 1 }, 800, 0);
  assert.equal(normal.elapsed, 800);
  assert.ok(waiting.elapsed > 0, 'the thumbnail can start before any display bytes arrive');
  const stalled = advanceOverlayClock(waiting, 6400, 0);
  assert.ok(stalled.elapsed <= 160, 'a stalled download cannot finish the transition');
  const downloading = advanceOverlayClock(stalled, 6400, .6);
  assert.ok(downloading.elapsed > stalled.elapsed);
  assert.ok(downloading.elapsed <= 1600 * .6 * .95);
  const decoding = advanceOverlayClock(downloading, 6400, .99);
  assert.ok(overlayProgress(decoding.elapsed, 1600) < 1, 'reserve the end until the display image has decoded');
});

test('the display becoming ready restores speed continuously without skipping or rewinding', () => {
  const waiting = advanceOverlayClock({ elapsed: 0, rate: 1 }, 1000, .25);
  assert.deepEqual(advanceOverlayClock(waiting, 0, 1), waiting, 'loading state alone cannot move the reveal front');
  let clock = waiting;
  for (let i = 0; i < 60; i++) {
    const next = advanceOverlayClock(clock, 16, 1);
    assert.ok(next.elapsed > clock.elapsed);
    assert.ok(next.elapsed - clock.elapsed <= 16, 'the animation never runs faster than normal to catch up');
    assert.ok(next.rate >= clock.rate && next.rate <= 1);
    clock = next;
  }
  assert.ok(clock.rate > .99, 'normal playback returns promptly');
  assert.ok(advanceOverlayClock(clock, 1000, 1).elapsed >= 1600);
});

test('adaptive playback is independent of frame rate and can slow again on retry', () => {
  const start = { elapsed: 200, rate: .25 };
  const whole = advanceOverlayClock(start, 1000, 1);
  let split = start;
  for (let i = 0; i < 100; i++) split = advanceOverlayClock(split, 10, 1);
  assert.ok(Math.abs(split.elapsed - whole.elapsed) < 1e-8);
  assert.ok(Math.abs(split.rate - whole.rate) < 1e-8);
  const retried = advanceOverlayClock(whole, 16, 0);
  assert.ok(retried.rate < whole.rate && retried.rate >= 0);
  assert.ok(retried.elapsed >= whole.elapsed);
  assert.deepEqual(advanceOverlayClock(whole, -50, 0), whole, 'clock corrections do not move backwards');
});

test('changing download progress never makes the animation faster than normal or rewind', () => {
  let clock = { elapsed: 0, rate: 1 };
  for (const loaded of [0, .1, .8, .9, .2, .99, 1]) for (let frame = 0; frame < 50; frame++) {
    const next = advanceOverlayClock(clock, 16, loaded);
    assert.ok(next.elapsed >= clock.elapsed && next.elapsed - clock.elapsed <= 16.0000001);
    assert.ok(next.rate >= 0 && next.rate <= 1);
    clock = next;
  }
});

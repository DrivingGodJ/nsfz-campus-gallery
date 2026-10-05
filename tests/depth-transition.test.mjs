import test from 'node:test';
import assert from 'node:assert/strict';
import { DEPTH_TRANSITION_DEFAULTS, depthGray, depthHistogram, depthLineRadius,
  depthTransitionFrame, depthTransitionLayers, parseLineColor, revealAlpha, revealFront, transitionProgress } from '../src/depth-transition.ts';

const levels = pairs => { const histogram = new Uint32Array(256); for (const [gray, count] of pairs) histogram[gray] = count; return histogram; };
// Everything the front has passed already shows the photo.
const replacedFraction = (histogram, front, direction = 'far') => {
  let replaced = 0, total = 0;
  for (let gray = 0; gray < 256; gray++) {
    total += histogram[gray];
    if (revealAlpha(gray, front, direction, 0) === 1) replaced += histogram[gray];
  }
  return replaced / total;
};
// A tiny frame: `#` keeps the depth map, `.` already shows the photo.
const grid = (rows, width = rows[0].length) => ({ gray: new Uint8Array(rows.join('').split('').map(cell => cell === '#' ? 0 : 255)), width, height: rows.length });
const show = (values, width, height, pick) => Array.from({ length: height }, (_, y) =>
  Array.from({ length: width }, (_, x) => pick(values[y * width + x])).join('')).join('/');

test('the reveal front walks from white to black and paces the sweep by area', () => {
  const histogram = levels([[200, 100], [150, 100], [100, 100], [50, 100]]);
  assert.equal(revealFront(histogram, 0), 255.5, 'nothing is replaced at the start');
  assert.equal(revealFront(histogram, .25), 199.5, 'a level is spent exactly when it is fully replaced');
  assert.equal(revealFront(histogram, .5), 149.5);
  assert.equal(revealFront(histogram, .75), 99.5);
  assert.equal(revealFront(histogram, 1), -.5, 'everything is replaced at the end');
  // The front lands where the replaced area matches the progress, within one
  // level's worth of pixels, and it is fractional so a heavy level fades in.
  for (const progress of [0, .1, .33, .5, .62, .9, 1]) {
    const error = Math.abs(replacedFraction(histogram, revealFront(histogram, progress)) - progress);
    assert.ok(error <= .25 + 1e-9, `progress ${progress} lands within one level (${error})`);
  }
  const heavy = levels([[255, 1600], [128, 200], [8, 200]]);
  const inside = revealFront(heavy, .5);
  assert.ok(inside < 255 && inside > 254, 'a heavy level moves the front through itself');
  let previous = 999;
  for (let step = 0; step <= 40; step++) {
    const front = revealFront(heavy, step / 40);
    assert.ok(front <= previous, 'the front only ever moves towards the near end');
    previous = front;
  }
  assert.equal(revealFront(new Uint32Array(256), .5), 255.5, 'an empty histogram keeps the depth map');
});

test('the near-to-far direction mirrors the sweep', () => {
  const histogram = levels([[200, 100], [150, 100], [100, 100], [50, 100]]);
  assert.equal(revealFront(histogram, 0, 'near'), -.5, 'nothing is replaced at the start');
  assert.equal(revealFront(histogram, .25, 'near'), 50.5, 'the darkest level goes first');
  assert.equal(revealFront(histogram, .75, 'near'), 150.5);
  assert.equal(revealFront(histogram, 1, 'near'), 255.5, 'everything is replaced at the end');
  for (const progress of [0, .2, .5, .8, 1]) {
    const error = Math.abs(replacedFraction(histogram, revealFront(histogram, progress, 'near'), 'near') - progress);
    assert.ok(error <= .25 + 1e-9, `progress ${progress} lands within one level (${error})`);
  }
  assert.equal(revealAlpha(50, 50.5, 'near'), 1, 'the near end is revealed first');
  assert.equal(revealAlpha(200, 50.5, 'near'), 0, 'the far end still holds the depth map');
});

test('the photo alpha ramps over the configured softness', () => {
  assert.equal(revealAlpha(200, 100), 1, 'the far side is fully replaced');
  assert.equal(revealAlpha(0, 100), 0, 'the near side is untouched');
  assert.equal(revealAlpha(100, 100), .5, 'the front level is halfway');
  assert.equal(revealAlpha(100, 100.5), 0);
  assert.equal(revealAlpha(100, 99.5), 1);
  // A wider ramp dissolves instead of cutting, and 0 gives a hard edge.
  assert.equal(revealAlpha(101, 100, 'far', 4), .75);
  assert.equal(revealAlpha(98, 100, 'far', 4), 0);
  assert.equal(revealAlpha(100, 100, 'far', 0), 0);
  assert.equal(revealAlpha(101, 100, 'far', 0), 1);
  assert.equal(revealAlpha(50, 50, 'near', 0), 0);
  assert.equal(revealAlpha(49, 50, 'near', 0), 1);
});

test('the frame keeps the depth map ahead of the front', () => {
  const { gray, width, height } = grid(['#####', '#####']);
  const { keep } = depthTransitionFrame({ gray, width, height, front: 255.5 });
  assert.ok(keep.every(alpha => alpha === 255), 'nothing is replaced while the front is at white');
  const swept = depthTransitionFrame({ gray, width, height, front: -.5 });
  assert.ok(swept.keep.every(alpha => alpha === 0), 'everything is replaced once the front passes black');
  const split = grid(['###..', '###..'], 5);
  const partial = depthTransitionFrame({ ...split, front: 127.5 });
  assert.equal(show(partial.keep, 5, 2, alpha => alpha === 0 ? '.' : '#'), '###../###..');
  const soft = depthTransitionFrame({ ...split, front: 127.5, softness: 4 });
  assert.equal(soft.keep[0], 255); assert.equal(soft.keep[3], 0);
});

test('the blue edge hugs the boundary on the side that still shows the depth map', () => {
  const frame = grid(['.......', '.......', '#######', '#######', '#######'], 7);
  const { line } = depthTransitionFrame({ ...frame, front: 127.5, radius: 3 });
  // The seam sits after row 1; the line stays inside the kept rows below it and
  // never bleeds onto the replaced rows above.
  assert.equal(show(line, 7, 5, alpha => alpha === 255 ? 'C' : alpha > 0 ? 'h' : '.'), [
    '.......',
    '.......',
    'CCCCCCC',
    'CCCCCCC',
    'hhhhhhh',
  ].join('/'));
  // A vertical seam is treated the same way, with the same core and halo.
  const columns = grid(['..###', '..###'], 5);
  const vertical = depthTransitionFrame({ ...columns, front: 127.5, radius: 3 });
  assert.equal(show(vertical.line, 5, 2, alpha => alpha === 255 ? 'C' : alpha > 0 ? 'h' : '.'), '..CCh/..CCh');
  // The width scales with the render size and stays a line, not a wash.
  assert.equal(depthLineRadius(866), 8);
  assert.equal(depthLineRadius(200), 2);
  assert.equal(depthLineRadius(1000, 2), 20);
  assert.equal(depthLineRadius(100, .5), 2, 'the edge never collapses');
  const wide = depthTransitionFrame({ ...frame, front: 127.5, radius: depthLineRadius(866) });
  assert.equal(show(wide.line, 7, 5, alpha => alpha > 0 ? 'h' : '.'), '......./......./hhhhhhh/hhhhhhh/hhhhhhh');
  // A level that is still fading in already counts as arrived, so the line sits
  // on the leading edge instead of waiting for the level to finish.
  const fading = { gray: new Uint8Array([0, 0, 0, 128, 128, 128]), width: 3, height: 2 };
  const soft = depthTransitionFrame({ ...fading, front: 127.9, radius: 2 });
  assert.deepEqual([...soft.keep], [255, 255, 255, 102, 102, 102], 'the dark row is untouched, the bright row is mid-fade');
  assert.deepEqual([...soft.line], [255, 255, 255, 0, 0, 0], 'the edge covers the untouched row along the seam');
});

test('the edge width, solid share and halo strength are configurable', () => {
  const frame = grid(['....', '####', '####', '####', '####'], 4);
  // The seam runs along the top row, so the reach walks down the rows.
  const rows = measured => [1, 2, 3, 4].map(row => measured.line[row * 4]);
  assert.deepEqual(rows(depthTransitionFrame({ ...frame, front: 127.5, radius: 4, core: 100, glow: 200 })), [255, 255, 255, 255], 'a 100% core stays solid the whole reach');
  assert.deepEqual(rows(depthTransitionFrame({ ...frame, front: 127.5, radius: 4, core: 20, glow: 30 })), [255, 30, 30, 30], 'the rest of the reach keeps the halo strength');
  assert.deepEqual(rows(depthTransitionFrame({ ...frame, front: 127.5, radius: 4, core: 20, glow: 0 })), [255, 0, 0, 0], 'a zero halo leaves only the solid core');
  assert.deepEqual(rows(depthTransitionFrame({ ...frame, front: 127.5, radius: 2, core: 20, glow: 30 })), [255, 30, 0, 0], 'the reach follows the configured width');
});

test('the transition eases over its duration and never cuts to the end early', () => {
  assert.equal(transitionProgress(0), 0);
  assert.equal(transitionProgress(DEPTH_TRANSITION_DEFAULTS.duration), 1);
  assert.equal(transitionProgress(DEPTH_TRANSITION_DEFAULTS.duration * 4), 1, 'the end state is stable');
  assert.equal(transitionProgress(-50), 0);
  // The wipe is the feature itself, is user initiated and its duration is a
  // setting, so an OS reduced-motion preference must not collapse it into a cut.
  assert.ok(transitionProgress(16, DEPTH_TRANSITION_DEFAULTS.duration) < .001, 'the first frame still starts at the beginning');
  assert.equal(transitionProgress(1200, 0), 1, 'a zero duration completes immediately');
  assert.ok(Math.abs(transitionProgress(DEPTH_TRANSITION_DEFAULTS.duration / 2) - .5) < 1e-9, 'the ease is symmetric');
  assert.equal(transitionProgress(1200, 4800, 'linear'), .25, 'linear keeps the clock');
  assert.equal(transitionProgress(1200, 4800), .0625, 'smooth starts slower');
  let previous = -1;
  for (let step = 0; step <= 20; step++) {
    const value = transitionProgress(DEPTH_TRANSITION_DEFAULTS.duration * step / 20);
    assert.ok(value >= previous, 'progress never goes backwards');
    previous = value;
  }
});

test('the composite only backfills the unreached side when the depth map is the background', () => {
  // The photo is always painted and punched out, and the edge always lands last;
  // dropping the middle fill is precisely what lets the model show through.
  assert.deepEqual(depthTransitionLayers('depth'), ['photo', 'depth', 'line']);
  assert.deepEqual(depthTransitionLayers('model'), ['photo', 'line']);
  assert.deepEqual(depthTransitionLayers(), depthTransitionLayers(DEPTH_TRANSITION_DEFAULTS.background));
  for (const background of ['depth', 'model']) {
    const layers = depthTransitionLayers(background);
    assert.equal(layers[0], 'photo', 'the photo is always the base layer');
    assert.equal(layers.at(-1), 'line', 'the blue edge is always on top');
  }
});

test('the line colour accepts hex with or without a hash and falls back to the theme colour', () => {
  assert.deepEqual(parseLineColor('#2f7bff'), { r: 47, g: 123, b: 255 });
  assert.deepEqual(parseLineColor('2F7BFF'), { r: 47, g: 123, b: 255 });
  assert.deepEqual(parseLineColor('#f80'), { r: 255, g: 136, b: 0 });
  assert.deepEqual(parseLineColor(''), { r: 52, g: 79, b: 62 });
  assert.deepEqual(parseLineColor('chartreuse'), { r: 52, g: 79, b: 62 });
  assert.equal(DEPTH_TRANSITION_DEFAULTS.color, '#344f3e');
});

test('the gray channel and its histogram describe the rendered depth frame', () => {
  const pixels = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]);
  const gray = depthGray(pixels);
  assert.deepEqual([...gray], [255, 0, 255, 128]);
  const histogram = depthHistogram(gray);
  assert.equal(histogram[255], 2); assert.equal(histogram[0], 1); assert.equal(histogram[128], 1);
  assert.equal(histogram.reduce((total, count) => total + count, 0), gray.length);
});

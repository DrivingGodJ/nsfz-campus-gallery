import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_PALETTES, skyTime, skyEnvironment, skyDomeRadius, photoSkyTime, skyTransitionBlend } from '../src/sky-environment.ts';
import { timeMapColor } from '../src/time-palette.ts';

test('sky follows the selected capture period and falls back to the system appearance', () => {
  assert.equal(skyTime('light', ''), 'day');
  assert.equal(skyTime('dark', ''), 'night');
  for (const time of ['dawn', 'day', 'dusk', 'night', 'unknown']) {
    assert.deepEqual(skyEnvironment('dark', 'autumn', time), skyEnvironment('light', 'autumn', time));
  }
  assert.equal(skyTime('dark', 'unknown'), 'day');
});

test('horizon ground matches the map across all seasons, times and themes', () => {
  for (const theme of ['light', 'dark']) for (const season of ['', 'spring', 'summer', 'autumn', 'winter']) {
    for (const time of ['', 'dawn', 'day', 'dusk', 'night', 'unknown']) {
      assert.equal(skyEnvironment(theme, season, time).ground, timeMapColor(theme, season, time, '#eeeee5'));
    }
  }
});

test('the four skies are distinct, with low morning/evening sun and a night moon', () => {
  assert.equal(new Set(Object.values(SKY_PALETTES).map(p => p.zenith)).size, 4);
  for (const period of ['dawn', 'dusk']) assert.ok(SKY_PALETTES[period].direction[1] < .15);
  assert.equal(SKY_PALETTES.day.stars, 0);
  assert.equal(SKY_PALETTES.night.stars, 1);
  assert.equal(SKY_PALETTES.night.moon, 1);
});

test('the camera-centred dome fits the clipping range at both near and distant viewpoints', () => {
  for (const [near, far] of [[.5, 4000], [.1, 500], [1, 10000]]) {
    const radius = skyDomeRadius(near, far);
    assert.ok(radius > near && radius < far);
  }
});

test('photo previews use their own capture clock without changing or erasing the map filter', () => {
  const mapTime = 'dusk';
  for (const [clock, period] of [['06:00', 'dawn'], ['12:00', 'day'], ['18:59', 'dusk'], ['19:00', 'night'], ['23:00', 'night']]) {
    const photo = { capturedAt: '2026-10-05T' + clock + ':00+08:00' };
    const original = JSON.stringify(photo);
    assert.equal(photoSkyTime(mapTime, photo), period);
    assert.equal(JSON.stringify(photo), original);
  }
  for (const capturedAt of [undefined, '', '2026-10-05', 'invalid']) assert.equal(photoSkyTime(mapTime, { capturedAt }), mapTime);
  assert.equal(photoSkyTime(mapTime, null), mapTime, 'Closing restores the original map time');
  assert.equal(photoSkyTime('', { capturedAt: '2026-10-05' }), '');
});

test('photo and filtered views share the whole time appearance, including night ground and model materials', () => {
  for (const theme of ['light', 'dark']) for (const season of ['', 'spring', 'summer', 'autumn', 'winter']) {
    for (const [clock, period] of [['06:00', 'dawn'], ['12:00', 'day'], ['18:59', 'dusk'], ['19:00', 'night']]) {
      const photo = { capturedAt: '2026-10-05T' + clock };
      const effectiveTime = photoSkyTime('day', photo);
      const photoEnvironment = skyEnvironment(theme, season, effectiveTime);
      assert.deepEqual(photoEnvironment, skyEnvironment(theme, season, period));
      assert.equal(photoEnvironment.ground, timeMapColor(theme, season, effectiveTime, '#eeeee5'));
      for (const color of ['#d7d2c3', '#cfd5bd', '#b5cbc7', '#798e65']) {
        assert.equal(timeMapColor(theme, season, effectiveTime, color), timeMapColor(theme, season, period, color));
      }
    }
  }
});

test('sky transitions do not jump after idle time and remain smooth at different frame rates', () => {
  assert.ok(skyTransitionBlend(300, true) < .12);
  assert.ok(skyTransitionBlend(300, false) < .3);
  assert.equal(skyTransitionBlend(-1, false), 0);
  assert.equal(skyTransitionBlend(NaN, true), 0);
  assert.equal(skyTransitionBlend(300, true, true), 1);
  for (const fps of [30, 60, 120]) {
    let value = 0;
    for (let frame = 0; frame < fps; frame++) value += (1 - value) * skyTransitionBlend(1 / fps, frame === 0);
    assert.ok(value > .998 && value < 1, 'One second approaches the target without an instant snap');
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { SKY_PALETTES, skyTime, skyEnvironment, skyDomeRadius } from '../src/sky-environment.ts';
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

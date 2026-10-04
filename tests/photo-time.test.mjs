import test from 'node:test';
import assert from 'node:assert/strict';
import { photoTime, photosInTime } from '../src/photo-time.ts';
import { timeMapColor, TIME_LIGHTING } from '../src/time-palette.ts';
import { photosInSeason } from '../src/photo-season.ts';
import { mapInteractionHelp } from '../src/input-mode.ts';

test('capture clock classification handles every boundary, midnight, missing times and invalid dates', () => {
  for (const [clock, expected] of [['00:00','night'],['04:59','night'],['05:00','dawn'],['07:59','dawn'],['08:00','day'],['16:59','day'],['17:00','dusk'],['19:59','dusk'],['20:00','night'],['23:59','night']]) {
    assert.equal(photoTime({ capturedAt: '2026-10-04T' + clock }), expected);
    assert.equal(photoTime({ capturedAt: '2026-10-04T' + clock + ':00+08:00' }), expected, 'Recorded clock does not shift with timezone');
  }
  for (const capturedAt of ['', '2026-10-04', 'bad', '2026-02-29T12:00', '2026-10-04T24:00', '2026-10-04T15:60', '2026-10-04T15:00:60']) assert.equal(photoTime({ capturedAt }), 'unknown');
});

test('time and season filters compose, preserve originals and retain missing times in the full list', () => {
  const photos = [{ id:1,capturedAt:'2026-10-04T05:00' },{ id:2,capturedAt:'2026-10-04T22:00' },{ id:3,capturedAt:'2026-01-04T22:00' },{ id:4,capturedAt:'2026-10-04' }];
  const before = JSON.stringify(photos);
  assert.deepEqual(photosInTime(photosInSeason(photos,'autumn'),'night').map(p=>p.id),[2]);
  assert.deepEqual(photosInTime(photos,'unknown').map(p=>p.id),[4]);
  assert.equal(photosInTime(photos,''),photos); assert.equal(JSON.stringify(photos),before);
});

test('every selected time uses identical materials under both themes and still reflects seasons', () => {
  for (const time of ['dawn','day','dusk','night','unknown']) for (const season of ['','spring','summer','autumn','winter']) for (const color of ['#eeeee5','#d7d2c3','#b5cbc7','#798e65','#348bac','#91a7bf']) {
    assert.equal(timeMapColor('light',season,time,color),timeMapColor('dark',season,time,color));
  }
  assert.notEqual(timeMapColor('light','','','#eeeee5'),timeMapColor('dark','','','#eeeee5'));
  assert.notEqual(timeMapColor('light','winter','dusk','#798e65'),timeMapColor('light','summer','dusk','#798e65'));
  assert.equal(new Set(Object.keys(TIME_LIGHTING).map(time=>timeMapColor('light','',time,'#eeeee5'))).size,4);
});

test('interaction instructions match touch, mouse and fixed versus editable preview modes', () => {
  assert.match(mapInteractionHelp('touch','map'),/单指.*双指/);
  assert.doesNotMatch(mapInteractionHelp('touch','map'),/滚轮|右键/);
  assert.match(mapInteractionHelp('mouse','map'),/左键.*滚轮.*右键/);
  assert.doesNotMatch(mapInteractionHelp('touch','preview'),/拖动|Esc/);
  assert.match(mapInteractionHelp('touch','editing'),/单指拖动/);
});

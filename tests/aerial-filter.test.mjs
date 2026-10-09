import test from 'node:test';
import assert from 'node:assert/strict';
import { AERIAL_LOCATION_FILTER, photosAtLocation } from '../src/locations.ts';
import { photoMarkerColors } from '../src/photo-marker-colors.ts';
import { timeMapColor } from '../src/time-palette.ts';

const ground = { id: 'ground', captureType: 'ground', locationId: 'building', floor: 2 };
const aerial = { id: 'aerial', captureType: 'aerial', locationId: 'lake', floor: 0 };
const legacyAerial = { id: 'legacy', buildingId: 'building', floor: 0, metadata: { aerial: { relativeAltitude: 30 } } };
const correctedGround = { ...ground, id: 'corrected', metadata: legacyAerial.metadata };

test('aerial directory filter spans locations and recognizes legacy imports without overriding an explicit ground annotation', () => {
  const photos = [ground, aerial, legacyAerial, correctedGround];
  const before = JSON.stringify(photos);
  assert.deepEqual(photosAtLocation(photos, AERIAL_LOCATION_FILTER), [aerial, legacyAerial]);
  assert.deepEqual(photosAtLocation(photos, AERIAL_LOCATION_FILTER, 2), [aerial, legacyAerial], 'Aerial views are not restricted to building floors');
  assert.deepEqual(photosAtLocation(photos, 'building', 2), [ground, correctedGround]);
  assert.deepEqual(photosAtLocation(photos, ''), photos, 'Clearing the filter restores every photo');
  assert.deepEqual(photosAtLocation([ground], AERIAL_LOCATION_FILTER), [], 'No aerial images produces an empty result');
  assert.equal(JSON.stringify(photos), before, 'Filtering never changes photo annotations');
});

test('aerial arrows and frames stay distinct in every season, time and system theme', () => {
  const air = photoMarkerColors(aerial), land = photoMarkerColors(ground);
  assert.deepEqual(photoMarkerColors(legacyAerial), air);
  assert.deepEqual(photoMarkerColors(correctedGround), land);
  for (const theme of ['light', 'dark']) for (const season of ['', 'spring', 'summer', 'autumn', 'winter']) for (const time of ['', 'dawn', 'day', 'dusk', 'night']) {
    for (const role of ['direction', 'border', 'selected']) {
      assert.notEqual(timeMapColor(theme, season, time, air[role]), timeMapColor(theme, season, time, land[role]), `${role} in ${theme}/${season}/${time}`);
    }
  }
});

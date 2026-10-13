import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AERIAL_LOCATION_FILTER, photoLocationId, photoLocationText, photosAtLocation, withoutAerialLocation } from '../src/locations.ts';
import { regionPhotoClusters } from '../src/photo-clusters.ts';
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
  assert.deepEqual(photosAtLocation(photos, 'building'), [ground, correctedGround], 'Aerial photos have no building association even in legacy records');
  assert.deepEqual(photosAtLocation(photos, ''), photos, 'Clearing the filter restores every photo');
  assert.deepEqual(photosAtLocation([ground], AERIAL_LOCATION_FILTER), [], 'No aerial images produces an empty result');
  assert.equal(JSON.stringify(photos), before, 'Filtering never changes photo annotations');
});

test('aerial arrows and accents stay distinct in every season, time and system theme', () => {
  const air = photoMarkerColors(aerial), land = photoMarkerColors(ground);
  assert.deepEqual(photoMarkerColors(legacyAerial), air);
  assert.deepEqual(photoMarkerColors(correctedGround), land);
  for (const theme of ['light', 'dark']) for (const season of ['', 'spring', 'summer', 'autumn', 'winter']) for (const time of ['', 'dawn', 'day', 'dusk', 'night']) {
    for (const role of ['direction', 'border', 'selected']) {
      assert.notEqual(timeMapColor(theme, season, time, air[role]), timeMapColor(theme, season, time, land[role]), `${role} in ${theme}/${season}/${time}`);
    }
  }
});

test('aerial photos omit place fields while retaining physical map cards and coordinates', () => {
  const campus = { buildings: [{ id: 'building', name: '校史馆', floors: 3, center: [0, 0],
    outer: [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]], holes: [] }], features: [] };
  const site = { buildingOverrides: {}, photos: [] };
  for (const photo of [aerial, legacyAerial]) {
    assert.equal(photoLocationText(photo, campus, site), '校园 · 航拍');
    assert.equal(photoLocationId(photo, campus), '');
    const clean = withoutAerialLocation(photo), expected = { ...photo };
    delete expected.locationId; delete expected.buildingId;
    assert.deepEqual(clean, expected);
    assert.equal(Object.hasOwn(clean, 'locationId'), false); assert.equal(Object.hasOwn(clean, 'buildingId'), false);
  }
  assert.equal(withoutAerialLocation(correctedGround), correctedGround);
  assert.equal(photoLocationText(ground, campus, site), '校史馆 · 2 楼');
  const shots = [0, 1].map(x => ({ ...aerial, id: String(x), locationId: 'building', position: { x, z: 0, height: 80 } }));
  const before = structuredClone(shots);
  for (const z of [40, 200]) {
    const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
    camera.position.set(0, 80, z); camera.lookAt(0, 80, 0); camera.updateMatrixWorld();
    const clusters = regionPhotoClusters(shots, camera, { width: 900, height: 600 }, [], { campus, site });
    assert.ok(clusters.length);
    assert.ok(clusters.every(cluster => cluster.regionName === '航拍' && cluster.regionId.startsWith('outdoor/')));
    for (const cluster of clusters) assert.ok(shots.some(photo => cluster.position.equals(new THREE.Vector3(photo.position.x, photo.position.height, photo.position.z))));
    assert.deepEqual(clusters.flatMap(cluster => cluster.photos.map(photo => photo.id)).sort(), ['0', '1']);
  }
  assert.deepEqual(shots, before);
});

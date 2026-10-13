import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildingFloorCutoff, buildingPhotosThroughFloor, expandedPhotoBuildings } from '../src/map-floor-filter.ts';
import { FULL_MAP_VIEWPORT, mapObjectFocusPose } from '../src/map-card-viewport.ts';
import { mapLocationTarget } from '../src/location-geometry.ts';

const shape = (x, z, width, depth) => ({ outer: [[x, z], [x + width, z], [x + width, z + depth], [x, z + depth], [x, z]], holes: [] });
const teaching = { id: 'teaching', name: '主教学楼', floors: 5, floorHeight: 3.6, baseElevation: 3.6, ...shape(0, 0, 10, 10),
  parts: [{ id: 'main', name: '主楼', ...shape(0, 0, 10, 10) }, { id: 'wing', name: '副楼', floors: 6, ...shape(10, 0, 10, 10) }] };
const other = { id: 'other', name: '另一栋', floors: 8, ...shape(100, 0, 20, 20) };
const campus = { buildings: [teaching, other], features: [], buildingAliases: { oldTeaching: 'teaching' } };
const site = { buildingOverrides: {}, photos: [] };
const shot = (id, floor, height, x = 5, z = 5, buildingId = 'teaching') => ({ id, buildingId, floor, position: { x, z, height } });
const fitBuilding = (campus, site, id, size = { width: 900, height: 600 }, viewport = FULL_MAP_VIEWPORT) => {
  const camera = new THREE.PerspectiveCamera(43, size.width / size.height, .08, 2000), destination = mapLocationTarget(campus, site, id);
  const pose = mapObjectFocusPose({ position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
    target: new THREE.Vector3(), fov: camera.fov, near: camera.near }, new THREE.Vector3(...destination.target), destination.bounds, camera.aspect, viewport);
  camera.position.copy(pose.position); camera.quaternion.copy(pose.quaternion); camera.updateMatrixWorld();
  return camera;
};

test('floor cutoff uses absolute raised elevation and the tallest wing, including override heights', () => {
  assert.equal(buildingFloorCutoff(campus, site, 'teaching', 3), 14.4);
  assert.equal(buildingFloorCutoff(campus, site, 'oldTeaching', 6), 25.200000000000003);
  assert.equal(buildingFloorCutoff(campus, site, 'teaching', 99), buildingFloorCutoff(campus, site, 'teaching', 6));
  const overridden = { ...site, buildingOverrides: { teaching: { name: '主楼', floors: 4, floorHeight: 4, partFloors: { wing: 7 } } } };
  assert.equal(buildingFloorCutoff(campus, overridden, 'teaching', 3), 15.6);
  assert.equal(buildingFloorCutoff(campus, overridden, 'teaching', 7), 31.6);
  for (const floor of [0, -1, NaN, Infinity]) assert.equal(buildingFloorCutoff(campus, site, 'teaching', floor), undefined);
  assert.equal(buildingFloorCutoff(campus, site, 'missing', 3), undefined);
});

test('the selected floor retains all floors below it, not just that floor, and leaves other locations and aerial photos intact', () => {
  const photos = [shot('first', 1, 5.2), shot('second', 2, 8.8), shot('third', 3, 12.4), shot('fourth', 4, 16),
    shot('other-building', 6, 20, 110, 5, 'other'), { ...shot('feature', 5, 20), locationId: 'forest' },
    { ...shot('aerial', 5, 80), captureType: 'aerial' }, { ...shot('legacy-aerial', 5, 80), metadata: { aerial: { relativeAltitude: 80 } } },
    shot('basement', -1, 0), { ...shot('legacy-alias', 3, 12.4), buildingId: 'oldTeaching' }];
  const before = JSON.stringify(photos);
  const kept = buildingPhotosThroughFloor(photos, campus, site, 'oldTeaching', 3);
  assert.deepEqual(kept.map(photo => photo.id), ['first', 'second', 'third', 'other-building', 'feature', 'aerial', 'legacy-aerial', 'basement', 'legacy-alias']);
  assert.ok(kept.every(photo => photos.includes(photo)), 'Filtering must return the original records');
  assert.equal(JSON.stringify(photos), before);
  assert.equal(buildingPhotosThroughFloor(photos, campus, site, 'teaching', 0), photos);
  assert.equal(buildingPhotosThroughFloor(photos, campus, site, 'missing', 3), photos);
});

test('unmarked photos in either building wing follow the actual height while outdoor zero/missing floor records remain visible', () => {
  const photos = [shot('unmarked-lower', undefined, 12.4, 5, 5, ''), shot('unmarked-upper', undefined, 16, 5, 5, ''),
    shot('wing-upper', 0, 16, 15, 5, ''), shot('wing-lower', 0, 12.4, 15, 5, ''),
    shot('cut-plane', 0, 14.4, 15, 5, ''), shot('outdoor-zero', 0, 30, 50, 50, ''),
    shot('outdoor-missing', undefined, 30, 50, 50, ''), shot('unmarked-other', undefined, 30, 110, 5, '')];
  assert.deepEqual(buildingPhotosThroughFloor(photos, campus, site, 'teaching', 3).map(photo => photo.id),
    ['unmarked-lower', 'wing-lower', 'cut-plane', 'outdoor-zero', 'outdoor-missing', 'unmarked-other']);
});

test('courtyard holes stay outdoors and an overlapping smaller building owns its unassigned photos', () => {
  const courtyard = { id: 'courtyard', name: '带天井教学楼', floors: 5, ...shape(0, 0, 30, 30), holes: [shape(10, 10, 10, 10).outer] };
  const small = { id: 'small', name: '独立小房间', floors: 8, ...shape(2, 2, 4, 4) };
  const localCampus = { buildings: [courtyard, small], features: [] };
  const photos = [shot('courtyard-outside', 0, 30, 15, 15, ''), shot('small-building', 0, 25, 4, 4, ''), shot('big-building', 0, 25, 25, 25, '')];
  assert.deepEqual(buildingPhotosThroughFloor(photos, localCampus, site, 'courtyard', 3).map(photo => photo.id), ['courtyard-outside', 'small-building']);
});

test('floor controls use uncut source photos, stay recoverable below their only photographed storey, and disappear away from the building', () => {
  const photos = [shot('only-sixth', 6, 23.2, 15, 5)], size = { width: 900, height: 600 };
  const camera = fitBuilding(campus, site, 'teaching', size);
  assert.equal(buildingPhotosThroughFloor(photos, campus, site, 'teaching', 3).length, 0);
  const [visible] = expandedPhotoBuildings(photos, campus, site, camera, size);
  assert.equal(visible.id, 'teaching');
  assert.deepEqual(expandedPhotoBuildings(photos, campus, site, camera, size, { left: 0, top: 0, width: 1, height: .02 }), [], 'A building fully hidden by a card cannot host a visible map control');
  const center = new THREE.Vector3(...mapLocationTarget(campus, site, 'teaching').target);
  camera.position.sub(center).multiplyScalar(5).add(center); camera.updateMatrixWorld();
  assert.deepEqual(expandedPhotoBuildings(photos, campus, site, camera, size), []);
  assert.equal(expandedPhotoBuildings(photos, campus, site, camera, size, undefined, photos[0].id)[0].id, 'teaching', 'A selected building-photo region remains expanded beyond the approach threshold');
  camera.lookAt(camera.position.clone().add(camera.position.clone().sub(center))); camera.updateMatrixWorld();
  assert.deepEqual(expandedPhotoBuildings(photos, campus, site, camera, size, undefined, photos[0].id), [], 'Selection does not keep a control for a building behind the camera');
});

test('expanded building controls share alias and footprint ownership and include every wing at the fitted view', () => {
  const photos = [{ ...shot('legacy', 3, 12.4), buildingId: 'oldTeaching' }, shot('wing', 0, 12, 15, 5, ''), shot('other', 6, 20, 110, 5, 'other')];
  const camera = fitBuilding(campus, site, 'teaching');
  const expanded = expandedPhotoBuildings(photos, campus, site, camera, { width: 900, height: 600 });
  assert.deepEqual(expanded.map(item => item.id), ['teaching']);
  assert.equal(expandedPhotoBuildings([photos[1]], campus, site, camera, { width: 900, height: 600 })[0].id, 'teaching');
  assert.deepEqual(expandedPhotoBuildings(photos, campus, site, camera, { width: 0, height: 600 }), []);
});

test('the floor control follows the facing expanded region when a closer neighbouring building is also within range', () => {
  const front = { id: 'front', name: '前方楼', floors: 4, ...shape(-45, -10, 90, 20) };
  const side = { id: 'side', name: '侧方楼', floors: 4, ...shape(14, 50, 20, 20) };
  const data = { buildings: [front, side], features: [] }, photos = [shot('front', 1, 1.6, 0, 0, 'front'), shot('side', 1, 1.6, 15, 51, 'side')];
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
  camera.position.set(0, 12, 80); camera.lookAt(0, 7.32, 0); camera.updateMatrixWorld();
  assert.deepEqual(expandedPhotoBuildings(photos, data, site, camera, { width: 900, height: 600 }).map(item => item.id), ['front']);
  camera.lookAt(24, 7.32, 60); camera.updateMatrixWorld();
  assert.deepEqual(expandedPhotoBuildings(photos, data, site, camera, { width: 900, height: 600 }).map(item => item.id), ['side']);
});

test('buildings with unknown or only one floor never use the model default as a reason to expose a slider', () => {
  const size = { width: 900, height: 600 };
  const unknown = { id: 'unknown', name: '未知层数', floors: null, ...shape(0, 0, 10, 10) };
  const one = { id: 'one', name: '一层', floors: 1, ...shape(12, 0, 10, 10) };
  const data = { buildings: [unknown, one], features: [] }, photos = [shot('unknown-photo', 0, 1.6, 5, 5, unknown.id), shot('one-photo', 1, 1.6, 15, 5, one.id)];
  const camera = fitBuilding(data, site, 'unknown', size);
  assert.deepEqual(expandedPhotoBuildings(photos, data, site, camera, size), []);
  const overridden = { ...site, buildingOverrides: { unknown: { name: unknown.name, floors: 2, floorHeight: 3.6 } } };
  assert.deepEqual(expandedPhotoBuildings(photos, data, overridden, fitBuilding(data, overridden, 'unknown', size), size).map(item => item.id), ['unknown']);
  const wing = { ...unknown, parts: [{ id: 'wing', name: '副楼', floors: 2, ...shape(0, 0, 10, 10) }] };
  const wingData = { ...data, buildings: [wing, one] };
  assert.equal(expandedPhotoBuildings(photos, wingData, site, fitBuilding(wingData, site, 'unknown', size), size)[0].id, 'unknown');
});

test('cached building ownership follows edited photo coordinates, location and replaced building overrides', () => {
  const photo = shot('editable', 0, 30, 5, 5, '');
  const ids = () => buildingPhotosThroughFloor([photo], campus, site, 'teaching', 3).map(item => item.id);
  assert.deepEqual(ids(), []);
  photo.position.x = 110;
  assert.deepEqual(ids(), ['editable'], 'Moving to another footprint must clear inferred ownership');
  photo.buildingId = 'teaching';
  assert.deepEqual(ids(), [], 'An explicit location change takes effect immediately');
  const data = { buildings: [{ id: 'editable-building', name: '可编辑楼', floors: 1, ...shape(0, 0, 10, 10) }], features: [] };
  const localSite = { buildingOverrides: {} }, shots = [shot('local', 1, 2, 5, 5, 'editable-building')];
  const camera = fitBuilding(data, localSite, 'editable-building');
  assert.deepEqual(expandedPhotoBuildings(shots, data, localSite, camera, { width: 900, height: 600 }), []);
  localSite.buildingOverrides = { 'editable-building': { floors: 3 } };
  assert.equal(expandedPhotoBuildings(shots, data, localSite, fitBuilding(data, localSite, 'editable-building'), { width: 900, height: 600 })[0].id, 'editable-building');
});

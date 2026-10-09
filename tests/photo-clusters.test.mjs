import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cameraPhotoClusters, clusterFocus, clusterReadyToPick, collagePhotos, permanentPhotoSpots, PHOTO_MARKER_LIFT, PHOTO_POINT_LIFT, photoPointVisible, visiblePhotoPoints } from '../src/photo-clusters.ts';
import { photoSeason, photosInSeason } from '../src/photo-season.ts';

const photo = (id, x, z = 0, height = 1.6) => ({ id, position: { x, z, height }, capturedAt: '2025-04-18' });
const cameraAt = distance => {
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
  camera.position.set(0, distance, distance * .7); camera.lookAt(0, 1.6 + PHOTO_MARKER_LIFT, 0); camera.updateMatrixWorld();
  return camera;
};
const size = { width: 900, height: 600 };

test('all twelve shooting months map to northern hemisphere seasons; missing or invalid dates stay uncategorized', () => {
  const expected = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
  expected.forEach((season, i) => assert.equal(photoSeason({ capturedAt: `2025-${String(i + 1).padStart(2, '0')}-15` }), season));
  for (const capturedAt of ['', 'not a date', '2025-13-01', '2025-02-29', '2025-04-31', '2025-00-10']) assert.equal(photoSeason({ capturedAt }), 'unknown');
  assert.equal(photoSeason({ capturedAt: '2024-02-29T23:59:59-12:00' }), 'winter');
  assert.equal(photoSeason({ capturedAt: '2025-05-31T23:59:59-12:00' }), 'spring', 'Use the shooting month, not the UTC month');
});

test('season filtering composes without changing photo records or hiding unclassified photos from the full list', () => {
  const photos = [photo('spring', 0), { ...photo('winter', 10), capturedAt: '2026-01-01' }, { ...photo('unknown', 20), capturedAt: '' }];
  const before = JSON.stringify(photos);
  assert.deepEqual(photosInSeason(photos, 'spring').map(photo => photo.id), ['spring']);
  assert.deepEqual(photosInSeason(photos, 'unknown').map(photo => photo.id), ['unknown']);
  assert.equal(photosInSeason(photos, ''), photos);
  assert.equal(JSON.stringify(photos), before);
});

test('two metre groups never split on zoom; vertical floors outside that distance are independent', () => {
  const photos = [photo('a', 0), photo('b', 2), photo('c', 2, 0, 5.2), photo('d', 30)];
  const spots = permanentPhotoSpots(photos);
  assert.equal(spots.length, 3);
  assert.deepEqual(spots[0].photos.map(photo => photo.id), ['a', 'b']);
  const near = cameraPhotoClusters(spots, cameraAt(8), size);
  assert.ok(near.some(cluster => cluster.photos.some(photo => photo.id === 'a') && cluster.photos.some(photo => photo.id === 'b')));
  const before = JSON.stringify(photos);
  permanentPhotoSpots([...photos].reverse()); assert.equal(JSON.stringify(photos), before);
});

test('aerial altitude references cannot falsely merge distant shooting heights at the same horizontal location', () => {
  const seaLevel = { ...photo('sea', 0), captureType: 'aerial', altitude: { reference: 'seaLevel', meters: 100 } };
  assert.equal(permanentPhotoSpots([seaLevel, { ...seaLevel, id: 'high', altitude: { reference: 'seaLevel', meters: 120 } }]).length, 2);
  assert.equal(permanentPhotoSpots([seaLevel, photo('ground', 0)]).length, 2);
  assert.equal(permanentPhotoSpots([seaLevel, { ...seaLevel, id: 'near', altitude: { reference: 'seaLevel', meters: 102 } }]).length, 1);
  assert.equal(permanentPhotoSpots([seaLevel, { ...seaLevel, id: 'relative', altitude: { reference: 'takeoff', meters: 100 } }]).length, 2);
});

test('far camera merges separate spots, drilling into a group separates them, and zooming out merges them again', () => {
  const spots = permanentPhotoSpots([photo('a', -10), photo('b', 0), photo('c', 10)]);
  const farCamera = cameraAt(600), far = cameraPhotoClusters(spots, farCamera, size);
  assert.equal(far.length, 1); assert.equal(far[0].spots.length, 3);
  const focus = clusterFocus(far[0]), target = new THREE.Vector3(...focus.target);
  const direction = farCamera.position.clone().sub(new THREE.Vector3(0, 1.6 + PHOTO_MARKER_LIFT, 0)).normalize();
  farCamera.position.copy(target).add(direction.multiplyScalar(focus.distance)); farCamera.lookAt(target); farCamera.updateMatrixWorld();
  assert.equal(cameraPhotoClusters(spots, farCamera, size).length, 3);
  assert.equal(cameraPhotoClusters(spots, cameraAt(600), size).length, 1);
});

test('groups still merged at the fixed focus distance open their photo menu instead of repeating the same approach', () => {
  const spots = permanentPhotoSpots([photo('a', 0), photo('b', 3)]), camera = cameraAt(600);
  const cluster = cameraPhotoClusters(spots, camera, size)[0];
  assert.equal(clusterReadyToPick(cluster, camera), false);
  const focus = clusterFocus(cluster); assert.equal(focus.distance, 40);
  camera.position.copy(new THREE.Vector3(...focus.target)).add(new THREE.Vector3(0, 30, Math.sqrt(700)));
  assert.equal(clusterReadyToPick(cluster, camera), true);
  camera.position.z += 10;
  assert.equal(clusterReadyToPick(cluster, camera), false);
  const permanent = cameraPhotoClusters(permanentPhotoSpots([photo('a', 0), photo('b', 1)]), camera, size)[0];
  assert.equal(clusterReadyToPick(permanent, camera), true);
});

test('merged thumbnails retain every original shooting point, including permanent two metre groups', () => {
  const photos = [photo('a', -10), photo('b', -9), photo('c', 10)];
  const before = JSON.stringify(photos), camera = cameraAt(600);
  const clusters = cameraPhotoClusters(permanentPhotoSpots(photos), camera, size);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].spots.length, 2);
  assert.deepEqual(visiblePhotoPoints(photos, camera, size), photos.map(photo => ({ ...photo, pointOpacity: .85 })));
  assert.deepEqual(visiblePhotoPoints(photos, cameraAt(40), size).map(photo => photo.position.x), [-10, -9, 10]);
  assert.equal(JSON.stringify(photos), before, 'Point display cannot replace coordinates with cluster centres');
});

test('shooting points and thumbnails remain visible when they reach viewport edges', () => {
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
  camera.position.set(0, 1.6 + PHOTO_POINT_LIFT, 20); camera.lookAt(0, 1.6 + PHOTO_POINT_LIFT, 0); camera.updateMatrixWorld();
  const edge = photo('edge', 20 * Math.tan(camera.fov * Math.PI / 360) * camera.aspect * .95);
  const shots = [edge, photo('outside', 100), photo('behind', 0, 30)];
  assert.deepEqual(cameraPhotoClusters(permanentPhotoSpots(shots), camera, size).flatMap(cluster => cluster.photos.map(photo => photo.id)), ['edge']);
  assert.deepEqual(visiblePhotoPoints(shots, camera, size).map(photo => photo.id), ['edge']);
});

test('thumbnails only disappear after fully leaving each edge, including compact, selected and merged sizes', () => {
  for (const size of [{ width: 900, height: 600 }, { width: 390, height: 776 }]) {
    const camera = new THREE.PerspectiveCamera(43, size.width / size.height, .08, 2000);
    camera.position.set(0, 3.4, 20); camera.lookAt(0, 3.4, 0); camera.updateMatrixWorld();
    for (const [appearance, halfSize, grouped] of [[{}, [32.5, 24], false], [{ compact: true }, [22, 18], false], [{ compact: true }, [30, 24], true], [{ compact: true, selectedId: 'a' }, [43, 32], false]]) {
      for (const [axis, dimension] of [[0, size.width], [1, size.height]]) for (const sign of [-1, 1]) {
        for (const [distance, visible] of [[-1, true], [0, true], [halfSize[axis] - .5, true], [halfSize[axis] + .5, false]]) {
          const ndc = new THREE.Vector3();
          ndc.setComponent(axis, sign * (1 + distance * 2 / dimension));
          const anchor = ndc.unproject(camera);
          const shot = photo('a', anchor.x, anchor.z, anchor.y - PHOTO_MARKER_LIFT);
          const shots = grouped ? [shot, { ...shot, id: 'b' }] : [shot];
          assert.equal(cameraPhotoClusters(permanentPhotoSpots(shots), camera, size, [], appearance).length > 0, visible, `axis ${axis}, sign ${sign}, distance ${distance}, compact ${!!appearance.compact}, grouped ${grouped}`);
        }
      }
    }
  }
});

test('screen groups keep separated regions and small collages have two distinct images without repeating photos', () => {
  const photos = Array.from({ length: 14 }, (_, i) => photo(String(i).padStart(2, '0'), i * 35));
  const clusters = cameraPhotoClusters(permanentPhotoSpots(photos), cameraAt(400), size);
  assert.ok(clusters.length > 1, 'A chain of nearby screen points must not absorb the entire campus');
  for (const length of [2, 3, 5]) {
    const cells = collagePhotos(photos.slice(0, length));
    assert.equal(cells.length, length < 4 ? 2 : 4); assert.equal(new Set(cells.map(cell => cell.id)).size, cells.length);
    assert.ok(cells.every(cell => photos.slice(0, length).includes(cell)));
  }
});

test('projected group centres cannot overlap and block another thumbnail, including in a narrow viewport', () => {
  const camera = cameraAt(160), size = { width: 390, height: 420 };
  camera.aspect = size.width / size.height; camera.updateProjectionMatrix();
  const photos = Array.from({ length: 32 }, (_, i) => photo(String(i).padStart(2, '0'), Math.cos(i * .6) * (10 + i * 2), Math.sin(i * .6) * (10 + i * 2)));
  const clusters = cameraPhotoClusters(permanentPhotoSpots(photos), camera, size);
  const anchors = clusters.map(cluster => cluster.position.clone().add(new THREE.Vector3(0, PHOTO_MARKER_LIFT, 0)).project(camera));
  for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
    assert.ok(Math.hypot((anchors[i].x - anchors[j].x) * size.width / 2, (anchors[i].y - anchors[j].y) * size.height / 2) >= 76 - 1e-8);
  }
});

test('behind-camera, offscreen and building-occluded photos never join visible screen clusters', () => {
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
  camera.position.set(0, 3.4, 20); camera.lookAt(0, 3.4, 0); camera.updateMatrixWorld();
  const scene = new THREE.Scene(), wall = new THREE.Mesh(new THREE.BoxGeometry(4, 10, 2), new THREE.MeshBasicMaterial());
  wall.position.set(0, 3.4, 5); scene.add(wall); scene.updateMatrixWorld();
  const shots = [photo('occluded', 0), photo('visible', 6), photo('behind', 0, 30), photo('outside', 100)];
  const clusters = cameraPhotoClusters(permanentPhotoSpots(shots), camera, size, [wall]);
  assert.deepEqual(clusters.flatMap(cluster => cluster.photos.map(photo => photo.id)), ['visible']);
  const points = visiblePhotoPoints(shots, camera, size, [wall]);
  assert.deepEqual(points.map(photo => photo.id), ['occluded', 'visible']);
  assert.ok(points[0].pointOpacity < points[1].pointOpacity, 'Occluded photo points fade instead of disappearing');
  assert.equal(photoPointVisible(new THREE.Vector3(0, 1.6, 0), camera, size, [wall]), false);
  wall.geometry.userData.photoOcclusionMask = new Uint8Array(12);
  assert.equal(photoPointVisible(new THREE.Vector3(0, 1.6, 0), camera, size, [wall]), true, 'A hard-visibility exemption keeps thumbnails visible');
  assert.ok(visiblePhotoPoints(shots, camera, size, [wall])[0].pointOpacity < .85, 'A thumbnail exemption does not remove the physical layer from point fading');
  wall.material.transparent = true; wall.material.depthWrite = false;
  assert.equal(photoPointVisible(new THREE.Vector3(0, 1.6, 0), camera, size, [wall]), true, 'Ghost overlays do not hide photos');
  wall.geometry.dispose(); wall.material.dispose();
});

test('merged thumbnail anchors stay on an actual shooting spot and are lifted less than two metres', () => {
  const spots = permanentPhotoSpots([photo('a', -10), photo('b', 12)]);
  const [cluster] = cameraPhotoClusters(spots, cameraAt(600), size);
  assert.ok(spots.some(spot => spot.position.equals(cluster.position)));
  assert.ok(PHOTO_MARKER_LIFT > 0 && PHOTO_MARKER_LIFT < 2);
});

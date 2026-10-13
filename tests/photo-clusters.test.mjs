import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { cameraPhotoClusters, clusterFocus, clusterReadyToPick, collagePhotos, permanentPhotoSpots, PHOTO_MARKER_LIFT, PHOTO_POINT_LIFT, photoPointVisible, visiblePhotoPoints, regionPhotoClusters, photoMarkerSize } from '../src/photo-clusters.ts';
import { photoSeason, photosInSeason } from '../src/photo-season.ts';
import { FULL_MAP_VIEWPORT, mapObjectApproach, mapObjectFocusPose } from '../src/map-card-viewport.ts';
import { mapLocationTarget } from '../src/location-geometry.ts';

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

test('minimal map markers open a merged photo choice directly while the default view still approaches first', () => {
  const camera = cameraAt(600), shots = [photo('a', -10), photo('b', 10)];
  const [cluster] = cameraPhotoClusters(permanentPhotoSpots(shots), camera, size, [], { minimal: true });
  assert.equal(cluster.spots.length, 2);
  assert.equal(clusterReadyToPick(cluster, camera, true), true);
  assert.equal(clusterReadyToPick(cluster, camera), false);
  assert.deepEqual(visiblePhotoPoints(shots, camera, size).map(shot => shot.id), ['a', 'b']);
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
    for (const [appearance, halfSize, grouped] of [[{}, [32.5, 24], false], [{ compact: true }, [22, 18], false], [{ compact: true }, [30, 24], true], [{ compact: true, selectedId: 'a' }, [43, 32], false], [{ minimal: true }, [22, 22], false], [{ minimal: true, selectedId: 'a' }, [22, 22], true]]) {
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

const rectangle = (x, z, width, depth) => ({ outer: [[x, z], [x + width, z], [x + width, z + depth], [x, z + depth], [x, z]], holes: [] });
const regionBuilding = (id, x, z, width = 20, depth = 20) => ({ id, name: id, center: [x + width / 2, z + depth / 2], floors: 4, ...rectangle(x, z, width, depth) });
const regionOptions = (buildings = [], features = []) => ({ campus: { buildings, features }, site: { buildingOverrides: {}, photos: [] } });

test('the distant map keeps one collection per destination, anchored to a real unlifted photograph', () => {
  const options = regionOptions([regionBuilding('west', -20, -10), regionBuilding('east', 0, -10)]);
  const photos = [photo('west-a', -18), photo('west-b', -2), photo('east-a', 2), photo('east-b', 18)].map(shot => ({ ...shot, buildingId: shot.id.startsWith('west') ? 'west' : 'east', floor: 1 }));
  const before = JSON.stringify(photos), clusters = regionPhotoClusters(photos, cameraAt(200), size, [], options);
  assert.equal(clusters.length, 2);
  for (const cluster of clusters) {
    assert.equal(cluster.collapsed, true);
    assert.equal(cluster.photos.length, 2);
    assert.equal(cluster.opacity, 1);
    assert.ok(cluster.photos.some(shot => cluster.position.equals(new THREE.Vector3(shot.position.x, shot.position.height, shot.position.z))));
    assert.equal(cluster.regionName, cluster.regionId);
  }
  assert.equal(JSON.stringify(photos), before);
});

test('approaching a large building expands its photos; selecting a far photo expands only its destination', () => {
  const options = regionOptions([regionBuilding('long', -100, -10, 200, 20), regionBuilding('other', -10, -10)]);
  const photos = [photo('a', -75), photo('b', 75)].map(shot => ({ ...shot, buildingId: 'long', floor: 1 }));
  const camera = cameraAt(40); camera.position.set(-105, 30, 25); camera.lookAt(-75, 1.6, 0); camera.updateMatrixWorld();
  const approached = regionPhotoClusters(photos, camera, size, [], options);
  assert.ok(approached.length > 0 && approached.every(cluster => !cluster.collapsed));
  const far = cameraAt(600), selected = { ...options, selectedId: 'a' };
  assert.ok(regionPhotoClusters(photos, far, size, [], options).every(cluster => cluster.collapsed), 'The far destination starts outside its fitted approach range');
  const expanded = regionPhotoClusters([...photos, { ...photo('other', 0), buildingId: 'other', floor: 1 }], far, size, [], selected);
  assert.equal(expanded.find(cluster => cluster.regionId === 'other').collapsed, true);
  assert.ok(expanded.filter(cluster => cluster.regionId === 'long').every(cluster => !cluster.collapsed));
  assert.ok(expanded.filter(cluster => cluster.regionId === 'long').length >= 2);
});

test('a farther facing building expands before a close side neighbour and turning the gaze changes the expanded cards', () => {
  const options = regionOptions([regionBuilding('front', -45, -10, 90, 20), regionBuilding('side', 14, 50)]);
  const shots = [{ ...photo('front-left', -20), buildingId: 'front', floor: 1 },
    { ...photo('front-right', 40), buildingId: 'front', floor: 1 },
    { ...photo('side', 14.1, 50.1), buildingId: 'side', floor: 1 }];
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
  camera.position.set(0, 12, 80); camera.lookAt(0, 7.32, 0); camera.updateMatrixWorld();
  const bounds = id => mapLocationTarget(options.campus, options.site, id).bounds;
  const facing = mapObjectApproach(camera, bounds('front')), nearer = mapObjectApproach(camera, bounds('side'));
  assert.ok(facing.expanded && nearer.expanded, 'Both destinations have reached their own size-based approach range');
  assert.ok(facing.distance > nearer.distance && facing.alignment < nearer.alignment);
  let clusters = regionPhotoClusters(shots, camera, size, [], options);
  assert.equal(clusters.filter(cluster => cluster.regionId === 'front').length, 2);
  assert.ok(clusters.filter(cluster => cluster.regionId === 'front').every(cluster => !cluster.collapsed));
  assert.equal(clusters.find(cluster => cluster.regionId === 'side').collapsed, true);
  camera.lookAt(24, 7.32, 60); camera.updateMatrixWorld();
  clusters = regionPhotoClusters(shots, camera, size, [], options);
  assert.equal(clusters.find(cluster => cluster.regionId === 'side').collapsed, false);
  assert.equal(clusters.find(cluster => cluster.regionId === 'front').collapsed, true);
});

test('destination collections carry real bounds and their fitted click view expands in desktop and phone map space', () => {
  const options = regionOptions([regionBuilding('wide', -70, -10, 140, 20)], [
    { id: 'forest', name: '标本林', type: 'forest', ...rectangle(150, -40, 90, 80) }]);
  const shots = [{ ...photo('wide-left', -60), buildingId: 'wide', floor: 1 },
    { ...photo('wide-right', 60), buildingId: 'wide', floor: 2 },
    { ...photo('forest-left', 160), locationId: 'forest' }, { ...photo('forest-right', 230), locationId: 'forest' }];
  for (const [viewportSize, viewport] of [[size, { left: .36, top: .04, width: .64, height: .92 }],
    [{ width: 390, height: 844 }, { left: 0, top: .07, width: 1, height: .38 }]]) {
    const aspect = viewportSize.width / viewportSize.height, camera = new THREE.PerspectiveCamera(43, aspect, .08, 4000);
    camera.position.set(90, 700, 700); camera.lookAt(90, 0, 0); camera.updateMatrixWorld();
    const collections = regionPhotoClusters(shots, camera, viewportSize, [], { ...options, viewport: FULL_MAP_VIEWPORT });
    for (const id of ['wide', 'forest']) {
      const cluster = collections.find(cluster => cluster.regionId === id), destination = mapLocationTarget(options.campus, options.site, id);
      assert.equal(cluster.collapsed, true); assert.deepEqual(cluster.focusBounds, destination.bounds);
      const pose = mapObjectFocusPose({ position: camera.position.clone(), quaternion: camera.quaternion.clone(),
        target: new THREE.Vector3(), fov: camera.fov, near: camera.near }, new THREE.Vector3(...destination.target), cluster.focusBounds, aspect, viewport);
      camera.position.copy(pose.position); camera.quaternion.copy(pose.quaternion); camera.updateMatrixWorld();
      assert.equal(mapObjectApproach(camera, destination.bounds, viewport).expanded, true);
      const expanded = regionPhotoClusters(shots, camera, viewportSize, [], { ...options, viewport });
      assert.ok(expanded.some(cluster => cluster.regionId === id && !cluster.collapsed), `${id} expands in the fitted ${viewportSize.width}px map`);
    }
  }
});

test('unassigned photos infer a mapped destination while unrelated outdoor areas remain separate', () => {
  const options = regionOptions([regionBuilding('library', -20, -20, 40, 40)], [{ id: 'forest', name: '标本林', type: 'forest', ...rectangle(55, -20, 40, 40) }]);
  const shots = [photo('library', 0), photo('forest', 75), photo('outside-a', -80), photo('outside-b', -160)];
  const clusters = regionPhotoClusters(shots, cameraAt(400), size, [], options);
  assert.equal(clusters.find(cluster => cluster.photos.some(shot => shot.id === 'library')).regionId, 'library');
  assert.equal(clusters.find(cluster => cluster.photos.some(shot => shot.id === 'forest')).regionId, 'forest');
  assert.notEqual(clusters.find(cluster => cluster.photos.some(shot => shot.id === 'outside-a')).regionId,
    clusters.find(cluster => cluster.photos.some(shot => shot.id === 'outside-b')).regionId);
  assert.match(clusters.find(cluster => cluster.photos.some(shot => shot.id === 'outside-a')).regionName, /^校园[东西南北]侧$/);
  const nearby = regionPhotoClusters([photo('near-forest', 110)], cameraAt(400), size, [], options);
  assert.equal(nearby[0].regionId, 'forest', 'Nearby outside photographs belong to the landscape, even beyond its exact footprint');
  const classroomOnly = regionOptions([regionBuilding('classroom', -10, -10)]);
  assert.notEqual(regionPhotoClusters([photo('outside-classroom', 20)], cameraAt(400), size, [], classroomOnly)[0].regionId, 'classroom', 'Being near a classroom does not make an outside photograph an indoor building photograph');
});

test('a far collection changes its fade identity when an offscreen representative is replaced by another real anchor', () => {
  const options = regionOptions([regionBuilding('wide', -70, -10, 140, 20)]);
  const shots = [-60, 60].map((x, i) => ({ ...photo(String(i), x), buildingId: 'wide', floor: 1 }));
  const camera = new THREE.PerspectiveCamera(20, 1, .08, 2000);
  camera.position.set(-60, 1.6, 140); camera.lookAt(-60, 1.6, 0); camera.updateMatrixWorld();
  const [left] = regionPhotoClusters(shots, camera, size, [], options);
  camera.position.x = 60; camera.lookAt(60, 1.6, 0); camera.updateMatrixWorld();
  const [right] = regionPhotoClusters(shots, camera, size, [], options);
  assert.equal(left.regionId, right.regionId);
  assert.notEqual(left.id, right.id);
  assert.equal(left.position.x, -60); assert.equal(right.position.x, 60);
});

test('close overlap merging keeps different storeys distinct rather than permanently fusing nearby heights', () => {
  const options = { ...regionOptions([regionBuilding('teaching', -10, -10)]), expandedRegionId: 'teaching' };
  const same = [photo('one', 0), photo('same-storey', .2)].map(shot => ({ ...shot, buildingId: 'teaching', floor: 1 }));
  assert.equal(regionPhotoClusters(same, cameraAt(40), size, [], options).length, 1);
  const different = { ...photo('two', .2, 0, 2.1), buildingId: 'teaching', floor: 2 };
  assert.equal(regionPhotoClusters([same[0], different], cameraAt(40), size, [], options).length, 2);
});

test('approaching an aerial collection expands it at the actual shooting altitude, not only near the building ground', () => {
  const options = regionOptions([regionBuilding('teaching', -10, -10)]);
  const shots = [-5, 5].map((x, i) => ({ ...photo(String(i), x, 0, 180), buildingId: 'teaching', floor: 0, captureType: 'aerial' }));
  const camera = cameraAt(300); camera.position.set(0, 180, 40); camera.lookAt(0, 180, 0); camera.updateMatrixWorld();
  assert.ok(regionPhotoClusters(shots, camera, size, [], options).every(cluster => !cluster.collapsed));
});

test('an actual wall keeps overlapping near cards separate and dims the card behind it instead of removing it', () => {
  const options = { ...regionOptions([regionBuilding('teaching', -10, -10)]), expandedRegionId: 'teaching' };
  const shots = [photo('front', 0, 1), photo('back', 0, -1)].map(shot => ({ ...shot, buildingId: 'teaching', floor: 1 }));
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
  camera.position.set(0, 1.6, 40); camera.lookAt(0, 1.6, 0); camera.updateMatrixWorld();
  const scene = new THREE.Scene(), wall = new THREE.Mesh(new THREE.BoxGeometry(12, 10, .3), new THREE.MeshBasicMaterial());
  wall.userData = { photoOccluder: true, buildingId: 'teaching' }; wall.position.y = 1.6; scene.add(wall); scene.updateMatrixWorld();
  const clusters = regionPhotoClusters(shots, camera, size, [wall], options);
  assert.equal(clusters.length, 2, 'A card cannot be merged through a physical separator even when screen positions overlap');
  const front = clusters.find(cluster => cluster.photos.some(shot => shot.id === 'front'));
  const back = clusters.find(cluster => cluster.photos.some(shot => shot.id === 'back'));
  assert.equal(front.opacity, 1);
  assert.ok(back.opacity > 0 && back.opacity < front.opacity);
  wall.geometry.dispose(); wall.material.dispose();
});

test('public cards preserve partially clipped edges and bound distance scaling to usable tap sizes', () => {
  const options = regionOptions(), camera = new THREE.PerspectiveCamera(43, 390 / 776, .08, 2000);
  camera.position.set(0, 1.6, 20); camera.lookAt(0, 1.6, 0); camera.updateMatrixWorld();
  const anchor = new THREE.Vector3(1.04, 0, 0).unproject(camera);
  const edge = photo('edge', anchor.x, anchor.z, anchor.y);
  const clusters = regionPhotoClusters([edge, photo('offscreen', 100), photo('behind', 0, 30)], camera, { width: 390, height: 776 }, [], options);
  assert.deepEqual(clusters.flatMap(cluster => cluster.photos.map(shot => shot.id)), ['edge']);
  let previous = Infinity;
  for (const distance of [0, 1, 10, 40, 60, 100, 500, Infinity]) {
    const { markerWidth, markerHeight } = photoMarkerSize(distance);
    assert.ok(markerWidth <= previous && markerWidth >= 46 && markerWidth <= 88);
    assert.ok(markerHeight >= 44 && markerHeight <= 66);
    previous = markerWidth;
  }
  assert.deepEqual(photoMarkerSize(NaN), { markerWidth: 46, markerHeight: 44 });
  assert.equal(regionPhotoClusters([{ ...edge, position: { ...edge.position, height: NaN } }], camera, size, [], options).length, 0);
});

test('card clipping includes the full region caption and overlapping-photo count', () => {
  const viewport = { width: 390, height: 776 }, options = regionOptions();
  const camera = new THREE.PerspectiveCamera(43, viewport.width / viewport.height, .08, 2000);
  camera.position.set(0, 1.6, 300); camera.lookAt(0, 1.6, 0); camera.updateMatrixWorld();
  for (const [distance, collapsed] of [[300, true], [40, false]]) {
    const { markerWidth, markerHeight } = photoMarkerSize(distance);
    const halfSize = [collapsed ? Math.max(markerWidth / 2 + 6, 55) : markerWidth / 2 + 6, markerHeight / 2 + (collapsed ? 21 : 6)];
    for (const [axis, dimension] of [[0, viewport.width], [1, viewport.height]]) {
      for (const [overflow, visible] of [[halfSize[axis] - .5, true], [halfSize[axis] + .5, false]]) {
        const ndc = new THREE.Vector3(); ndc.setComponent(axis, 1 + overflow * 2 / dimension);
        const anchor = ndc.unproject(camera).sub(camera.position).normalize().multiplyScalar(distance).add(camera.position);
        const first = { ...photo('a', anchor.x, anchor.z, anchor.y), floor: 1 }, second = { ...first, id: 'b' };
        assert.equal(regionPhotoClusters([first, second], camera, viewport, [], options).length > 0, visible,
          `collapsed ${collapsed}, axis ${axis}, overflow ${overflow}`);
      }
    }
  }
});

test('an expanded building keeps its nearest 10 visible cards and collects the rest at a real background anchor', () => {
  const building = { ...regionBuilding('teaching', -10, -10), floors: 30 }, options = regionOptions([building]);
  const shots = Array.from({ length: 28 }, (_, i) => ({ ...photo(String(i).padStart(2, '0'), 0, 0, 1.6 + i * 3.6), buildingId: building.id, floor: i + 1 }));
  const camera = new THREE.PerspectiveCamera(100, 1.5, .08, 2000);
  camera.position.set(0, 50, 50); camera.lookAt(0, 50, 0); camera.updateMatrixWorld();
  const clusters = regionPhotoClusters(shots, camera, size, [], options);
  const expected = [...shots].sort((a, b) => new THREE.Vector3(a.position.x, a.position.height, a.position.z).distanceTo(camera.position)
    - new THREE.Vector3(b.position.x, b.position.height, b.position.z).distanceTo(camera.position));
  const foreground = clusters.filter(cluster => !cluster.overflow), [overflow] = clusters.filter(cluster => cluster.overflow);
  assert.equal(foreground.length, 10); assert.equal(clusters.length, 11);
  assert.deepEqual(foreground.map(cluster => cluster.photos[0].id), expected.slice(0, 10).map(shot => shot.id));
  assert.equal(overflow.collapsed, false); assert.equal(overflow.regionName, 'teaching');
  assert.deepEqual(overflow.photos.map(shot => shot.id), expected.slice(10).map(shot => shot.id));
  const anchor = expected[10];
  assert.ok(overflow.position.equals(new THREE.Vector3(anchor.position.x, anchor.position.height, anchor.position.z)));
  assert.equal(overflow.spots.length, 18);
  assert.equal(new Set(clusters.flatMap(cluster => cluster.photos.map(shot => shot.id))).size, shots.length);
  for (const cluster of clusters) {
    assert.equal(cluster.occlusionLayers, 0);
    assert.equal(cluster.cameraDistance, cluster.position.distanceTo(camera.position));
  }
  assert.equal(regionPhotoClusters(shots.slice(0, 10), camera, size, [], options).some(cluster => cluster.overflow), false);
  assert.equal(regionPhotoClusters(shots.slice(0, 11), camera, size, [], options).filter(cluster => cluster.overflow).length, 1);
  const selectedFar = regionPhotoClusters(shots, camera, size, [], { ...options, selectedId: expected.at(-1).id });
  assert.deepEqual(selectedFar.filter(cluster => !cluster.overflow).map(cluster => cluster.photos[0].id), expected.slice(0, 10).map(shot => shot.id), 'Selection cannot displace a nearer eligible card from the nearest 10');
  const far = regionPhotoClusters(shots, cameraAt(500), size, [], options);
  assert.equal(far.length, 1); assert.equal(far[0].collapsed, true); assert.equal(far[0].overflow, false); assert.equal(far[0].photos.length, 28);
});

test('the building card limit counts merged cards rather than photographs and ignores offscreen records', () => {
  const building = { ...regionBuilding('teaching', -10, -10), floors: 30 }, options = regionOptions([building]);
  const camera = new THREE.PerspectiveCamera(100, 1.5, .08, 2000);
  camera.position.set(0, 50, 50); camera.lookAt(0, 50, 0); camera.updateMatrixWorld();
  const shots = Array.from({ length: 26 }, (_, i) => ({ ...photo(String(i).padStart(2, '0'), 0, 0, 1.6 + i * 3.6), buildingId: building.id, floor: i + 1 }));
  const sameCard = { ...shots[12], id: 'same-card' };
  const offscreen = { ...shots[0], id: 'offscreen', position: { x: 10000, z: 0, height: 1.6 } };
  const clusters = regionPhotoClusters([...shots, sameCard, offscreen], camera, size, [], options);
  assert.equal(clusters.length, 11);
  assert.ok(clusters.some(cluster => !cluster.overflow && cluster.photos.length === 2));
  assert.equal(clusters.filter(cluster => cluster.overflow).length, 1);
  assert.equal(clusters.flatMap(cluster => cluster.photos).length, 27);
  assert.equal(clusters.flatMap(cluster => cluster.photos).some(shot => shot.id === offscreen.id), false);
});

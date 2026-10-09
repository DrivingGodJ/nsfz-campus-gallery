import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildingGeometry } from '../src/building-geometry.ts';
import { laboratoryBodyGeometry, laboratoryLayout } from '../src/laboratory-geometry.ts';
import { acceleratePhotoOccluder, photoRayIntersectsOccluder } from '../src/photo-occlusion.ts';
import { cameraPhotoClusters, permanentPhotoSpots, photoOccluders, photoPointOpacity, photoPointPosition, photoPointVisible, visiblePhotoPoints } from '../src/photo-clusters.ts';

test('photo ray bounds skip distant meshes and refresh after transforms or geometry changes', () => {
  const scene = new THREE.Scene(), parent = new THREE.Group();
  parent.userData.photoOccluder = true; scene.add(parent);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const original = new THREE.BoxGeometry(2, 6, 2), mesh = new THREE.Mesh(original, material);
  let casts = 0;
  mesh.raycast = function(ray, hits) { casts++; THREE.Mesh.prototype.raycast.call(this, ray, hits); };
  parent.add(mesh); parent.position.x = 100; scene.updateMatrixWorld();
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
  camera.position.set(0, 1.6, 20); camera.lookAt(0, 1.6, 0); camera.updateMatrixWorld();
  const anchor = new THREE.Vector3(0, 1.6, 0), ray = new THREE.Raycaster(camera.position, anchor.clone().sub(camera.position).normalize());
  assert.equal(photoRayIntersectsOccluder(mesh, ray), false);
  assert.equal(photoPointOpacity(anchor, camera, [mesh]), .85); assert.equal(casts, 0);
  original.translate(-100, 0, 0);
  assert.equal(photoRayIntersectsOccluder(mesh, ray), true, 'In-place geometry edits update the cached world box');
  assert.ok(photoPointOpacity(anchor, camera, [mesh]) < .85);
  original.translate(100, 0, 0);
  assert.equal(photoRayIntersectsOccluder(mesh, ray), false);
  parent.position.set(0, 0, 5); parent.rotation.y = Math.PI / 4; parent.scale.set(2, 1, .5); scene.updateMatrixWorld();
  assert.equal(photoRayIntersectsOccluder(mesh, ray), true);
  assert.ok(photoPointOpacity(anchor, camera, [mesh]) < .85); assert.ok(casts > 0);
  const replacement = new THREE.BoxGeometry(2, 6, 2); replacement.translate(100, 0, 0); mesh.geometry = replacement;
  assert.equal(photoRayIntersectsOccluder(mesh, ray), false);
  const before = casts;
  assert.equal(photoPointOpacity(anchor, camera, [mesh]), .85); assert.equal(casts, before);
  original.dispose(); replacement.dispose(); material.dispose();
});

test('accelerated photo visibility preserves triangle masks and sees opaque walls behind nonblocking corridor slabs', () => {
  const slab = new THREE.PlaneGeometry(10, 10), wall = new THREE.PlaneGeometry(10, 10);
  slab.translate(0, 3.4, 5); wall.translate(0, 3.4, 0);
  const geometry = mergeGeometries([slab, wall]);
  geometry.userData.photoOcclusionMask = [0, 0, 1, 1];
  const originalIndex = Array.from(geometry.index.array), mask = [...geometry.userData.photoOcclusionMask];
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material), group = new THREE.Group(), scene = new THREE.Scene();
  group.userData.photoOccluder = true; group.add(mesh); scene.add(group);
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
  camera.position.set(0, 3.4, 20); camera.lookAt(0, 3.4, 0); camera.updateMatrixWorld();
  const size = { width: 900, height: 600 }, anchor = new THREE.Vector3(0, 1.6, -5);
  assert.equal(photoPointVisible(anchor, camera, size, [mesh]), false);
  const occluders = photoOccluders(scene), tree = geometry.boundsTree;
  assert.ok(tree); assert.equal(tree.indirect, true);
  assert.deepEqual(Array.from(geometry.index.array), originalIndex);
  assert.deepEqual(geometry.userData.photoOcclusionMask, mask);
  assert.equal(photoPointVisible(anchor, camera, size, occluders), false, 'A nonblocking nearest hit must not conceal a wall behind it');
  const ray = new THREE.Raycaster();
  for (let x = -.3; x <= .3; x += .1) {
    ray.setFromCamera(new THREE.Vector2(x, 0), camera);
    const expected = [], actual = [];
    THREE.Mesh.prototype.raycast.call(mesh, ray, expected); mesh.raycast(ray, actual);
    expected.sort((a,b) => a.distance-b.distance); actual.sort((a,b) => a.distance-b.distance);
    assert.deepEqual(actual.map(hit => hit.faceIndex), expected.map(hit => hit.faceIndex), 'Pointer selection also keeps original face indices');
  }
  geometry.userData.photoOcclusionMask.fill(0);
  assert.equal(photoPointVisible(anchor, camera, size, occluders), true);
  assert.equal(photoOccluders(scene)[0].geometry.boundsTree, tree, 'Reuse the index across camera movement');
  geometry.dispose(); assert.equal(geometry.boundsTree, undefined);
  slab.dispose(); wall.dispose(); material.dispose();
});

test('glass, hidden groups and deliberately non-interactive details retain their visibility and picking rules', () => {
  const scene = new THREE.Scene(), group = new THREE.Group(); group.userData.photoOccluder = true; scene.add(group);
  const material = new THREE.MeshBasicMaterial(), mesh = new THREE.Mesh(new THREE.BoxGeometry(), material); group.add(mesh);
  const custom = () => null; mesh.raycast = custom;
  acceleratePhotoOccluder(mesh); assert.equal(mesh.raycast, custom); assert.equal(mesh.geometry.boundsTree, undefined);
  material.transparent = true; material.depthWrite = false; assert.deepEqual(photoOccluders(scene), []);
  material.transparent = false; material.depthWrite = true; group.visible = false; assert.deepEqual(photoOccluders(scene), []);
  group.visible = true; assert.deepEqual(photoOccluders(scene), [mesh]);
  mesh.geometry.dispose(); material.dispose();
});

test('photo points fade through buildings while thumbnails retain their own-shell exemption and other-building occlusion', () => {
  const scene = new THREE.Scene(), building = new THREE.Group(), nested = new THREE.Group();
  building.userData = { photoOccluder: true, buildingId: 'own-building' };
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.BoxGeometry(6, 12, 6), material);
  body.position.y = 6; nested.add(body); building.add(nested); scene.add(building);
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000), size = { width: 900, height: 600 };
  const shot = id => ({ id, position: { x: 0, z: 0, height: 1.6 } });
  const photos = [
    { ...shot('interior-legacy'), buildingId: 'own-building' },
    { ...shot('interior-location'), locationId: 'own-building', buildingId: 'old-building' },
    { ...shot('another-building'), locationId: 'another-building' },
    { ...shot('outside-unassigned') },
    { ...shot('aerial'), buildingId: 'own-building', captureType: 'aerial' }
  ];
  const before = JSON.stringify(photos), spots = permanentPhotoSpots(photos);
  assert.ok(spots.some(spot => spot.photos.some(photo => photo.id === 'another-building') && spot.photos.some(photo => photo.id === 'interior-legacy')));
  for (const z of [20, -20]) {
    camera.position.set(0, 3.4, z); camera.lookAt(0, 3.4, 0); camera.updateMatrixWorld();
    const occluders = photoOccluders(scene), ray = new THREE.Raycaster();
    ray.set(camera.position, photoPointPosition(photos[0]).sub(camera.position).normalize());
    assert.ok(ray.intersectObjects(occluders, false).length, 'The actual opaque building mesh lies between camera and interior point');
    assert.equal(photoPointVisible(new THREE.Vector3(0, 1.6, 0), camera, size, occluders), false, 'The building still occludes without an ownership exemption');
    const points = visiblePhotoPoints(photos, camera, size, occluders);
    assert.deepEqual(points.map(photo => photo.id), photos.map(photo => photo.id));
    assert.ok(points.every(photo => photo.pointOpacity > 0 && photo.pointOpacity < .85), 'An opaque shell dims points without hiding them');
    assert.deepEqual(cameraPhotoClusters(spots, camera, size, occluders).flatMap(cluster => cluster.photos.map(photo => photo.id)).sort(), ['interior-legacy', 'interior-location']);
  }
  camera.position.set(0, 3.4, 20); camera.lookAt(0, 3.4, 0); camera.updateMatrixWorld();
  const otherBuilding = new THREE.Group(), otherBody = new THREE.Mesh(new THREE.BoxGeometry(6, 12, 2), material);
  otherBuilding.userData = { photoOccluder: true, buildingId: 'other-building' };
  otherBody.position.set(0, 6, 10); otherBuilding.add(otherBody); scene.add(otherBuilding);
  const behindBoth = visiblePhotoPoints(photos, camera, size, photoOccluders(scene));
  assert.deepEqual(behindBoth.map(photo => photo.id), photos.map(photo => photo.id), 'Points also remain available behind another building');
  assert.deepEqual(cameraPhotoClusters(spots, camera, size, photoOccluders(scene)), [], 'Own-shell exemptions cannot bypass another building for thumbnails');
  otherBuilding.visible = false;
  const behindOwn = visiblePhotoPoints(photos, camera, size, photoOccluders(scene));
  assert.deepEqual(behindOwn.map(photo => photo.id), photos.map(photo => photo.id));
  assert.ok(behindBoth.every((photo, index) => photo.pointOpacity < behindOwn[index].pointOpacity), 'Each additional physical wall makes the point softer');
  assert.equal(JSON.stringify(photos), before, 'Visibility never rewrites persisted location or coordinates');
  body.geometry.dispose(); otherBody.geometry.dispose(); material.dispose();
});

test('physical slab layers fade points progressively, deduplicating faces and counting opaque corridor floors and ground', () => {
  const scene = new THREE.Scene(), building = new THREE.Group();
  building.userData = { photoOccluder: true, buildingId: 'building' }; scene.add(building);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000), size = { width: 900, height: 600 };
  camera.position.set(.7, 24, .3); camera.lookAt(.7, -2, .3); camera.updateMatrixWorld();
  const anchor = new THREE.Vector3(.7, -2, .3);
  assert.equal(photoPointOpacity(anchor, camera, []), .85);
  const slabs = [];
  for (const y of [9, 6, 3]) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(10, .25, 10), material);
    slab.position.y = y; slabs.push(slab); building.add(slab);
    const occluders = photoOccluders(scene);
    assert.ok(Math.abs(photoPointOpacity(anchor, camera, occluders) - .85 * .62 ** slabs.length) < 1e-10, 'Upper/lower faces and duplicate diagonal triangles are one physical slab');
  }
  const duplicate = slabs[0].clone(); building.add(duplicate);
  assert.ok(Math.abs(photoPointOpacity(anchor, camera, photoOccluders(scene)) - .85 * .62 ** 3) < 1e-10, 'A coincident mesh does not introduce another layer');
  const fourth = new THREE.Mesh(new THREE.BoxGeometry(10, .25, 10), material);
  fourth.position.y = 12; building.add(fourth);
  assert.equal(photoPointOpacity(anchor, camera, photoOccluders(scene)), .14, 'Deeply occluded points retain a restrained visibility floor');
  building.remove(fourth); fourth.geometry.dispose();
  slabs[1].geometry.userData.photoOcclusionMask = new Uint8Array(12);
  assert.ok(Math.abs(photoPointOpacity(anchor, camera, photoOccluders(scene)) - .85 * .62 ** 3) < 1e-10, 'Corridor floors remain real opacity layers even when exempt from hard thumbnail hiding');
  assert.equal(photoPointVisible(anchor, camera, size, [slabs[1]]), true, 'Hard thumbnail visibility still skips masked slab faces');
  building.visible = false;
  const ground = new THREE.Group(); ground.userData.photoOpacityOccluder = true; scene.add(ground);
  const groundMeshes = [.02, .06].map(y => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), material);
    mesh.rotation.x = -Math.PI / 2; mesh.position.y = y; ground.add(mesh); return mesh;
  });
  const noPicking = () => null; groundMeshes[0].raycast = noPicking;
  let occluders = photoOccluders(scene);
  assert.equal(occluders.length, 2, 'Tagged ground surfaces join the shared opacity rays');
  assert.ok(Math.abs(photoPointOpacity(anchor, camera, occluders) - .85 * .62) < 1e-10, 'Adjacent ground render layers count as one physical layer');
  assert.equal(groundMeshes[0].raycast, noPicking, 'Opacity raycasts preserve the forest ground custom pointer handler');
  const pointer = new THREE.Raycaster(camera.position, anchor.clone().sub(camera.position).normalize());
  assert.deepEqual(pointer.intersectObject(groundMeshes[0]), [], 'A ground mesh remains non-interactive for actual picking');
  assert.equal(photoPointVisible(anchor, camera, size, occluders), true, 'Ground dims underground points without hiding thumbnails');
  const photo = { id: 'underground', position: { x: .7, z: .3, height: -2 } };
  assert.ok(visiblePhotoPoints([photo], camera, size, occluders)[0].pointOpacity < .85);
  building.visible = true;
  occluders = photoOccluders(scene);
  assert.ok(photoPointOpacity(anchor, camera, occluders) < .85 * .62, 'Underground points account for both ground and building floors');
  groundMeshes[1].userData.photoOccluder = true;
  delete ground.userData.photoOpacityOccluder;
  assert.ok(photoOccluders(scene).includes(groundMeshes[1]), 'Meshes tagged as occluders themselves are collected, including raised platforms');
  const offscreen = { ...photo, id: 'offscreen', position: { x: 1000, z: .3, height: -2 } };
  assert.deepEqual(visiblePhotoPoints([offscreen], camera, size, occluders), [], 'Soft occlusion never overrides the camera frustum');
  const obliqueSlab = new THREE.Mesh(new THREE.BoxGeometry(100, .25, 100), material); scene.add(obliqueSlab);
  camera.position.set(0, .8, 30); camera.lookAt(0, -.8, -30); camera.updateMatrixWorld(); scene.updateMatrixWorld();
  assert.ok(Math.abs(photoPointOpacity(new THREE.Vector3(0, -.8, -30), camera, [obliqueSlab]) - .85 * .62) < 1e-10, 'Oblique rays still count a slab once even when its two hits are many metres apart');
  obliqueSlab.geometry.dispose();
  for (const mesh of [...slabs, ...groundMeshes]) mesh.geometry.dispose();
  material.dispose();
});

test('real teaching and laboratory corridor slabs dim a third-floor point behind three floors', async () => {
  const shape = { outer: [[0, 0], [12, 0], [12, 9], [0, 9], [0, 0]], holes: [] };
  const corridor = { partId: 'main', footprint: { outer: [[0, 0], [12, 0], [12, 3], [0, 3], [0, 0]], holes: [] }, points: [[0, 0], [12, 0]], depth: 3 };
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const laboratory = campus.buildings.find(building => building.id === 'way/855459411');
  const at = laboratoryLayout(laboratory).at;
  const cases = [
    [buildingGeometry(shape, 21.6, 3.6, [], [corridor]), [6, 1.5]],
    [laboratoryBodyGeometry(laboratory, 21.6, 3.6), at(16, 13.1)],
  ];
  for (const [geometry, [x, z]] of cases) {
    const scene = new THREE.Scene(), body = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    body.rotation.x = -Math.PI / 2; body.userData.photoOccluder = true; scene.add(body);
    const camera = new THREE.PerspectiveCamera(43, 1.5, .08, 2000);
    camera.position.set(x, 20, z); camera.lookAt(x, 9.2, z); camera.updateMatrixWorld();
    const occluders = photoOccluders(scene), anchor = new THREE.Vector3(x, 9.2, z), ray = new THREE.Raycaster(camera.position, new THREE.Vector3(0, -1, 0), 0, 10.7);
    const hits = ray.intersectObjects(occluders, false);
    assert.ok(hits.length >= 6, 'The actual model includes both faces of three intermediate floor slabs');
    assert.ok(hits.every(hit => geometry.userData.photoOcclusionMask[hit.faceIndex] === 0), 'The actual corridor floors carry only hard-visibility exemptions');
    assert.equal(photoPointVisible(anchor, camera, { width: 900, height: 600 }, occluders), true);
    assert.ok(Math.abs(photoPointOpacity(anchor, camera, occluders) - .85 * .62 ** 3) < 1e-10, 'All three actual floor layers soften the third-floor point');
    geometry.dispose(); body.material.dispose();
  }
});

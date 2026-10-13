import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { orderPhotoMarkers } from '../src/photo-marker-order.ts';

test('overlapping cards draw back to front by camera depth, with folded photos below every normal card', () => {
  const camera = new PerspectiveCamera(43, 1, .5, 4000);
  camera.position.set(0, 0, 0); camera.lookAt(0, 0, -1);
  const marker = (id, x, z, layers = 0, overflow = false) => ({ id, position: new Vector3(x, 0, z), occlusionLayers: layers, overflow });
  const photos = [marker('near', 0, -20, 2), marker('rear', 0, -20.01), marker('folded', 0, -1, 0, true), marker('off-axis', 100, -10), marker('same-depth-behind-wall', 0, -20, 3)];
  const snapshot = photos.map(photo => photo.id);
  assert.deepEqual(orderPhotoMarkers(photos, camera).map(photo => photo.id), ['folded', 'rear', 'same-depth-behind-wall', 'near', 'off-axis']);
  assert.deepEqual(photos.map(photo => photo.id), snapshot, 'Ranking never changes photo data order');
  camera.lookAt(0, 0, 1);
  assert.ok(orderPhotoMarkers(photos.filter(photo => !photo.overflow), camera).findIndex(photo => photo.id === 'rear') > orderPhotoMarkers(photos.filter(photo => !photo.overflow), camera).findIndex(photo => photo.id === 'near'), 'Turning the camera reverses physical front and back');
});

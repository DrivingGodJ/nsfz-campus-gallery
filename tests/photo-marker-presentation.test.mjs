import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { photoMarkerStructureKey, updatePhotoMarker } from '../src/photo-marker-presentation.ts';

test('camera movement updates card presentation without changing its React identity, while changed choices and anchors do', () => {
  const card = { id: 'room', photos: [{ id: 'first' }, { id: 'second' }], position: new Vector3(10, 7, 20), markerWidth: 80, markerHeight: 60, opacity: .7, occlusionLayers: 1 };
  const other = { ...card, id: 'other', photos: [{ id: 'third' }] };
  const key = photoMarkerStructureKey([card, other]);
  const moved = { ...card, markerWidth: 110, markerHeight: 88, opacity: .4, occlusionLayers: 3 };
  assert.equal(photoMarkerStructureKey([other, moved]), key, 'Distance, occlusion and depth ordering do not remount card content');
  const overflow = { ...card, photos: Array.from({ length: 6 }, (_, i) => ({ id: String(i) })), overflow: true };
  assert.equal(photoMarkerStructureKey([overflow]), photoMarkerStructureKey([{ ...overflow, photos: [...overflow.photos.slice(0, 4), overflow.photos[5], overflow.photos[4]] }]), 'Reordering folded members must not refresh unchanged collage thumbnails');
  for (const changed of [{ ...card, photos: [card.photos[0]] }, { ...card, position: new Vector3(11, 7, 20) }, { ...card, collapsed: true }, { ...card, overflow: true }]) {
    assert.notEqual(photoMarkerStructureKey([changed, other]), key);
  }
  const node = { style: {}, dataset: { markerShown: 'true' }, disabled: false }, anchor = { style: { setProperty(name, value) { this[name] = value; } } };
  updatePhotoMarker(node, anchor, moved, 5);
  assert.equal(node.style.width, '110px'); assert.equal(node.style.opacity, '0.4');
  assert.equal(node.dataset.photoLayers, '3'); assert.equal(anchor.style['--photo-rank'], '5');
  node.dataset.markerShown = 'false';
  updatePhotoMarker(node, anchor, moved, 2);
  assert.equal(node.style.opacity, '0', 'Camera updates must never undo an enter/exit fade');
  node.dataset.markerShown = 'true'; node.disabled = true;
  updatePhotoMarker(node, anchor, moved, 0);
  assert.equal(node.style.opacity, '0', 'Removed cards stay invisible and unclickable');
  node.disabled = false;
  updatePhotoMarker(node, anchor, { ...moved, overflow: true, opacity: 1 }, 0);
  assert.equal(node.style.opacity, '0.4'); assert.equal(anchor.style['--photo-rank'], '0');
});

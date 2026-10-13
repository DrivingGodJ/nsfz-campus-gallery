import test from 'node:test';
import assert from 'node:assert/strict';
import { adjacentPhoto } from '../src/photo-browse.ts';

const photo = { id: 'one', title: 'DSC03533', description: '夏日操场', author: 'DGJ', capturedAt: '2025-05-20T17:42', buildingId: 'gym', floor: 2 };

test('previous and next stay within the list from which the photo was selected, without wrapping or guessing missing ids', () => {
  const group = [photo, { ...photo, id: 'two' }, { ...photo, id: 'three' }];
  assert.equal(adjacentPhoto(group, 'two', -1), group[0]);
  assert.equal(adjacentPhoto(group, 'two', 1), group[2]);
  assert.equal(adjacentPhoto(group, 'one', -1), undefined);
  assert.equal(adjacentPhoto(group, 'three', 1), undefined);
  assert.equal(adjacentPhoto(group, 'missing', 1), undefined);
});

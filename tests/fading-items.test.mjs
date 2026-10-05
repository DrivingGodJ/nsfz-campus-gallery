import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileFadingItems, PHOTO_FADE_MS } from '../src/fading-items.ts';

test('disappearing photo clusters retain their footprint for the fade, then expire without extending on camera updates', () => {
  const first = {id:'first',position:[1,2,3]}, second = {id:'second'};
  let entries = reconcileFadingItems([], [first,second], 0);
  entries = reconcileFadingItems(entries,[second],100);
  assert.equal(entries[0].item,first); assert.equal(entries[0].expiresAt,100+PHOTO_FADE_MS);
  entries = reconcileFadingItems(entries,[second],200);
  assert.equal(entries[0].expiresAt,100+PHOTO_FADE_MS);
  entries = reconcileFadingItems(entries,[second],100+PHOTO_FADE_MS);
  assert.deepEqual(entries,[{item:second,expiresAt:null}]);
});

test('rapidly reappearing clusters cancel removal and use current contents; reduced motion removes old entries immediately', () => {
  const first = {id:'same',version:1}, updated = {id:'same',version:2};
  const closing = reconcileFadingItems([{item:first,expiresAt:null}],[],100);
  assert.deepEqual(reconcileFadingItems(closing,[updated],150),[{item:updated,expiresAt:null}]);
  assert.deepEqual(reconcileFadingItems([{item:first,expiresAt:null}],[],100,0),[]);
});

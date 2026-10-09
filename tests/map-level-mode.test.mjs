import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { curvedStairPoint } from '../src/structure-geometry.ts';
import { isUndergroundFeature, isUndergroundPhoto } from '../src/map-level-mode.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));

test('map layers separate calibrated underground photos without changing the catalogue or their positions', () => {
  const before = JSON.stringify(site);
  const below = site.photos.filter(photo => isUndergroundPhoto(photo, campus, site));
  const above = site.photos.filter(photo => !isUndergroundPhoto(photo, campus, site));
  assert.ok(below.length > 0 && above.length > below.length);
  assert.equal(below.length + above.length, site.photos.length);
  assert.ok(below.some(photo => photo.locationId === 'local/underground-badminton'));
  assert.ok(above.some(photo => photo.captureType === 'aerial'));
  assert.ok(above.some(photo => photo.locationId === 'local/footbridge'));
  assert.equal(JSON.stringify(site), before);
});

test('entrance photos follow their actual stair height, while aerial photos stay in the surface layer', () => {
  const feature = campus.features.find(feature => feature.type === 'tunnelEntrance');
  assert.ok(feature);
  const base = {...site.photos[0], captureType:'ground', locationId:feature.id, floor:1, cameraHeight:1.6};
  const at = progress => {const [x, height, z] = curvedStairPoint(feature.curvedStair, progress);return {...base,position:{x,z,height}};};
  const below = at(.9), above = at(.05);
  assert.equal(isUndergroundPhoto(below, campus, site), true);
  assert.equal(isUndergroundPhoto(above, campus, site), false);
  assert.equal(isUndergroundPhoto({...below,captureType:'aerial'}, campus, site), false);
  assert.equal(isUndergroundFeature(feature), false, 'An entrance also has a surface portion');
});

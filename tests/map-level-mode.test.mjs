import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { curvedStairPoint } from '../src/structure-geometry.ts';
import { isUndergroundFeature, isUndergroundPhoto, photoMapLevel } from '../src/map-level-mode.ts';
import { isAerialPhoto } from '../src/locations.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));

test('map layers partition aerial, surface and calibrated underground photos without changing the catalogue or their positions', () => {
  const before = JSON.stringify(site);
  const below = site.photos.filter(photo => photoMapLevel(photo, campus, site) === 'underground');
  const above = site.photos.filter(photo => photoMapLevel(photo, campus, site) === 'surface');
  const aerial = site.photos.filter(photo => photoMapLevel(photo, campus, site) === 'aerial');
  assert.ok(below.length > 0 && above.length > 0 && aerial.length > 0);
  const all = [...below, ...above, ...aerial];
  assert.equal(all.length, site.photos.length);
  assert.equal(new Set(all.map(photo => photo.id)).size, site.photos.length);
  assert.ok(below.some(photo => photo.locationId === 'local/underground-badminton'));
  assert.ok(below.every(photo => isUndergroundPhoto(photo, campus, site)));
  assert.ok(aerial.every(isAerialPhoto));
  assert.ok(above.every(photo => !isAerialPhoto(photo) && !isUndergroundPhoto(photo, campus, site)));
  assert.ok(above.some(photo => photo.locationId === 'local/footbridge'));
  assert.equal(JSON.stringify(site), before);
});

test('entrance photos follow their actual stair height, while aerial classification takes priority over underground associations', () => {
  const feature = campus.features.find(feature => feature.type === 'tunnelEntrance');
  assert.ok(feature);
  const base = {...site.photos[0], captureType:'ground', locationId:feature.id, floor:1, cameraHeight:1.6};
  const at = progress => {const [x, height, z] = curvedStairPoint(feature.curvedStair, progress);return {...base,position:{x,z,height}};};
  const below = at(.9), above = at(.05);
  assert.equal(isUndergroundPhoto(below, campus, site), true);
  assert.equal(isUndergroundPhoto(above, campus, site), false);
  assert.equal(isUndergroundPhoto({...below,captureType:'aerial'}, campus, site), false);
  assert.equal(photoMapLevel(below, campus, site), 'underground');
  assert.equal(photoMapLevel(above, campus, site), 'surface');
  assert.equal(photoMapLevel({...below,captureType:'aerial'}, campus, site), 'aerial');
  assert.equal(photoMapLevel({...below,captureType:undefined,metadata:{...below.metadata,aerial:true}}, campus, site), 'aerial', 'Legacy aerial metadata remains supported');
  assert.equal(isUndergroundFeature(feature), false, 'An entrance also has a surface portion');
});

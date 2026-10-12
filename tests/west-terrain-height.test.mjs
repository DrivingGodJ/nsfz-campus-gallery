import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { insideShape, rampSurfaceHeight, stairSurfaceHeight } from '../src/terrain-height.ts';
import { groundElevationAt } from '../src/sports-ground-geometry.ts';
import { photoMapHeight } from '../src/locations.ts';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const terrace = { id: 'terrace', type: 'plaza', height: 3.6,
  platform: { outer: [[-2,-2],[12,-2],[12,12],[-2,12]], holes: [[[1,1],[2,1],[2,2],[1,2]]] } };
const ramp = { id: 'ramp', type: 'path', points: [[0,0],[10,0],[10,10]], width: 2,
  ramp: { topHeight: 3.6, bottomHeight: 0 } };

test('raised terrain respects platform holes while bent ramps override its height continuously', () => {
  const campus = { features: [terrace, ramp] }, before = JSON.stringify(campus);
  assert.equal(insideShape([-2,0], terrace.platform), true);
  assert.equal(insideShape([1.5,1.5], terrace.platform), false);
  close(groundElevationAt(campus, [1.5,1.5]), 0);
  close(groundElevationAt(campus, [5,5]), 3.6);
  close(rampSurfaceHeight(ramp, [0,0]), 3.6);
  close(rampSurfaceHeight(ramp, [5,.75]), 2.7);
  close(rampSurfaceHeight(ramp, [10,0]), 1.8);
  close(rampSurfaceHeight(ramp, [9.25,5]), .9);
  close(groundElevationAt(campus, [10,10]), 0);
  close(groundElevationAt(campus, [10,5]), .9);
  assert.equal(rampSurfaceHeight(ramp, [5,1.01]), undefined);
  assert.equal(rampSurfaceHeight({ ...ramp, points: [[0,0],[0,0]] }, [0,0]), undefined);
  close(rampSurfaceHeight({ ...ramp, points: [[0,0],[0,0],[10,0],[10,10]] }, [10,5]), .9);
  assert.equal(JSON.stringify(campus), before);
});

test('west terrain raises only photos standing on it, retaining low ground and independent aerial altitudes', async () => {
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));
  const before = JSON.stringify(site.photos), high = site.photos.find(photo => photo.id === '4aed67d1-6342-4523-b749-1c7a2e6ed99b');
  assert.ok(campus.features.some(feature => feature.id === 'local/west-campus-terrace'));
  close(groundElevationAt(campus, [high.position.x, high.position.z]), 2.6);
  close(photoMapHeight(high, campus, site), 4.2);
  const low = site.photos.find(photo => photo.id === '964cecbc-0c2c-4291-bf68-9b87bc41c7c2');
  close(groundElevationAt(campus, [low.position.x, low.position.z]), 0);
  close(photoMapHeight(low, campus, site), low.cameraHeight ?? 1.6);
  close(photoMapHeight({ ...low, cameraHeight: undefined, position: { x: -66.886, z: 75.602 } }, campus, site), 1.6);
  for (const point of [[-68,56],[-64.26,73.99]]) close(groundElevationAt(campus, point), 0);
  const aerial = { ...high, captureType: 'aerial', altitude: { reference: 'takeoff', meters: 12.5 } };
  close(photoMapHeight(aerial, campus, site), 12.5);
  const field = campus.features.find(feature => feature.type === 'runningTrack');
  close(groundElevationAt(campus, field.track.center), 2.6);
  assert.equal(JSON.stringify(site.photos), before);
});

test('the upper west connection follows each flat descending tread and overrides terrain and ramps', async () => {
  const stairs = { id: 'stairs', type: 'path', riseStair: {
    from: [0,0], to: [10,0], width: 2, steps: 15, topHeight: 2.6, bottomHeight: 0 } };
  const campus = { features: [terrace, ramp, stairs] }, before = JSON.stringify(campus);
  close(stairSurfaceHeight(stairs, [0,0]), 2.6);
  close(stairSurfaceHeight(stairs, [10,0]), 0);
  for (let i = 0; i < 15; i++) for (const fraction of [.1,.8]) {
    const point = [10 * (i + fraction) / 15, .7], expected = 2.6 * (1 - (i + 1) / 15);
    close(stairSurfaceHeight(stairs, point), expected);
    close(groundElevationAt(campus, point), expected);
  }
  close(stairSurfaceHeight(stairs, [10 / 15,0]), 2.6 * 14 / 15);
  assert.equal(stairSurfaceHeight(stairs, [-.01,0]), undefined);
  assert.equal(stairSurfaceHeight(stairs, [10.01,0]), undefined);
  assert.equal(stairSurfaceHeight(stairs, [5,1.01]), undefined);
  const photo = { locationId: '', buildingId: '', captureType: 'ground', floor: 0, position: { x: 5, z: .7 } };
  close(photoMapHeight(photo, { ...campus, buildings: [] }, { buildingOverrides: {} }), 2.6 * 7 / 15 + 1.6);
  assert.equal(JSON.stringify(campus), before);

  const real = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const feature = real.features.find(item => item.id === 'local/west-upper-stairs');
  assert.ok(feature && feature.riseStair.steps === 15);
  assert.equal(real.features.some(item => item.id === 'local/west-upper-ramp'), false);
  const stair = feature.riseStair;
  for (let i = 0; i < stair.steps; i++) {
    const t = (i + .5) / stair.steps;
    const point = stair.from.map((value, axis) => value + (stair.to[axis] - value) * t);
    close(groundElevationAt(real, point), stair.topHeight + (stair.bottomHeight - stair.topHeight) * (i + 1) / stair.steps);
  }
});

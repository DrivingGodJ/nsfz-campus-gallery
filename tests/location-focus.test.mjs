import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { campusFilterLocations } from '../src/locations.ts';
import { mapLocationTarget } from '../src/location-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(await fs.readFile(new URL('../public/data/site.json', import.meta.url)));

test('every public selectable destination has a camera focus inside its real location bounds', () => {
  for (const location of campusFilterLocations(campus, site)) {
    const focus = mapLocationTarget(campus, site, location.id);
    assert.ok(focus, `${location.name} can be focused, including non-building locations`);
    assert.ok(focus.target.every(Number.isFinite), `${location.name} has a finite focus`);
    for (let axis = 0; axis < 3; axis++) assert.ok(focus.target[axis] >= focus.bounds.min[axis] && focus.target[axis] <= focus.bounds.max[axis], `${location.name} focus lies within its footprint`);
  }
  for (const feature of campus.features.filter(f => f.track || f.courts)) {
    const focus = mapLocationTarget(campus, site, feature.id), model = feature.track || feature.courts;
    assert.deepEqual([focus.target[0], focus.target[2]], model.center, `${feature.name} focuses the modeled courts rather than the surrounding open space`);
  }
  assert.equal(mapLocationTarget(campus, site, 'missing'), null);
  assert.equal(mapLocationTarget(campus, site), null);
});

test('location focus retains underground elevations and building floor cuts without mutating content', () => {
  const before = JSON.stringify({ campus, site });
  for (const feature of campus.features.filter(f => ['tunnel', 'undergroundRoom', 'undergroundCorridor', 'undergroundTrack'].includes(f.type))) {
    assert.equal(mapLocationTarget(campus, site, feature.id).target[1], feature.height, `${feature.name} focuses its underground level`);
  }
  const building = campusFilterLocations(campus, site).find(location => location.name === '主教学楼').building;
  const full = mapLocationTarget(campus, site, building.id), cut = mapLocationTarget(campus, site, building.id, 1);
  assert.ok(cut.target[1] < full.target[1]);
  assert.equal(cut.bounds.max[1], (site.buildingOverrides[building.id]?.floorHeight || 3.6) + .12);
  assert.equal(JSON.stringify({ campus, site }), before);
});

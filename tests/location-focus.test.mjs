import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { campusFilterLocations } from '../src/locations.ts';
import { mapLocationTarget } from '../src/location-geometry.ts';
import { buildingLevels } from '../src/building-model.ts';
import { GYM_ID, gymArchitecture } from '../src/architecture-geometry.ts';
import { facadeGeometry } from '../src/facade-geometry.ts';
import { buildingGeometry } from '../src/building-geometry.ts';

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
    const floor = feature.riseStair ? (feature.riseStair.bottomHeight + feature.riseStair.topHeight)/2 : feature.height;
    assert.equal(mapLocationTarget(campus, site, feature.id).target[1], floor, `${feature.name} focuses its underground floor range`);
  }
  const building = campusFilterLocations(campus, site).find(location => location.name === '主教学楼').building;
  const full = mapLocationTarget(campus, site, building.id), cut = mapLocationTarget(campus, site, building.id, 1);
  assert.ok(cut.target[1] < full.target[1]);
  assert.equal(cut.bounds.max[1], (site.buildingOverrides[building.id]?.floorHeight || 3.6) + .12);
  assert.equal(JSON.stringify({ campus, site }), before);
});

test('full building bounds contain the modeled gym arch, observatory globe and teaching rooftop room without extending floor cuts', () => {
  const gym = campus.buildings.find(building => building.id === GYM_ID), dorm = campus.buildings.find(building => building.facade?.observatory);
  const bridge = campus.features.find(feature => feature.id === 'local/footbridge');
  const containsGeometry = (focus, geometry, baseElevation = 0, rotated = false) => {
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const min = rotated ? [box.min.x, box.min.z + .12 + baseElevation, -box.max.y] : [box.min.x, box.min.y + baseElevation, box.min.z];
    const max = rotated ? [box.max.x, box.max.z + .12 + baseElevation, -box.min.y] : [box.max.x, box.max.y + baseElevation, box.max.z];
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(focus.bounds.min[axis] <= min[axis] + 1e-4, `Axis ${axis} includes the modeled lower extent`);
      assert.ok(focus.bounds.max[axis] >= max[axis] - 1e-4, `Axis ${axis} includes the modeled upper extent`);
    }
  };
  const gymInfo = buildingLevels(gym, site.buildingOverrides[gym.id]), gymModel = gymArchitecture(gym, gymInfo.height, gymInfo.floorHeight, bridge);
  try { containsGeometry(mapLocationTarget(campus, site, gym.id), gymModel.roof, gymInfo.baseElevation); }
  finally { Object.values(gymModel).forEach(geometry => geometry.dispose()); }
  const dormInfo = buildingLevels(dorm, site.buildingOverrides[dorm.id]), facade = facadeGeometry(dorm, dormInfo.floors, dormInfo.floorHeight, dormInfo.height);
  try {
    const full = mapLocationTarget(campus, site, dorm.id);
    assert.ok(full.bounds.max[1] >= facade.dome.peak + dormInfo.baseElevation);
    facade.geometries.forEach(({ geometry }) => containsGeometry(full, geometry, dormInfo.baseElevation));
  } finally { facade.geometries.forEach(({ geometry }) => geometry.dispose()); }
  const teaching = campus.buildings.find(building => building.stairwells?.some(stair => stair.roofAccess));
  const teachingInfo = buildingLevels(teaching, site.buildingOverrides[teaching.id]), stair = teaching.stairwells.find(stair => stair.roofAccess);
  const section = teachingInfo.sections.find(section => section.id === stair.partId);
  const room = buildingGeometry(section, section.height, teachingInfo.floorHeight, [], [], [stair]);
  try { containsGeometry(mapLocationTarget(campus, site, teaching.id), room, teachingInfo.baseElevation, true); }
  finally { room.dispose(); }
  for (const building of [gym, dorm, teaching]) {
    const info = buildingLevels(building, site.buildingOverrides[building.id]);
    for (const floor of [1, 3]) assert.equal(mapLocationTarget(campus, site, building.id, floor).bounds.max[1], info.baseElevation + .12 + Math.min(info.height, floor * info.floorHeight), 'A chosen storey excludes roof details above its cut');
  }
});

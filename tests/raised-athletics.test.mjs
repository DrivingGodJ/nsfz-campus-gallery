import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { buildingLevels } from '../src/building-model.ts';
import { snapFootprint } from '../src/building-geometry.ts';
import { bridgeHeight, stadiumRing, trackWorldPoint } from '../src/structure-geometry.ts';
import { photoMapHeight, campusLocations } from '../src/locations.ts';
import { mapLocationTarget } from '../src/location-geometry.ts';
import { groundElevationAt, sportsGroundPlatform } from '../src/sports-ground-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
const site = { buildingOverrides: {}, photos: [] };
const field = campus.features.find(f => f.id === 'way/855459407');
const gym = campus.buildings.find(b => b.id === 'local/gymnasium');
const raisedIds = ['way/855459409', 'local/stand-office', gym.id];
const bridge = campus.features.find(f => f.id === 'local/footbridge');
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} equals ${b}`);
const ringArea = ring => Math.abs(ring.slice(1).reduce((sum, point, i) => sum + ring[i][0] * point[1] - point[0] * ring[i][1], 0) / 2);
const polygonArea = polygons => polygons.reduce((sum, [outer, ...holes]) => sum + ringArea(outer) - holes.reduce((area, ring) => area + ringArea(ring), 0), 0);
const photo = (locationId, position, floor = 0) => ({ locationId, buildingId: '', floor, position: { x: position[0], z: position[1] }, captureType: 'ground' });

test('athletics ground, its buildings, their photos and floor cutaways share the lowered 2.6 metre base', () => {
  const before = JSON.stringify({ campus, site });
  close(field.height, 2.6);
  const platform = sportsGroundPlatform(field);
  const trackOutline = stadiumRing(field.track.halfStraight, field.track.innerRadius + field.track.lanes * field.track.laneWidth).map(p => trackWorldPoint(field.track, p));
  assert.deepEqual(polygonClipping.difference([trackOutline], [platform.outer]), [], 'The raised base supports the entire running track');
  for (const id of raisedIds) {
    const building = campus.buildings.find(b => b.id === id), info = buildingLevels(building);
    close(info.baseElevation, field.height);
    const unsupported = polygonClipping.difference(snapFootprint([[building.outer]]), snapFootprint([[platform.outer]]));
    assert.ok(polygonArea(unsupported) < .0001,
      'Buildings stand on the same solid platform within the shared ten micrometre clipping precision');
    for (const floor of [1, 2, info.floors]) close(photoMapHeight(photo(id, building.center, floor), campus, site), field.height + (floor - 1) * info.floorHeight + 1.6);
    const cut = mapLocationTarget(campus, site, id, 1);
    close(cut.bounds.min[1], field.height + .12);
    close(cut.bounds.max[1], field.height + info.floorHeight + .12);
    close(campusLocations(campus, site).find(item => item.id === id).surfaceHeight, field.height);
  }
  close(photoMapHeight(photo(field.id, field.track.center), campus, site), field.height + 1.6);
  close(photoMapHeight(photo('', field.track.center), campus, site), field.height + 1.6);
  close(photoMapHeight(photo('', [0, 0]), campus, site), 1.6);
  close(groundElevationAt(campus, [0, 0]), 0);
  assert.equal(JSON.stringify({ campus, site }), before, 'Stored positions and floor numbers stay intact');
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus, 'All calibration survives a map refresh');
});

test('bridge stays at its existing height above the lowered athletics base, while aerial and underground photos stay unchanged', () => {
  close(bridge.deckHeight, 5.52);
  assert.equal(bridge.levelAnchor, undefined, 'The fixed bridge deck is independent of the lowered gym base');
  close(bridgeHeight(bridge, campus.buildings, site.buildingOverrides), 5.52);
  for (const floorHeight of [2.4, 3.6, 4.2]) close(bridgeHeight(bridge, campus.buildings, { [gym.id]: { floorHeight } }), 5.52);
  close(photoMapHeight(photo(bridge.id, bridge.points[0]), campus, site), 7.12);
  const entry = bridge.connections.find(c => c.buildingId === gym.id);
  assert.equal(entry.floor, 1.5);
  const entryPoint = entry.points.at(-1), facadeFrom = gym.outer[0], facadeTo = gym.outer[3];
  const dx = facadeTo[0] - facadeFrom[0], dz = facadeTo[1] - facadeFrom[1], length = Math.hypot(dx, dz);
  const along = ((entryPoint[0] - facadeFrom[0]) * dx + (entryPoint[1] - facadeFrom[1]) * dz) / length;
  const across = Math.abs((entryPoint[0] - facadeFrom[0]) * dz - (entryPoint[1] - facadeFrom[1]) * dx) / length;
  assert.ok(across < 1e-7 && along > bridge.width / 2 && along < length - bridge.width / 2,
    'The shifted gym entry meets its facade and retains enough width for the shared bridge doorway');
  assert.deepEqual(entry.points[0], bridge.points[0], 'The gym platform joins the shifted main bridge');
  const stairs = bridge.connections.find(c => c.id === 'playground-stairs');
  close(stairs.groundHeight, 2.72);
  close(stairs.groundHeight, field.height + .12);
  const aerial = { ...photo(gym.id, gym.center, 2), captureType: 'aerial', altitude: { reference: 'takeoff', meters: 80 } };
  close(photoMapHeight(aerial, campus, site), 80);
  const room = campus.features.find(f => f.id === 'local/underground-badminton');
  close(photoMapHeight(photo(room.id, room.outer[0]), campus, site), room.height + 1.6);
  for (const building of campus.buildings.filter(b => !raisedIds.includes(b.id))) close(buildingLevels(building).baseElevation, 0);
});

test('the rounded teaching-wing end is shallower without shifting its shoulders, width or courtyard', () => {
  const wing = campus.buildings.find(b => b.id === 'way/855459420').parts.find(p => p.id === 'sixth-floor-wing');
  const a = [69.09783950637153, 81.45276490857093], b = [67.35796823973887, 74.97338355341977];
  assert.deepEqual(wing.outer[11], a);
  assert.deepEqual(wing.outer[19], b);
  const originalTip = [60.91125744700011, 78.98437693178498];
  const depth = p => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
  assert.ok(depth(wing.outer[15]) < depth(originalTip) * .7);
  assert.ok(depth(wing.outer[15]) > depth(originalTip) * .6, 'Retain the rounded projection');
  assert.deepEqual(wing.holes[0], [[86.1076, 81.5488], [74.0282, 83.5237], [71.2912, 66.7825], [83.3706, 64.8077], [86.1076, 81.5488]]);
  assert.equal(wing.floors, 6);
});

test('gym keeps the twelve metre rear extension while its front end retreats with the bridge and stays short of midfield', () => {
  const originalRear = [[-12.160312632183086, -136.51343968038765], [6.839687367816914, -151.51343968038765]];
  const originalFront = [[45.08663784336115, -103.70475158595733], [26.086637843361153, -88.70475158595733]];
  const retreats = gym.outer.slice(2, 4).map((point, i) => point.map((value, j) => value - originalFront[i][j]));
  for (let j = 0; j < 2; j++) close(retreats[0][j], retreats[1][j]);
  close(Math.hypot(...retreats[0]), 6.8514940189193965);
  close(Math.hypot(gym.outer[2][0] - gym.outer[3][0], gym.outer[2][1] - gym.outer[3][1]),
    Math.hypot(originalFront[0][0] - originalFront[1][0], originalFront[0][1] - originalFront[1][1]));
  for (let i = 0; i < 2; i++) close(Math.hypot(...gym.outer[i].map((v, j) => v - originalRear[i][j])), 12);
  const along = p => (p[0] - field.track.center[0]) * field.track.axis[0] + (p[1] - field.track.center[1]) * field.track.axis[1];
  assert.ok(Math.min(...gym.outer.map(along)) > 6.5, 'The extended rear wall leaves a visible gap before midfield');
});

test('the small front teaching-wing lip is trimmed to align with the long rear corridor on every floor', () => {
  const building = campus.buildings.find(b => b.id === 'way/855459420');
  const main = building.parts.find(p => p.id === 'main'), wing = building.parts.find(p => p.id === 'sixth-floor-wing');
  const [a, b] = main.outer.slice(19, 21), dx = b[0] - a[0], dz = b[1] - a[1];
  for (const p of wing.outer.slice(21, 23)) close(((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / Math.hypot(dx, dz), 0);
  assert.equal(wing.floors, 6, 'Only the footprint changes, not the building height');
});

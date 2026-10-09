import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import clip from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { curvedStairPoint, curvedStairTreads } from '../src/structure-geometry.ts';
import { joinedPassages, passageFootprint, undergroundLayout } from '../src/underground-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const find = id => campus.features.find(feature => feature.id === id);
const roads = campus.features.filter(feature => feature.type === 'path' && !feature.representedBy);
const area = polygons => polygons.reduce((sum, rings) => sum + rings.reduce((total, ring, i) => total + (i ? -1 : 1) * Math.abs(ring.slice(1).reduce((n, p, j) => n + ring[j][0] * p[1] - p[0] * ring[j][1], 0) / 2), 0), 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8);

test('entrance stands beside the marked basketball corner, parallel to the road and clear of traffic', () => {
  const entrance = find('local/underpass-entrance'), stair = entrance.curvedStair;
  const road = find('way/855459415'), [a, b] = road.points.slice(-2);
  const top = curvedStairPoint(stair, 0), center = [top[0], top[2]];
  const axis = [Math.cos(stair.startAngle), Math.sin(stair.startAngle)];
  close(axis[0] * (b[1] - a[1]) - axis[1] * (b[0] - a[0]), 0);
  assert.ok(Math.hypot(center[0] - a[0], center[1] - a[1]) < 5, 'Entrance is at the marked junction');
  assert.ok(center[0] < a[0] && center[1] > a[1], 'Entrance is on the basketball-clearing side of the junction');
  const half = entrance.width / 2;
  const marker = passageFootprint([center.map((n, i) => n - axis[i] * half), center.map((n, i) => n + axis[i] * half)], entrance.width);
  const opening = curvedStairTreads({ ...stair, steps: 1 })[0].ring;
  for (const road of roads) {
    const buffer = passageFootprint(road.points, (road.width || 3) + .4);
    for (const ring of [marker.outer, opening]) assert.ok(area(clip.intersection([ring], [buffer.outer])) < 1e-7, 'Both the entrance block and stair opening leave the road clear');
  }
  assert.equal(entrance.hideLabel, false, 'The entrance now provides a selectable photo location');
});

test('relocated stairs join the tunnel without a gap and keep the existing underground exit', () => {
  const entrance = find('local/underpass-entrance'), tunnel = find('local/underpass'), exit = find('local/underpass-exit');
  const bottom = curvedStairPoint(entrance.curvedStair, 1);
  close(bottom[0], tunnel.points[0][0]); close(bottom[2], tunnel.points[0][1]); close(bottom[1], tunnel.height);
  assert.deepEqual(tunnel.points.at(-1), exit.points[0]);
  assert.deepEqual(tunnel.points.at(-1), [-65, -41], 'The underground exit stays in place');
  const route = tunnel.points.at(-1).map((n, i) => n - tunnel.points[0][i]);
  for (const point of tunnel.points.slice(1)) close((point[0] - tunnel.points[0][0]) * route[1] - (point[1] - tunnel.points[0][1]) * route[0], 0);
  const layout = undergroundLayout(campus.features);
  assert.equal(layout.areas.get(tunnel.id).footprints.length, 1, 'The straight tunnel remains one connected surface');
  const openings = layout.areas.get(tunnel.id).openings;
  assert.equal(openings.length, 2, 'The tunnel has its original corridor exit and the stair entrance');
  assert.deepEqual(openings[0], joinedPassages(tunnel, exit).seam, 'The original corridor exit remains open at the same seam');
  const stairDoor = openings[1];
  close((stairDoor[0][0] + stairDoor[1][0]) / 2, bottom[0]);
  close((stairDoor[0][1] + stairDoor[1][1]) / 2, bottom[2]);
  close(Math.hypot(stairDoor[1][0] - stairDoor[0][0], stairDoor[1][1] - stairDoor[0][1]), entrance.curvedStair.width);
});

test('all history hall terrace steps stay outside the road edge and survive map refresh', async () => {
  const hall = campus.buildings.find(building => building.id === 'way/1233313451');
  for (const scale of [1, .97, .94]) {
    const ring = hall.outer.map(point => point.map((n, i) => hall.appearance.center[i] + (n - hall.appearance.center[i]) * scale));
    for (const road of roads) {
      const buffer = passageFootprint(road.points, (road.width || 3) + .6);
      assert.ok(area(clip.intersection([ring], [buffer.outer])) < 1e-7, 'Each step keeps at least 0.3 metres clear of the road edge');
    }
  }
  const corrections = JSON.parse(await fs.readFile(new URL('../data/campus-corrections.json', import.meta.url)));
  assert.deepEqual(applyCampusCorrections(campus, corrections), campus);
});

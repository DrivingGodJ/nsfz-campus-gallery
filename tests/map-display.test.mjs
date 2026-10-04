import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import { buildingFloorLineGeometry } from '../src/building-floor-lines.ts';
import { buildingLevels } from '../src/building-model.ts';
import { seasonalMapColor } from '../src/season-palette.ts';
import { mapColorForTheme } from '../src/theme.ts';
import { groundSurfaces } from '../src/ground-geometry.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
test('outer walls and courtyard walls show every floor, while annotation stops at its cutaway floor', () => {
  const building = campus.buildings.find(building => building.id === 'way/855459420');
  const info = buildingLevels(building), full = buildingFloorLineGeometry(building, info.sections, info.floorHeight);
  const cut = buildingFloorLineGeometry(building, info.sections, info.floorHeight, 2);
  const levels = geometry => [...new Set(Array.from({ length: geometry.attributes.position.count }, (_, i) => Math.round((geometry.attributes.position.getY(i) - .12) / info.floorHeight)))];
  assert.deepEqual(levels(full).sort((a,b) => a-b), Array.from({ length: Math.max(...info.sections.map(section => section.floors)) - 1 }, (_, i) => i + 1));
  assert.deepEqual(levels(cut), [1]);
  const main = info.sections[0], hole = main.holes[0], vertices = full.attributes.position;
  assert.ok(Array.from({ length: vertices.count }, (_, i) => [vertices.getX(i),vertices.getZ(i)])
    .some(point => hole.some(vertex => Math.hypot(vertex[0]-point[0],vertex[1]-point[1]) < .04)), 'Lines also follow the courtyard walls');
  full.dispose(); cut.dispose();
});

test('all four seasons change vegetation, ground and water in both system themes; reset restores authored colors', () => {
  for (const theme of ['light','dark']) for (const color of ['#798e65','#cfd5bd','#b5cbc7']) {
    const colors = ['spring','summer','autumn','winter'].map(season => seasonalMapColor(theme,season,color));
    assert.equal(new Set(colors).size, 4);
    assert.equal(seasonalMapColor(theme,'',color),mapColorForTheme(theme,color));
    assert.equal(seasonalMapColor(theme,'unknown',color),mapColorForTheme(theme,color));
    assert.equal(seasonalMapColor(theme,'winter','#d7d2c3'),mapColorForTheme(theme,'#d7d2c3'), 'Building identity stays consistent');
  }
});

test('ground surfaces do not compete with other layers over the same land', () => {
  const layout = groundSurfaces(campus);
  const ground = [...layout.background,...layout.campus,...campus.features.filter(feature=>['green','sport','plaza','water'].includes(feature.type)).flatMap(feature=>layout.features.get(feature.id)||[])];
  const area = ring => Math.abs(ring.slice(1).reduce((sum,p,i)=>sum+ring[i][0]*p[1]-p[0]*ring[i][1],0)/2);
  for (let i=0;i<ground.length;i++) for (let j=i+1;j<ground.length;j++) {
    const intersect=polygonClipping.intersection([ground[i].outer,...ground[i].holes],[ground[j].outer,...ground[j].holes]);
    assert.ok(intersect.reduce((sum,[outer,...holes])=>sum+area(outer)-holes.reduce((sum,ring)=>sum+area(ring),0),0)<1e-6,'No overlapping faces can flicker at distant zoom');
  }
});

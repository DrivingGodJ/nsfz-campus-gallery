import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { gardenFootprints, boardwalkLayout, boardwalkPlanks, pavilionRoofGeometry, pergolaLayout } from '../src/garden-geometry.ts';
import { photoMapHeight, campusLocations, assignPhotoLocation } from '../src/locations.ts';

const read = async file => JSON.parse(await fs.readFile(new URL('../' + file, import.meta.url)));
const campus = await read('public/data/campus.json'), site = await read('public/data/site.json');
const boardwalk = campus.features.find(f => f.id === 'local/lake-boardwalk');
const pavilion = campus.features.find(f => f.id === 'local/lake-pavilion');
const pergola = campus.features.find(f => f.id === 'local/wisteria-pergola');
const polygon = shape => [shape.outer, ...(shape.holes || [])];
const area = polygons => polygons.reduce((sum, [outer, ...holes]) => {
  const a = ring => Math.abs(ring.slice(1).reduce((n, p, i) => n + ring[i][0] * p[1] - p[0] * ring[i][1], 0) / 2);
  return sum + a(outer) - holes.reduce((n, ring) => n + a(ring), 0);
}, 0);
const inside = (point, shape) => area(clip.intersection(polygon(shape), [[[point[0] - 1e-4, point[1] - 1e-4], [point[0] + 1e-4, point[1] - 1e-4], [point[0] + 1e-4, point[1] + 1e-4], [point[0] - 1e-4, point[1] + 1e-4], [point[0] - 1e-4, point[1] - 1e-4]]])) > 1e-8;

test('the boardwalk spans the marked lake, meets its pavilion without overlapping floors, and leaves the pavilion entrances open', () => {
  const lake = campus.features.find(f => f.id === 'way/855459418');
  const layout = boardwalkLayout(boardwalk, campus.features), pad = gardenFootprints(pavilion, campus.features)[0];
  assert.ok(area(clip.intersection(layout.deck.map(polygon), polygon(lake))) > area(layout.deck.map(polygon)) * .8);
  assert.ok(Math.abs(area(clip.intersection(polygon(pad), polygon(lake))) - area([polygon(pad)])) < 1e-7, 'Pavilion platform is in the lake');
  assert.ok(area(clip.intersection(layout.deck.map(polygon), polygon(pad))) < 1e-7, 'Joined deck faces do not compete');
  assert.equal(clip.union(layout.deck.map(polygon), polygon(pad)).length, 1, 'The two bank approaches and pavilion share one connected platform');
  assert.equal(layout.height, pavilion.height);
  assert.ok(!inside(boardwalk.points[0], lake) && !inside(boardwalk.points.at(-1), lake), 'Both ends reach dry land');
  const model = pavilion.pavilion, centerIndex = boardwalk.points.findIndex(p => Math.hypot(p[0] - model.center[0], p[1] - model.center[1]) < 1e-7);
  assert.ok(centerIndex > 1 && centerIndex < boardwalk.points.length - 2);
  const local = p => { const dx = p[0] - model.center[0], dz = p[1] - model.center[1]; return [dx * model.axis[0] + dz * model.axis[1], -dx * model.axis[1] + dz * model.axis[0]]; };
  const entrance = local(boardwalk.points[centerIndex - 1]), exit = local(boardwalk.points[centerIndex + 1]);
  assert.ok(Math.abs(entrance[0]) < 1e-7 && Math.abs(entrance[1] + model.span / 2) < 1e-7, 'Entrance is centered on the front edge');
  assert.ok(Math.abs(exit[0] - model.span / 2) < 1e-7 && Math.abs(exit[1]) < 1e-7, 'Exit is centered on the left edge');
  const approach = local(boardwalk.points[centerIndex - 2]), bank = local(boardwalk.points[centerIndex + 2]);
  assert.ok(Math.abs(approach[0]) < 1e-7 && approach[1] < entrance[1], 'Incoming boardwalk meets the front face perpendicularly');
  assert.ok(Math.abs(bank[1]) < 1e-7 && bank[0] > exit[0], 'Outgoing boardwalk runs straight from the left face to the bank');
  const nearestShore = lake.outer.slice(1).map((b, i) => {
    const a = lake.outer[i], dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    const t = Math.max(0, Math.min(1, ((model.center[0] - a[0]) * dx + (model.center[1] - a[1]) * dz) / length ** 2));
    return { tangent: [dx / length, dz / length], distance: Math.hypot(model.center[0] - a[0] - t * dx, model.center[1] - a[1] - t * dz) };
  }).sort((a, b) => a.distance - b.distance)[0];
  const frontDirection = [model.axis[1], -model.axis[0]];
  assert.ok(Math.abs(frontDirection[0] * nearestShore.tangent[0] + frontDirection[1] * nearestShore.tangent[1]) > 1 - 1e-7, 'Pavilion front and incoming boardwalk run tangent to the adjacent shore');
  assert.ok(Math.abs(model.axis[0] * nearestShore.tangent[0] + model.axis[1] * nearestShore.tangent[1]) < 1e-7, 'Left exit heads perpendicularly onto the bank');
  for (const chain of layout.railChains) for (let i = 1; i < chain.length; i++) {
    const a = chain[i - 1], b = chain[i], middle = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2];
    assert.ok(!inside(middle, pad), 'No rail crosses a pavilion entrance');
    assert.equal(a[1], layout.height);
  }
  const planks = boardwalkPlanks(boardwalk, campus.features);
  assert.ok(planks.getAttribute('position').count > 100); planks.dispose();
});

test('the smaller pavilion has an open interior and curved roof, and the simple wisteria building joins the back of the library', () => {
  const roof = pavilionRoofGeometry(pavilion.pavilion, pavilion.height);
  const material = new THREE.MeshBasicMaterial({side: THREE.DoubleSide});
  const mesh = new THREE.Mesh(roof.geometry, material); mesh.updateMatrixWorld();
  try {
    const [x, z] = pavilion.pavilion.center;
    assert.equal(new THREE.Raycaster(new THREE.Vector3(x, pavilion.height + 1.6, z - 20), new THREE.Vector3(0, 0, 1)).intersectObject(mesh).length, 0, 'The roof does not fill the room below');
    assert.ok(new THREE.Raycaster(new THREE.Vector3(x + .4, roof.peak + 5, z + .2), new THREE.Vector3(0, -1, 0)).intersectObject(mesh).length > 0);
    const eave = roof.eaves[0];
    assert.ok(eave[0][1] > eave[8][1] + .2, 'Eave corners turn up');
    assert.ok(roof.peak > Math.max(...eave.map(p => p[1])) + 1);
    const positions = roof.geometry.getAttribute('position'), indices = roof.geometry.index;
    for (let i = 0; i < indices.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i));
      const b = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + 1));
      const c = new THREE.Vector3().fromBufferAttribute(positions, indices.getX(i + 2));
      assert.ok(b.sub(a).cross(c.sub(a)).length() > 1e-6, 'Roof triangles remain usable at the apex');
    }
  } finally { roof.geometry.dispose(); material.dispose(); }
  const pergolaPlan = pergolaLayout(pergola), footprint = pergolaPlan.footprint.map(polygon);
  const library = campus.buildings.find(b => b.id === 'way/855459419');
  assert.ok(pergola.connectedTo.includes(library.id));
  assert.equal(clip.union(footprint, polygon(library)).length, 1, 'The corridor starts flush against the library wall');
  for (const building of campus.buildings) assert.ok(area(clip.intersection(footprint, polygon(building))) < 1e-7, 'The connected corridor does not intrude into the library');
  for (const water of campus.features.filter(f => f.type === 'water')) assert.ok(area(clip.intersection(footprint, polygon(water))) < 1e-7);
  assert.equal(clip.union(footprint).length, 1, 'Curved corridor joins its circular end');
  assert.equal(pergolaPlan.height - pergolaPlan.base, pergola.pergola.floors * pergola.pergola.floorHeight, 'Building height comes from its storey height');
  const wall = library.outer.slice(13, 15), start = pergola.points[0];
  const wallCross = (start[0] - wall[0][0]) * (wall[1][1] - wall[0][1]) - (start[1] - wall[0][1]) * (wall[1][0] - wall[0][0]);
  assert.ok(Math.abs(wallCross) < 1e-7, 'Connection is on the marked back face');
  const [a, b] = wall, startDistance = Math.hypot(start[0] - a[0], start[1] - a[1]);
  assert.ok(startDistance > 0 && startDistance < Math.hypot(b[0] - a[0], b[1] - a[1]));
  const hub = pergola.pergola.hub, middle = pergola.points[Math.floor(pergola.points.length / 2)];
  const bend = (hub[0] - start[0]) * (middle[1] - start[1]) - (hub[1] - start[1]) * (middle[0] - start[0]);
  assert.ok(bend > 0, 'The curve bows to the marked left side of the library, not toward the lake');
});

test('all three garden locations remain selectable and retain their deck height after map regeneration', async () => {
  assert.deepEqual(applyCampusCorrections(campus, await read('data/campus-corrections.json')), campus);
  const locations = campusLocations(campus, site);
  for (const feature of [boardwalk, pavilion, pergola]) {
    assert.equal(locations.find(l => l.id === feature.id).name, feature.name);
    const assigned = assignPhotoLocation({buildingId: '', floor: 0, position:{x:12,z:107,height:1.6}}, feature.id, campus, site);
    assert.equal(assigned.locationId, feature.id); assert.equal(assigned.buildingId, '');
    assert.equal(photoMapHeight(assigned, campus, site), feature.height + 1.6);
    assert.equal(assigned.position.x, 12); assert.equal(assigned.position.z, 107);
  }
});

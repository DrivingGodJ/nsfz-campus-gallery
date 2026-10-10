import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import clip from 'polygon-clipping';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';
import { gardenFootprints, boardwalkLayout, boardwalkPlanks, boardwalkDetails, pavilionDetails, pavilionPoint, pavilionRoofGeometry, pergolaLayout } from '../src/garden-geometry.ts';
import { photoMapHeight, campusLocations, assignPhotoLocation } from '../src/locations.ts';
import { libraryAnnexLayout, wisteriaArchitecture } from '../src/wisteria-architecture.ts';

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

test('a custom timber bank has only its marked waterside rail, continuous post spacing and its own deck outline', () => {
  const rail = [[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [3.4, 2]];
  const outer = [...rail, [3.4, 4], [0, 4], [0, 0]];
  const shore = { id: 'test/bank', type: 'boardwalk', points: [[.5, 1], [1.5, 2], [2.5, 3]], width: 2, height: .37, outer, railEdges: [rail] };
  const layout = boardwalkLayout(shore, []);
  assert.deepEqual(layout.deck, [{ outer, holes: [] }], 'The supplied shoreline outline replaces the centered route slab');
  assert.deepEqual(layout.railChains, [rail.map(([x, z]) => [x, .37, z])], 'No rail appears on the open land side');
  const expected = [[0, .37, 0], [1, .37, .6], [2, .37, 1.2], [2.8, .37, 2], [3.4, .37, 2]];
  assert.equal(layout.posts.length, expected.length, 'Small curve segments do not create an extra post at each vertex');
  layout.posts.forEach((point, i) => point.forEach((value, j) => assert.ok(Math.abs(value - expected[i][j]) < 1e-7, 'Posts continue every 1.6 m along the whole rail, with a final endpoint')));
  const pad = { id: 'test/pad', type: 'lakePavilion', pavilion: { center: [2.5, 3], axis: [1, 0], span: .6 } };
  const joined = boardwalkLayout({ ...shore, connectedTo: [pad.id] }, [pad]), platform = gardenFootprints(pad, [pad])[0];
  assert.ok(area(clip.intersection(joined.deck.map(polygon), polygon(platform))) < 1e-7, 'Custom decks still leave the pavilion to own its floor');
  assert.ok(Math.abs(area(layout.deck.map(polygon)) - area(joined.deck.map(polygon)) - .36) < 1e-7);
  assert.deepEqual(boardwalkLayout({ ...shore, railEdges: [] }, []).railChains, [], 'An explicit empty list leaves the bank fully open');
});

test('the cafeteria wood bank follows the south shore with an open land side and no selectable region', () => {
  const shore = campus.features.find(f => f.id === 'local/cafeteria-wood-shore');
  const lake = campus.features.find(f => f.id === 'way/855459418');
  const layout = boardwalkLayout(shore, campus.features);
  assert.equal(shore.width, 1.5); assert.equal(layout.height, .26); assert.equal(shore.railHeight, .5);
  assert.equal(layout.railChains.length, 1, 'Only the waterside edge has a low timber rail');
  assert.ok(!campusLocations(campus, site).some(location => location.id === shore.id));
  assert.ok(area(layout.deck.map(polygon)) > 30 && area(layout.deck.map(polygon)) < 36, 'The narrow bank is about 22.5 m long');
  assert.ok(area(clip.intersection(layout.deck.map(polygon), polygon(lake))) < 1e-7, 'The deck adjoins the lake without filling it');
  for (const building of campus.buildings) assert.ok(area(clip.intersection(layout.deck.map(polygon), polygon(building))) < 1e-7, 'The wood bank leaves the cafeteria and dormitory clear');
  const photo = site.photos.find(p => p.id === '72cbcabe-914c-4ff3-b21a-fc6197bdd416');
  assert.ok(inside([photo.position.x, photo.position.z], shore), 'The low night photo is taken from the wood bank');
  const planks = boardwalkPlanks(shore, campus.features), details = boardwalkDetails(shore, campus.features);
  try {
    details.caps.computeBoundingBox();
    assert.ok(Math.abs(details.caps.boundingBox.max.y - .76) < 1e-6, 'The capped low rail is only half a metre above the deck');
    assert.ok(planks.getAttribute('position').count > 30, 'Crosswise plank seams remain visible through the curved section');
    for (const geometry of Object.values(details)) assert.ok(geometry.userData.photoOcclusionMask.every(value => value === 0), 'Low wood details do not hide nearby photo markers');
  } finally { planks.dispose(); Object.values(details).forEach(geometry => geometry.dispose()); }
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
  assert.equal(clip.union(footprint).length, 1, 'Curved corridor joins both half-circle end platforms');
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

test('wisteria walkway stays open and its long library-side annex has a straight front-facing shutter', () => {
  const library = campus.buildings.find(b => b.id === 'way/855459419');
  const original = JSON.stringify(pergola), layout = pergolaLayout(pergola), annex = libraryAnnexLayout(library), model = wisteriaArchitecture(pergola, library);
  const meshes = Object.fromEntries(Object.entries(model).map(([key, geometry]) => {
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    mesh.updateMatrixWorld(); return [key, mesh];
  }));
  const down = new THREE.Vector3(0, -1, 0), vector = p => new THREE.Vector3(p[0], 0, p[1]);
  try {
    let distance = 0, center, normal;
    for (let i = 1; i < pergola.points.length; i++) {
      const a = pergola.points[i - 1], b = pergola.points[i], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (distance <= 9.5 && distance + length > 9.5) {
        const t = (9.5 - distance) / length;
        center = new THREE.Vector3(a[0] + (b[0] - a[0]) * t, layout.base + 1.6, a[1] + (b[1] - a[1]) * t);
        normal = new THREE.Vector3(-(b[1] - a[1]) / length, 0, (b[0] - a[0]) / length); break;
      }
      distance += length;
    }
    const side = center.clone().addScaledVector(normal, -2);
    const across = new THREE.Raycaster(side, normal, 0, 4);
    for (const key of ['floor', 'beams', 'posts', 'end', 'arches', 'canopy']) assert.equal(across.intersectObject(meshes[key]).length, 0, 'The passage has no solid wall between its spaced posts');
    const ground = center.clone(); ground.y = 1;
    assert.ok(Math.abs(new THREE.Raycaster(ground, down, 0, 2).intersectObject(meshes.floor)[0].point.y - (layout.base + .08)) < 1e-5, 'The open corridor keeps its walking slab');
    const hub = vector(pergola.pergola.hub); hub.y = layout.base + 1.6;
    const axis = vector(layout.terminal.axis);
    assert.equal(new THREE.Raycaster(hub.clone().addScaledVector(axis, -5), axis, 0, 10).intersectObject(meshes.end).length, 0, 'The staggered shelter has arches instead of solid walls');
    const aboveHub = hub.clone(); aboveHub.y = layout.height + 1;
    assert.equal(new THREE.Raycaster(aboveHub, down, 0, 2).intersectObject(meshes.canopy).length, 0, 'The aerial-confirmed central band remains uncovered between the two roof halves');
    const coveredHub = aboveHub.clone().add(new THREE.Vector3(-axis.z, 0, axis.x).multiplyScalar(2));
    const hubRoof = new THREE.Raycaster(coveredHub, down, 0, 2).intersectObject(meshes.canopy)[0];
    assert.ok(hubRoof && Math.abs(hubRoof.point.y - layout.height) < 1e-5, 'White roof halves stand on either side of the central slot');
    const aboveWalk = center.clone(); aboveWalk.y = layout.height + 1;
    const walkingRoof = new THREE.Raycaster(aboveWalk, down, 0, 2).intersectObject(meshes.canopy)[0];
    assert.ok(walkingRoof && Math.abs(walkingRoof.point.y - layout.height) < 1e-5, 'The curved walkway has the white continuous roof seen from the drone');
    const highAcross = new THREE.Raycaster(side.clone().setY(layout.height - .3), normal, 0, 4);
    assert.ok(highAcross.intersectObject(meshes.arches).length, 'Arched fascia appears above the unobstructed walking space');
    for (const building of campus.buildings) assert.ok(area(clip.intersection(polygon(annex.footprint), polygon(building))) < 1e-7, 'The annex sits outside the existing library footprint');
    assert.equal(clip.union(polygon(annex.footprint), polygon(library)).length, 1, 'The long annex sits flush along the entire marked library wall');
    assert.ok(annex.u1 - annex.u0 > 18 && (annex.u1 - annex.u0) / annex.depth > 4, 'The annex is a long strip rather than the previous small box');
    assert.deepEqual(annex.footprint.outer.slice(0, 3), library.outer.slice(11, 14).reverse(), 'The strip spans both segments of the marked side wall');
    for (const water of campus.features.filter(f => f.type === 'water')) assert.ok(area(clip.intersection(polygon(annex.roof), polygon(water))) < 1e-7);
    assert.ok(area(clip.intersection(polygon(annex.footprint), layout.footprint.map(polygon))) < 1e-7, 'The relocated annex leaves the curved walking route clear');
    const doorCenter = (annex.doorStart + annex.doorEnd) / 2;
    for (let step = 0; step < 3; step++) {
      const p = annex.at(annex.u0 - .3 * (2.5 - step), doorCenter);
      const hit = new THREE.Raycaster(new THREE.Vector3(p[0], 1, p[1]), down, 0, 2).intersectObject(meshes.steps)[0];
      assert.ok(Math.abs(hit.point.y - (layout.base + .08 * (step + 1))) < 1e-5, 'Each of the three entrance steps rises toward the room');
    }
    const outside = annex.at(annex.u0 - 1, doorCenter), towardDoor = vector(annex.at(annex.u0, doorCenter)).sub(vector(outside)).normalize();
    assert.ok(new THREE.Raycaster(new THREE.Vector3(outside[0], 1.6, outside[1]), towardDoor, 0, 2).intersectObject(meshes.door).length, 'The closed louver door faces the stepped approach');
    const positions = model.door.getAttribute('position');
    const frontU = Array.from({ length: positions.count }, (_, i) => (positions.getX(i) - library.outer[13][0]) * annex.along[0] + (positions.getZ(i) - library.outer[13][1]) * annex.along[1]);
    assert.ok(Math.max(...frontU) - Math.min(...frontU) < .031, 'The entire shutter is parallel to the straight front end, without the previous angled door face');
    for (const key of ['floor', 'beams', 'posts', 'roof']) assert.ok(model[key].userData.photoOcclusionMask.every(v => v === 0), 'Thin open structure does not hide corridor photos');
    assert.ok(Object.values(model).reduce((n, geometry) => n + geometry.getAttribute('position').count / 3, 0) < 5000, 'The independent half-circle rims, arches, canopy and annex retain a simple merged model');
    assert.equal(JSON.stringify(pergola), original);
  } finally {
    Object.values(meshes).forEach(mesh => mesh.material.dispose()); Object.values(model).forEach(geometry => geometry.dispose());
  }
});

test('wisteria terminal has two staggered half-circle roofs with a continuous uncovered central passage', () => {
  const layout = pergolaLayout(pergola), { axis, normal, halves } = layout.terminal;
  const model = wisteriaArchitecture(pergola, campus.buildings.find(b => b.id === 'way/855459419'));
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const meshes = Object.fromEntries(Object.entries(model).map(([key, geometry]) => {
    const mesh = new THREE.Mesh(geometry, material); mesh.updateMatrixWorld(); return [key, mesh];
  }));
  const down = new THREE.Vector3(0, -1, 0), hub = pergola.pergola.hub;
  const centerDelta = halves[1].center.map((v, i) => v - halves[0].center[i]);
  const stagger = Math.abs(centerDelta[0] * axis[0] + centerDelta[1] * axis[1]);
  const gap = Math.abs(centerDelta[0] * normal[0] + centerDelta[1] * normal[1]);
  try {
    assert.ok(stagger > 2 && stagger < 3, 'The two half-circle centers are offset along their parallel straight edges');
    assert.ok(gap > .8 && gap < 1.2, 'The open central passage has a walkable width');
    assert.equal(clip.intersection(...halves.map(half => polygon(half.shape))).length, 0, 'The roof halves do not overlap');
    for (const half of halves) {
      const first = half.at(0), last = half.at(1), edge = last.map((v, i) => v - first[i]);
      assert.ok(Math.abs(edge[0] * normal[0] + edge[1] * normal[1]) < 1e-7, 'Both inner diameter edges run parallel');
      const p = half.center.map((v, i) => v + half.sign * normal[i] * pergola.pergola.hubRadius * .5);
      const roof = new THREE.Raycaster(new THREE.Vector3(p[0], layout.height + 1, p[1]), down, 0, 2).intersectObject(meshes.canopy)[0];
      assert.ok(roof && Math.abs(roof.point.y - layout.height) < 1e-5, 'Each separate half-circle has an opaque white roof');
    }
    for (const distance of [-1.5, 0, 1.5]) {
      const p = [hub[0] + axis[0] * distance, hub[1] + axis[1] * distance];
      assert.equal(new THREE.Raycaster(new THREE.Vector3(p[0], layout.height + 1, p[1]), down, 0, 2).intersectObject(meshes.canopy).length, 0, 'No corridor roof fills the open central band');
      const floor = new THREE.Raycaster(new THREE.Vector3(p[0], layout.base + 1, p[1]), down, 0, 2).intersectObject(meshes.floor)[0];
      assert.ok(floor && Math.abs(floor.point.y - (layout.base + .08)) < 1e-5, 'The open band retains a continuous walking floor');
    }
    const start = new THREE.Vector3(hub[0] - axis[0] * 4, layout.base + 1.6, hub[1] - axis[1] * 4);
    const forward = new THREE.Vector3(axis[0], 0, axis[1]);
    for (const key of ['end', 'posts', 'beams']) assert.equal(new THREE.Raycaster(start, forward, 0, 8).intersectObject(meshes[key]).length, 0, 'Half-circle supports leave the central passage open at eye height');
    assert.equal(Object.keys(model).length, 11, 'Both independent shelters reuse the existing merged mesh groups');
  } finally { material.dispose(); Object.values(model).forEach(geometry => geometry.dispose()); }
});


test('photo-informed timber details keep both pavilion approaches open and use a few merged meshes', () => {
  const detail = pavilionDetails(pavilion.pavilion, pavilion.height), walkway = boardwalkDetails(boardwalk, campus.features);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), wood = new THREE.Mesh(detail.timber, material);
  wood.updateMatrixWorld();
  const world = (x, z, y) => { const [wx, wz] = pavilionPoint(pavilion.pavilion, x, z); return new THREE.Vector3(wx, y, wz); };
  const r = pavilion.pavilion.span / 2 - .4, base = pavilion.height;
  try {
    for (const eye of [.9, 1.6]) for (const [start, end] of [[world(0, -4, base + eye), world(0, 0, base + eye)], [world(0, 0, base + eye), world(4, 0, base + eye)]]) {
      assert.equal(new THREE.Raycaster(start, end.clone().sub(start).normalize(), 0, start.distanceTo(end)).intersectObject(wood).length, 0, 'Circular openings and benches leave both entrances clear');
    }
    for (const [x, z] of [[0, r - .12], [-r + .12, 0]]) {
      const hit = new THREE.Raycaster(world(x, z, base + .7), new THREE.Vector3(0, -1, 0), 0, .4).intersectObject(wood)[0];
      assert.ok(hit && Math.abs(hit.point.y - (base + .51)) < 1e-5, 'Seats run along the two non-entrance sides');
    }
    for (const geometry of [...Object.values(walkway), detail.timber, detail.stone, detail.rocks]) {
      assert.ok(geometry.getAttribute('position').count > 0);
      assert.ok(geometry.userData.photoOcclusionMask.every(v => v === 0), 'Open details do not conceal nearby photo markers');
    }
    assert.ok(Object.values(walkway).reduce((n, g) => n + g.getAttribute('position').count / 3, 0) < 4200);
    assert.ok([detail.timber, detail.stone, detail.rocks].reduce((n, g) => n + g.getAttribute('position').count / 3, 0) < 2400);
    assert.equal(detail.tiles.getAttribute('position').count, 840, 'Tile lines stay a single line buffer');
    walkway.supports.computeBoundingBox();
    assert.ok(walkway.supports.boundingBox.max.y < base, 'Structural piles never protrude through the walking slab');
  } finally { material.dispose(); [...Object.values(detail), ...Object.values(walkway)].forEach(geometry => geometry.dispose()); }
});

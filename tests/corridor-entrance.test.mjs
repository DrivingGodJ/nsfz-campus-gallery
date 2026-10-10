import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { undergroundEntranceStair, undergroundLayout } from '../src/underground-geometry.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';
import { sportsGroundPlatform, sportsGroundPlatformLayers, groundElevationAt } from '../src/sports-ground-geometry.ts';
import { campusLocations, photoMapHeight } from '../src/locations.ts';
import { bridgeHeight } from '../src/structure-geometry.ts';

const campus = JSON.parse(fs.readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const site = JSON.parse(fs.readFileSync(new URL('../public/data/site.json', import.meta.url)));
const area = undergroundLayout(campus.features).areas.get('local/underground-corridor');
const stair = undergroundEntranceStair(area.feature);
const field = campus.features.find(feature => feature.type === 'runningTrack');
const gym = campus.buildings.find(building => building.id === 'local/gymnasium');
const bridge = campus.features.find(feature => feature.id === 'local/footbridge');
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-5, message ?? `${actual} equals ${expected}`);
const material = () => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const object = geometry => { const mesh = new THREE.Mesh(geometry, material()); mesh.updateMatrixWorld(); return mesh; };
const prism = (shape, bottom, top) => {
  const outline = new THREE.Shape(shape.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  outline.holes = shape.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
  return object(new THREE.ExtrudeGeometry(outline, { depth: top - bottom, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, bottom, 0));
};
const dispose = meshes => meshes.forEach(mesh => { mesh.geometry.dispose(); mesh.material.dispose(); });
const ray = (point, height, direction, far, meshes) => new THREE.Raycaster(new THREE.Vector3(point[0], height, point[1]), direction, 0, far).intersectObjects(meshes);
const distanceToRing = (point, ring) => Math.min(...ring.slice(1).map((to, i) => {
  const from = ring[i], dx = to[0] - from[0], dz = to[1] - from[1];
  const t = Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(point[0] - from[0] - dx * t, point[1] - from[1] - dz * t);
}));

test('the podium entrance is a real right-half opening with a solid sill, jambs and head', () => {
  const geometry = undergroundDetailGeometry(area.feature, area.footprints, area.openings);
  const meshes = ['walls', 'podium', 'ceiling'].map(kind => object(geometry[kind]));
  const direction = new THREE.Vector3(stair.to[0] - stair.from[0], 0, stair.to[1] - stair.from[1]).normalize();
  const through = (side, height) => ray(stair.at(-.25, side), height, direction, .5, meshes);
  try {
    close(area.feature.height + stair.opening.bottom, 0);
    close(area.feature.height + stair.opening.height, 2.3);
    for (const side of [-.9, 0, .9]) for (const height of [.05, 1.6, 2.25]) {
      assert.equal(through(side, height).length, 0, 'The full door width opens from ground level to its real head');
    }
    assert.ok(through(0, -.4).length, 'The buried wall below the entrance remains solid');
    assert.ok(through(0, 2.45).length, 'The wall above the door remains solid');
    for (const side of [-1.18, 1.18]) assert.ok(through(side, 1.6).length, 'Both door jambs remain solid');
    assert.ok(geometry.podium.attributes.position.count > 0, 'The entrance facade belongs to the podium');
  } finally {
    dispose(meshes);
    Object.entries(geometry).filter(([kind]) => !['walls', 'podium', 'ceiling'].includes(kind)).forEach(([, part]) => part.dispose());
  }
});

test('entrance treads descend continuously to the existing floor and retain usable headroom', () => {
  const geometry = undergroundDetailGeometry(area.feature, area.footprints, area.openings);
  const floor = object(geometry.floor);
  const roof = ['walls', 'podium', 'ceiling', 'metal', 'skylights'].map(kind => object(geometry[kind]));
  const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
  try {
    close(stair.topHeight, 0);
    close(stair.bottomHeight, area.feature.height + .045, 'The final tread meets the corridor floor without a gap');
    for (const [i, tread] of stair.treads.entries()) {
      if (i) assert.deepEqual(tread.from, stair.treads[i - 1].to, 'Successive treads share their complete edge');
      const center = tread.from.map((n, j) => (n + tread.to[j]) / 2);
      const hits = ray(center, tread.height + .1, down, .2, [floor]);
      assert.ok(hits.length, 'Every tread is a real horizontal walking surface');
      close(hits[0].point.y, tread.height);
      const ceiling = ray(center, tread.height + .01, up, 10, roof);
      assert.ok(ceiling.length, 'The stair remains enclosed by its physical roof');
      assert.ok(ceiling[0].point.y - tread.height >= 2.2, 'Roof beams never consume the stair headroom');
    }
    const landing = ray(stair.at(stair.length + .08), stair.bottomHeight + .1, down, .2, [floor]);
    assert.ok(landing.length);
    close(landing[0].point.y, stair.bottomHeight, 'The corridor continues flat beyond the last tread');
  } finally {
    dispose([floor, ...roof]);
    Object.entries(geometry).filter(([kind]) => !['floor', 'walls', 'podium', 'ceiling', 'metal', 'skylights'].includes(kind)).forEach(([, part]) => part.dispose());
  }
});

test('corridor roof glazing receives daylight without the field podium or gym covering it', () => {
  close(area.feature.height + area.feature.wallHeight, field.height, 'The glazing meets the raised athletics ground');
  const geometry = undergroundDetailGeometry(area.feature, area.footprints, area.openings);
  const skylights = object(geometry.skylights), ceiling = object(geometry.ceiling);
  const blockers = [...sportsGroundPlatformLayers(field, campus.features).map(layer => prism(layer.shape, layer.bottom, layer.top)),
    prism(gym, gym.baseElevation, gym.baseElevation + 20)];
  const up = new THREE.Vector3(0, 1, 0), top = field.height;
  try {
    for (const route of [area.feature.points, ...area.feature.branches]) {
      const [from, to] = route, dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
      for (const t of [.01, .1, .25, .5, .75, .9, .99]) for (const side of [.2, 1.25, 2.3]) {
        const point = [from[0] + dx * t - dz / length * side, from[1] + dz * t + dx / length * side];
        assert.ok(ray(point, top - .06, up, .1, [skylights]).length, 'The photographed glazed strip is present');
        assert.equal(ray(point, top - .2, up, .3, [ceiling]).length, 0, 'Opaque roof never fills the glazing');
        assert.equal(ray(point, top - .01, up, 25, blockers).length, 0, 'The gym and podium cannot block light above the glazing');
      }
    }
  } finally {
    dispose([skylights, ceiling, ...blockers]);
    Object.entries(geometry).filter(([kind]) => !['skylights', 'ceiling'].includes(kind)).forEach(([, part]) => part.dispose());
  }
});

test('the gym door, shifted bridge stair and podium edge remain aligned without moving the entrance photo or adding a region', () => {
  const gymEntry = bridge.connections.find(connection => connection.buildingId === gym.id).points.at(-1);
  close(distanceToRing(gymEntry, gym.outer), 0, 'The gym connection terminates exactly on its reduced facade');
  close(bridgeHeight(bridge, campus.buildings, site.buildingOverrides), 5.52, 'The bridge keeps its authorized height');
  const fieldStair = bridge.connections.find(connection => connection.id === 'playground-stairs');
  const [from, to] = area.feature.points, length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const right = [-(to[1] - from[1]) / length, (to[0] - from[0]) / length];
  const stairRightEdge = fieldStair.points.at(-1).map((n, i) => n + right[i] * bridge.width / 2);
  close(distanceToRing(stairRightEdge, sportsGroundPlatform(field).outer), 0, 'The field contour meets the right edge of the shifted stair exit');
  const photo = site.photos.find(item => item.id === '13411ce1-b933-425c-ac78-0a0569842170');
  close(groundElevationAt(campus, [photo.position.x, photo.position.z]), 0, 'DSC06881 stands outside the podium entrance');
  close(photoMapHeight(photo, campus, site), photo.cameraHeight ?? 1.6, 'The completed podium keeps the user-calibrated eye height above ground');
  assert.equal(campus.buildings.length, 19);
  assert.equal(campusLocations(campus, site).length, 41, 'The entrance is part of the existing corridor, with no extra selectable destination');
  assert.equal(campus.features.filter(feature => feature.entranceStair).length, 1);
});

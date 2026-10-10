import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { undergroundMaterialView, undergroundPartVisible, undergroundViewMode } from '../src/underground-mesh.ts';
import { undergroundDetailGeometry } from '../src/underground-details.ts';
import { undergroundLayout } from '../src/underground-geometry.ts';

const room = { floor: -3.8, height: 6.2, footprints: [{ outer: [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]], holes: [] }] };
const other = { floor: -3.8, height: 6.2, footprints: [{ outer: [[20, 0], [30, 0], [30, 8], [20, 8], [20, 0]], holes: [] }] };

test('surface inspection uses the same opaque physical shell as photo views above and below ground', () => {
  const wall = new THREE.MeshStandardMaterial({ transparent: true, opacity: .75, depthTest: false, depthWrite: false });
  try {
    for (const camera of [{ x: 1, y: 80, z: 2 }, { x: 1, y: -2.2, z: 2 }]) {
      const view = undergroundViewMode(camera, room, [room, other], 'surface');
      assert.equal(view, undergroundViewMode(camera, room, [room, other], 'surface', true));
      assert.equal(view, 'inside');
      assert.equal(undergroundPartVisible('volume', view, camera.y, 2.4), false);
      assert.equal(undergroundPartVisible('plan', view, camera.y, 2.4), false);
      assert.equal(undergroundPartVisible('ceiling', view, camera.y, 2.4), true);
      undergroundMaterialView(wall, view, .75);
      assert.equal(wall.transparent, false);
      assert.equal(wall.opacity, 1);
      assert.equal(wall.depthTest, true, 'A real surface slab or building hides the underground fragment');
      assert.equal(wall.depthWrite, true, 'Opaque underground walls hide what is behind them');
      undergroundMaterialView(wall, view, .28, true);
      assert.equal(wall.opacity, .28, 'Only genuine glass retains transparency');
      assert.equal(wall.transparent, true);
      assert.equal(wall.depthWrite, false);
    }
  } finally { wall.dispose(); }
});

test('underground overview exposes detailed floors and walls without translucent coarse volumes or any roof lid', () => {
  const camera = { x: 1, y: 40, z: 2 }, view = undergroundViewMode(camera, room, [room, other], 'underground');
  assert.equal(view, 'overview');
  for (const kind of ['volume', 'plan', 'ceiling']) assert.equal(undergroundPartVisible(kind, view, camera.y, 2.4), false, kind);
  const floor = new THREE.MeshStandardMaterial({ transparent: true, opacity: .75, depthTest: false, depthWrite: false });
  try {
    undergroundMaterialView(floor, view, .75);
    assert.equal(floor.opacity, 1);
    assert.equal(floor.transparent, false);
    assert.equal(floor.depthTest, true);
    assert.equal(floor.depthWrite, true, 'The detailed geometry has normal depth and readable edges');
    undergroundMaterialView(floor, view, .28, true);
    assert.equal(floor.opacity, .28);
    assert.equal(floor.transparent, true);
    assert.equal(floor.depthWrite, false, 'Glass and nets preserve their real transparency');
  } finally { floor.dispose(); }
});

test('photo views retain opaque walls and ceilings from inside, outside, other rooms and above ground', () => {
  const camera = { x: 1, y: -2.2, z: 2 };
  assert.equal(undergroundViewMode(camera, room, [room, other], 'underground'), 'inside');
  assert.equal(undergroundPartVisible('ceiling', 'inside', camera.y, 2.4), true);
  const wall = new THREE.MeshStandardMaterial({ transparent: true, opacity: .75, depthTest: false, depthWrite: false });
  try {
    for (const position of [camera, { x: 21, y: -2.2, z: 2 }, { x: -5, y: -2.2, z: 2 }, { ...camera, y: 30 }]) {
      for (const mode of ['surface', 'underground']) {
        const view = undergroundViewMode(position, room, [room, other], mode, true);
        assert.equal(view, 'inside', 'Every photo uses the same physical enclosure');
        assert.equal(undergroundPartVisible('volume', view, position.y, 2.4), false);
        assert.equal(undergroundPartVisible('plan', view, position.y, 2.4), false);
        assert.equal(undergroundPartVisible('ceiling', view, position.y, 2.4), true);
        undergroundMaterialView(wall, view, .75);
        assert.equal(wall.transparent, false);
        assert.equal(wall.opacity, 1);
        assert.equal(wall.depthTest, true);
        assert.equal(wall.depthWrite, true);
        undergroundMaterialView(wall, view, .28, true);
        assert.equal(wall.opacity, .28, 'Only genuine glass retains transparency');
        assert.equal(wall.depthTest, true, 'Glass still obeys surrounding walls');
      }
    }
  } finally { wall.dispose(); }
});

test('opening the underground lightwell roof preserves its photographed vertical windows', async () => {
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  const corridor = undergroundLayout(campus.features).areas.get('local/underground-corridor');
  const geometry = undergroundDetailGeometry(corridor.feature, corridor.footprints, corridor.openings);
  try {
    assert.ok(geometry.skylights.getAttribute('position').count > 0, 'Roof glazing is independently removable');
    assert.ok(geometry.glass.getAttribute('position').count > 0, 'The vertical window bays remain in the detailed model');
    const top = corridor.feature.height + corridor.feature.wallHeight;
    const positions = geometry.skylights.getAttribute('position');
    for (let i = 0; i < positions.count; i++) assert.ok(Math.abs(positions.getY(i) - top) < .06, 'Only the roof glazing enters the hidden batch');
    assert.equal(undergroundPartVisible('ceiling', 'overview', top + 20, top), false);
    assert.equal(undergroundPartVisible('ceiling', 'inside', corridor.feature.height + 1.6, top), true);
  } finally { Object.values(geometry).forEach(part => part.dispose()); }
});

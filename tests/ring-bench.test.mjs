import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { benchGeometry } from '../src/bench-geometry.ts';

test('the circular timber seat surrounds a clear tree well, keeps fine plank gaps and rests on the ground', () => {
  const model = { center: [0, 0], axis: [1, 0], length: 2.7, innerRadius: .8, depth: .55, seatHeight: .45 };
  const geometry = benchGeometry(model), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const seat = new THREE.Mesh(geometry.seat, material), supports = new THREE.Mesh(geometry.supports, material);
  seat.updateMatrixWorld(); supports.updateMatrixWorld();
  const hits = (x, z, mesh = seat) => new THREE.Raycaster(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0)).intersectObject(mesh);
  try {
    const count = Math.ceil(Math.PI * 2 * (model.innerRadius + model.depth / 2) / .17);
    for (let i = 0; i < count; i++) {
      const angle = (i + .5) * Math.PI * 2 / count;
      for (const radius of [model.innerRadius + .04, model.innerRadius + model.depth / 2, model.innerRadius + model.depth - .04]) {
        const hit = hits(Math.cos(angle) * radius, Math.sin(angle) * radius)[0];
        assert.ok(hit, 'Radial wood planks form a usable seat all around the tree');
        assert.ok(Math.abs(hit.point.y - model.seatHeight) < 1e-6, 'Every seat plank stays at the same usable height');
      }
      for (const radius of [0, model.innerRadius * .95]) {
        assert.equal(hits(Math.cos(angle) * radius, Math.sin(angle) * radius).length, 0, 'The tree well remains open rather than a solid timber disk');
        assert.equal(hits(Math.cos(angle) * radius, Math.sin(angle) * radius, supports).length, 0, 'The supports leave roots and the trunk clear');
      }
      const seam = i * Math.PI * 2 / count, radius = model.innerRadius + model.depth / 2;
      assert.equal(hits(Math.cos(seam) * radius, Math.sin(seam) * radius).length, 0, 'Fine gaps remain between separate timber planks');
    }
    assert.ok(Math.abs(geometry.supports.boundingBox.min.y) < 1e-6, 'All legs reach the ground');
    assert.ok(Math.abs(geometry.seat.boundingBox.max.y - model.seatHeight) < 1e-6, 'No unrequested backrest rises above the seat');
    for (let i = 0; i < 8; i++) {
      const angle = (i + .5) * Math.PI / 4, radius = model.innerRadius + model.depth / 2;
      const ray = new THREE.Raycaster(new THREE.Vector3(Math.cos(angle) * radius, -1, Math.sin(angle) * radius), new THREE.Vector3(0, 1, 0));
      const hit = ray.intersectObject(supports)[0];
      assert.ok(hit && Math.abs(hit.point.y) < 1e-6, 'Each of the eight supports has a real bottom face on the ground');
    }
  } finally { Object.values(geometry).forEach(part => part.dispose()); material.dispose(); }
});

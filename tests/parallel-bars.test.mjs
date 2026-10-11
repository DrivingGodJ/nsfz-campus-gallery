import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { parallelBarsGeometry, parallelBarsFootprint } from '../src/parallel-bars-geometry.ts';

test('parallel bar sets keep two long silver rails, four grounded supports and clear space between the rails', () => {
  const model = { center: [70, 88], axis: [2, 1], length: 3.3, width: .55,
    sets: [{ offset: [0, -.95], height: 1.35 }, { offset: [.25, .95], height: 1.55 }] };
  const geometry = parallelBarsGeometry(model), material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const rails = new THREE.Mesh(geometry.rails, material), posts = new THREE.Mesh(geometry.posts, material);
  try {
    for (const part of Object.values(geometry)) {
      assert.ok([...part.getAttribute('position').array].every(Number.isFinite));
      assert.ok([...part.getAttribute('normal').array].every(Number.isFinite));
      assert.equal(part.userData.photoOcclusionMask, undefined, 'The bars retain normal physical occlusion');
    }
    assert.ok(Math.abs(geometry.pad.boundingBox.min.y) < 1e-6);
    assert.ok(Math.abs(geometry.pad.boundingBox.max.y - .05) < 1e-6);
    assert.ok(Math.abs(geometry.posts.boundingBox.min.y - .05) < 1e-6);
    for (const set of model.sets) {
      for (const side of [-1, 1]) {
        const across = set.offset[1] + side * model.width / 2;
        for (const along of [-.9, 0, .9]) {
          const hit = new THREE.Raycaster(new THREE.Vector3(set.offset[0] + along, 3, across), new THREE.Vector3(0, -1, 0)).intersectObject(rails)[0];
          assert.ok(hit && Math.abs(hit.point.y - (set.height + .027)) < .003, 'Both rails run at a constant equal height through the full usable length');
        }
        for (const along of [-model.length * .34, model.length * .34]) {
          const hit = new THREE.Raycaster(new THREE.Vector3(set.offset[0] + along, 0, across), new THREE.Vector3(0, 1, 0)).intersectObject(posts)[0];
          assert.ok(hit && Math.abs(hit.point.y - .05) < 1e-5, 'Each of the four supports meets the rubber pad');
        }
      }
      assert.equal(new THREE.Raycaster(new THREE.Vector3(set.offset[0], 3, set.offset[1]), new THREE.Vector3(0, -1, 0)).intersectObject(rails).length, 0,
        'The centre remains open rather than being replaced by a single pull-up crossbar');
      assert.ok(geometry.pad.boundingBox.min.x < set.offset[0] - model.length / 2 && geometry.pad.boundingBox.max.x > set.offset[0] + model.length / 2);
      assert.ok(geometry.pad.boundingBox.min.z < set.offset[1] - model.width / 2 && geometry.pad.boundingBox.max.z > set.offset[1] + model.width / 2,
        'The separated sets fit on one pad without crossing the edge');
    }
    const footprint = parallelBarsFootprint(model), object = new THREE.Mesh(geometry.pad, material);
    object.position.set(model.center[0], .02, model.center[1]);
    object.rotation.y = -Math.atan2(model.axis[1], model.axis[0]); object.updateMatrixWorld();
    const local = geometry.pad.boundingBox, corners = [[local.min.x, local.min.z], [local.max.x, local.min.z], [local.max.x, local.max.z], [local.min.x, local.max.z]];
    for (let i = 0; i < corners.length; i++) {
      const p = object.localToWorld(new THREE.Vector3(corners[i][0], 0, corners[i][1]));
      assert.ok(Math.hypot(footprint.outer[i][0] - p.x, footprint.outer[i][1] - p.z) < 1e-6, 'The data footprint agrees with the rotated rendered pad');
    }
  } finally { Object.values(geometry).forEach(part => part.dispose()); material.dispose(); }
});

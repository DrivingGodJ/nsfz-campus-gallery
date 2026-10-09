import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyProps } from '@react-three/fiber';
import { ghostSurfaceModel, SURFACE_CONTEXT_OPACITY } from '../src/map-model-layer.ts';
import { isPhotoOccluder } from '../src/photo-occlusion.ts';

test('surface context fades walls, glass and live outlines and stops blocking underground selection', () => {
  const group = new THREE.Group();
  const materials = [new THREE.MeshBasicMaterial(), new THREE.MeshBasicMaterial({transparent:true, opacity:.4, depthWrite:false})];
  const meshes = materials.map(material => new THREE.Mesh(new THREE.BoxGeometry(), material));
  group.add(...meshes);
  const originalCasts = meshes.map(mesh => mesh.raycast);
  const restore = ghostSurfaceModel(group);
  try {
    for (const [i, mesh] of meshes.entries()) {
      assert.equal(isPhotoOccluder(mesh), false);
      assert.equal(mesh.raycast(new THREE.Raycaster(), []), null);
      const opacity = i ? .27 : 1; // A child can update its outline opacity every frame.
      mesh.material.opacity = opacity;
      mesh.onBeforeRender(null, null, null, null, mesh.material, null);
      assert.equal(mesh.material.opacity, opacity * SURFACE_CONTEXT_OPACITY);
      mesh.onAfterRender(null, null, null, null, mesh.material, null);
      assert.equal(mesh.material.opacity, opacity);
    }
    restore();
    assert.equal(materials[0].transparent, false);
    assert.equal(materials[0].depthWrite, true);
    assert.equal(materials[1].transparent, true);
    assert.equal(materials[1].depthWrite, false);
    meshes.forEach((mesh, i) => assert.equal(mesh.raycast, originalCasts[i]));
    assert.equal(isPhotoOccluder(meshes[0]), true);
  } finally { meshes.forEach(mesh => mesh.geometry.dispose()); materials.forEach(material => material.dispose()); }
});

test('restoring a ghost layer preserves material props committed before its layout cleanup', () => {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  group.add(mesh);
  // R3F replaces the prop snapshot and applies child props in the mutation
  // phase, before the parent's previous useLayoutEffect cleanup runs.
  const instance = { root: { getState: () => ({}) }, parent: null, object: material, props: { transparent: false, depthWrite: true }, handlers: {}, eventCount: 0 };
  material.__r3f = instance;
  const commit = props => {
    const changed = { ...props };
    for (const key of ['transparent', 'depthWrite']) {
      if (key in instance.props && !(key in props)) changed[key] = key === 'depthWrite';
    }
    instance.props = { ...props };
    applyProps(material, changed);
  };
  try {
    const restore = ghostSurfaceModel(group);
    commit({ transparent: true, depthWrite: false, opacity: .62 });
    restore();
    assert.equal(material.transparent, true, 'Selecting a floor retains its newly committed translucency');
    assert.equal(material.depthWrite, false);
    assert.equal(material.opacity, .62);

    const restoreAgain = ghostSurfaceModel(group);
    commit({ transparent: false, depthWrite: true, opacity: 1 });
    restoreAgain();
    assert.equal(material.transparent, false, 'Closing the floor restores the newly committed opaque shell');
    assert.equal(material.depthWrite, true);

    const restoreRemoved = ghostSurfaceModel(group);
    commit({ transparent: true, depthWrite: false });
    restoreRemoved();
    const restoreDefaults = ghostSurfaceModel(group);
    commit({});
    restoreDefaults();
    assert.equal(material.transparent, false, 'Removed props keep the defaults restored by R3F');
    assert.equal(material.depthWrite, true);
  } finally { mesh.geometry.dispose(); material.dispose(); }
});

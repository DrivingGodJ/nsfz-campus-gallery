import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH, type MeshBVHOptions } from 'three-mesh-bvh';

const indexed = new WeakSet<THREE.BufferGeometry>();

// Keep original triangle order: corridor slabs carry a per-face visibility mask.
// Reuse this index for both photo visibility and pointer picking, without changing
// custom raycasts that deliberately make glass and rail details non-interactive.
export function acceleratePhotoOccluder(mesh: THREE.Mesh) {
  if (mesh.raycast !== THREE.Mesh.prototype.raycast && mesh.raycast !== acceleratedRaycast) return;
  const geometry = mesh.geometry;
  if (!geometry.attributes.position?.count) return;
  if (!geometry.boundsTree && !indexed.has(geometry)) {
    // This installed release supports indirect indexing but omits it in its types.
    const options: MeshBVHOptions & { indirect: boolean } = { indirect: true };
    geometry.boundsTree = new MeshBVH(geometry, options);
    indexed.add(geometry);
    geometry.addEventListener('dispose', () => {
      delete geometry.boundsTree;
      indexed.delete(geometry);
    });
  }
  mesh.raycast = acceleratedRaycast;
}

export function isPhotoOccluder(mesh: THREE.Mesh) {
  return mesh.visible && !!mesh.parent && (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
    .some(material => !material.transparent && material.depthWrite);
}

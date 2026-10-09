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

export function isOwnBuildingOccluder(mesh: THREE.Mesh, buildingId?: string) {
  if (!buildingId) return false;
  for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) {
    if (parent.userData.photoOccluder && parent.userData.buildingId === buildingId) return true;
  }
  return false;
}

// Ground surfaces dim underground points without hiding photo thumbnails.
export function isPhotoOpacityOnlyOccluder(mesh: THREE.Mesh) {
  for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) {
    if (parent.userData.photoOpacityOccluder) return true;
  }
  return false;
}

export function photoOpacityRaycast(mesh: THREE.Mesh, ray: THREE.Raycaster, hits: THREE.Intersection[]) {
  // Some ground meshes disable pointer picking. Their actual surface still
  // dims underground markers, without replacing their custom picking handler.
  const cast = isPhotoOpacityOnlyOccluder(mesh) && mesh.raycast !== acceleratedRaycast && mesh.raycast !== THREE.Mesh.prototype.raycast
    ? THREE.Mesh.prototype.raycast : mesh.raycast;
  if (ray.layers.test(mesh.layers)) cast.call(mesh, ray, hits);
}

import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH, type MeshBVHOptions } from 'three-mesh-bvh';

const indexed = new WeakSet<THREE.BufferGeometry>();
const worldBounds = new WeakMap<THREE.Mesh, { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; localBox: THREE.Box3; box: THREE.Box3 }>();

// Reject distant meshes before BVH raycasting has to invert their world matrix.
// A world-axis box is conservative even for rotated, scaled and nested models.
export function photoRayIntersectsOccluder(mesh: THREE.Mesh, ray: THREE.Raycaster) {
  if (mesh instanceof THREE.InstancedMesh || mesh instanceof THREE.SkinnedMesh) return true;
  const geometry = mesh.geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingBox) return true;
  let bounds = worldBounds.get(mesh);
  if (!bounds || bounds.geometry !== geometry) {
    bounds = { geometry, matrix: new THREE.Matrix4(), localBox: new THREE.Box3(), box: new THREE.Box3() };
    worldBounds.set(mesh, bounds);
  }
  if (!bounds.matrix.equals(mesh.matrixWorld) || !bounds.localBox.equals(geometry.boundingBox)) {
    bounds.localBox.copy(geometry.boundingBox);
    bounds.matrix.copy(mesh.matrixWorld); bounds.box.copy(geometry.boundingBox).applyMatrix4(mesh.matrixWorld).expandByScalar(1e-6);
  }
  return ray.ray.intersectsBox(bounds.box);
}

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

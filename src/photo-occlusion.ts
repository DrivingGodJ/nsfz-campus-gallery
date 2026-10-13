import * as THREE from 'three';
import { acceleratedRaycast, MeshBVH, type MeshBVHOptions } from 'three-mesh-bvh';

const indexed = new WeakSet<THREE.BufferGeometry>();
const worldBounds = new WeakMap<THREE.Mesh, { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4; localBox: THREE.Box3; box: THREE.Box3 }>();
const boundHit = new THREE.Vector3();

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
  return bounds.box.containsPoint(ray.ray.origin) || !!ray.ray.intersectBox(bounds.box, boundHit) && boundHit.distanceTo(ray.ray.origin) <= ray.far;
}

// Keep original triangle order: corridor slabs carry a per-face visibility mask.
// Reuse this index for both photo visibility and pointer picking, without changing
// custom raycasts that deliberately make glass and rail details non-interactive.
export function preparePhotoOccluder(mesh: THREE.Mesh) {
  if (mesh instanceof THREE.SkinnedMesh) return;
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
}

export function acceleratePhotoOccluder(mesh: THREE.Mesh) {
  if (mesh.raycast !== THREE.Mesh.prototype.raycast && mesh.raycast !== acceleratedRaycast) return;
  preparePhotoOccluder(mesh);
  mesh.raycast = acceleratedRaycast;
}

export type PhotoPhysicalHit = THREE.Intersection & { worldNormal?: THREE.Vector3 };
const physicalProxies = new WeakMap<THREE.Mesh, THREE.Mesh>();
const physicalMaterials = new WeakMap<THREE.Material, THREE.Material>();
const instanceLocal = new THREE.Matrix4(), instanceWorld = new THREE.Matrix4(), instanceSphere = new THREE.Sphere();
const doubleSided = (material: THREE.Material) => {
  let proxy = physicalMaterials.get(material);
  if (!proxy) { proxy = Object.create(material) as THREE.Material; proxy.side = THREE.DoubleSide; physicalMaterials.set(material, proxy); }
  return proxy;
};

// Query actual geometry, including glass and non-interactive model details, without
// replacing its pointer raycast or changing a shared render material's face side.
// Index construction belongs to the scene collection, never to a marker scan.
export function photoPhysicalRaycast(mesh: THREE.Mesh, ray: THREE.Raycaster, hits: PhotoPhysicalHit[]) {
  if (!ray.layers.test(mesh.layers)) return;
  let proxy = physicalProxies.get(mesh);
  if (!proxy) { proxy = Object.create(mesh) as THREE.Mesh; physicalProxies.set(mesh, proxy); }
  proxy.material = Array.isArray(mesh.material) ? mesh.material.map(doubleSided) : doubleSided(mesh.material);
  const cast = (matrix: THREE.Matrix4, instanceId?: number) => {
    proxy!.matrixWorld = matrix;
    const start = hits.length;
    if (mesh instanceof THREE.SkinnedMesh) THREE.SkinnedMesh.prototype.raycast.call(proxy, ray, hits);
    else acceleratedRaycast.call(proxy!, ray, hits);
    for (let i = start; i < hits.length; i++) {
      const hit = hits[i];
      hit.worldNormal = hit.face?.normal.clone().transformDirection(matrix);
      hit.object = mesh;
      if (instanceId !== undefined) hit.instanceId = instanceId;
    }
  };
  if (mesh instanceof THREE.InstancedMesh) {
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
    if (!ray.ray.intersectsSphere(instanceSphere.copy(mesh.boundingSphere!).applyMatrix4(mesh.matrixWorld))) return;
    for (let i = 0; i < mesh.count; i++) { mesh.getMatrixAt(i, instanceLocal); cast(instanceWorld.multiplyMatrices(mesh.matrixWorld, instanceLocal), i); }
  } else cast(mesh.matrixWorld);
}

export function isPhotoOccluder(mesh: THREE.Mesh) {
  for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) if (parent.userData.markerOccluder === false) return false;
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

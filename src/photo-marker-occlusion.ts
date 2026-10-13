import * as THREE from 'three';
import { photoPhysicalRaycast, photoRayIntersectsOccluder, preparePhotoOccluder, type PhotoPhysicalHit } from './photo-occlusion.ts';

type Layer = { point: THREE.Vector3; normal: THREE.Vector3; parts: Set<string> };
const components = new WeakMap<THREE.BufferGeometry, Uint32Array>();
const cameraLayers = new WeakMap<THREE.Object3D[], { world: THREE.Matrix4; projection: THREE.Matrix4; hits: Map<string, Layer[]> }>();
type SegmentQueries = {
  count: number;
  meshes: { mesh: THREE.Mesh; geometry: THREE.BufferGeometry; positionVersion?: number; instanceVersion?: number; world: THREE.Matrix4; physical: boolean; mask: number; faces: boolean[] }[];
  hits: Map<string, boolean>;
};
const segmentQueries = new WeakMap<THREE.Object3D[], SegmentQueries>();
const epsilon = 1e-5;
const positionVersion = (mesh: THREE.Mesh) => {
  const position = mesh.geometry.attributes.position;
  return position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position?.version;
};

// Disjoint walls can share one render mesh. Weld positions across face normals
// once, so equal-height coplanar walls are still separate physical barriers.
function prepareComponents(geometry: THREE.BufferGeometry) {
  if (components.has(geometry)) return;
  const vertices = geometry.attributes.position;
  if (!vertices?.count) return;
  const parents = Uint32Array.from({ length: vertices.count }, (_, i) => i);
  const root = (i: number): number => { while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; } return i; };
  const welds = new Map<string, number>();
  for (let i = 0; i < vertices.count; i++) {
    const key = [vertices.getX(i), vertices.getY(i), vertices.getZ(i)].map(value => Math.round(value * 1e4)).join(',');
    const previous = welds.get(key);
    if (previous === undefined) welds.set(key, i); else parents[root(i)] = root(previous);
  }
  const index = geometry.index, count = index?.count ?? vertices.count;
  const vertex = (i: number) => index ? index.getX(i) : i;
  for (let i = 0; i + 2 < count; i += 3) { const a = root(vertex(i)); parents[root(vertex(i + 1))] = a; parents[root(vertex(i + 2))] = a; }
  components.set(geometry, Uint32Array.from({ length: Math.floor(count / 3) }, (_, face) => root(vertex(face * 3))));
  geometry.addEventListener('dispose', () => components.delete(geometry));
}

function physicalMaterial(material: THREE.Material, forced = false) {
  return material.visible && material.colorWrite && material.opacity > 0 && !(material instanceof THREE.ShaderMaterial) && (forced || material.depthTest);
}
function forcedMesh(mesh: THREE.Mesh) {
  for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) if (parent.userData.markerOccluder === true) return true;
  return false;
}
function physicalMesh(mesh: THREE.Mesh) {
  if (!mesh.visible || !mesh.parent) return false;
  let forced = false;
  for (let parent: THREE.Object3D | null = mesh; parent; parent = parent.parent) {
    if (!parent.visible || parent.userData.markerOccluder === false || parent.name === 'campus-sky-dome' || parent.type.endsWith('Helper')) return false;
    if (parent.userData.markerOccluder === true) forced = true;
  }
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(material => physicalMaterial(material, forced));
}

export function markerOccluders(scene: THREE.Scene): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = [];
  scene.updateMatrixWorld();
  scene.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh) || !physicalMesh(object)) return;
    preparePhotoOccluder(object); prepareComponents(object.geometry); meshes.push(object);
  });
  return meshes;
}

function hitsBetween(ray: THREE.Raycaster, occluders: THREE.Object3D[]) {
  const hits: PhotoPhysicalHit[] = [];
  for (const object of occluders) if (object instanceof THREE.Mesh && physicalMesh(object) && photoRayIntersectsOccluder(object, ray)) photoPhysicalRaycast(object, ray, hits);
  return hits.filter(hit => {
    const mesh = hit.object as THREE.Mesh;
    const material = Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material;
    // The collector handles explicit helper exclusions. Per-face material groups
    // still need to exclude invisible picking surfaces in a mixed-material mesh.
    return material && physicalMaterial(material, forcedMesh(mesh));
  }).sort((a, b) => a.distance - b.distance);
}
function layerMatches(a: Layer, b: Layer) {
  return Math.abs(a.normal.dot(b.normal)) > .999 && Math.abs(a.normal.dot(a.point.clone().sub(b.point))) < .06;
}
function physicalLayers(ray: THREE.Raycaster, occluders: THREE.Object3D[]) {
  const layers: Layer[] = [], pending = new Map<string, Layer[]>(), last = new Map<string, PhotoPhysicalHit>();
  for (const hit of hitsBetween(ray, occluders)) {
    const mesh = hit.object as THREE.Mesh, normal = hit.worldNormal;
    if (!normal?.lengthSq()) continue;
    const part = mesh.uuid + '/' + (hit.instanceId ?? '') + '/' + (components.get(mesh.geometry)?.[hit.faceIndex ?? -1] ?? '');
    const previous = last.get(part);
    if (previous && previous.point.distanceToSquared(hit.point) < epsilon ** 2 && Math.abs(previous.worldNormal!.dot(normal)) > .999) continue;
    last.set(part, hit);
    const incoming = normal.dot(ray.ray.direction) < 0;
    const entries = pending.get(part) || [];
    if (!incoming && entries.length) entries.pop()!.point.add(hit.point).multiplyScalar(.5);
    else {
      const layer = { point: hit.point.clone(), normal, parts: new Set([part]) };
      layers.push(layer);
      if (incoming) { entries.push(layer); pending.set(part, entries); }
    }
  }
  const distinct: Layer[] = [];
  for (const layer of layers) {
    const existing = distinct.find(other => layerMatches(layer, other));
    if (existing) for (const part of layer.parts) existing.parts.add(part); else distinct.push(layer);
  }
  return distinct;
}
function layersTo(anchor: THREE.Vector3, camera: THREE.Camera, occluders: THREE.Object3D[]) {
  camera.updateWorldMatrix(true, false);
  let cache = cameraLayers.get(occluders);
  if (!cache || !cache.world.equals(camera.matrixWorld) || !cache.projection.equals(camera.projectionMatrix)) {
    cache = { world: camera.matrixWorld.clone(), projection: camera.projectionMatrix.clone(), hits: new Map() }; cameraLayers.set(occluders, cache);
  }
  const key = anchor.toArray().join(',');
  let layers = cache.hits.get(key);
  if (!layers) {
    const ray = new THREE.Raycaster();
    ray.layers.mask = camera.layers.mask;
    if (camera instanceof THREE.PerspectiveCamera) {
      const origin = camera.getWorldPosition(new THREE.Vector3());
      ray.set(origin, anchor.clone().sub(origin).normalize());
    } else {
      const projected = anchor.clone().project(camera);
      ray.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
    }
    ray.far = Math.max(0, ray.ray.origin.distanceTo(anchor) - .015);
    layers = physicalLayers(ray, occluders); cache.hits.set(key, layers);
  }
  return layers;
}

// The occluder list is a scene snapshot; recollect after model/material changes.
// Camera results are reused by every card and pair check in the same view.
export function markerOcclusionLayers(anchor: THREE.Vector3, camera: THREE.Camera, occluders: THREE.Object3D[]): number {
  return layersTo(anchor, camera, occluders).length;
}

// Validate one scene snapshot per marker scan, rather than once for every pair.
// Standalone pair callers retain the same geometry/transform invalidation.
export function prepareMarkerQueries(occluders: THREE.Object3D[]) {
  const faces = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(material => physicalMaterial(material, forcedMesh(mesh)));
  let segments = segmentQueries.get(occluders);
  if (!segments || segments.count !== occluders.length || segments.meshes.some(({ mesh, geometry, positionVersion: version, instanceVersion, world, physical, mask, faces: before }) =>
    mesh.geometry !== geometry || positionVersion(mesh) !== version || !world.equals(mesh.matrixWorld)
    || (mesh instanceof THREE.InstancedMesh ? mesh.instanceMatrix.version : undefined) !== instanceVersion || physicalMesh(mesh) !== physical || mesh.layers.mask !== mask
    || faces(mesh).some((visible, index) => visible !== before[index]))) {
    segments = { count: occluders.length, meshes: occluders.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh).map(mesh => ({
      mesh, geometry: mesh.geometry, positionVersion: positionVersion(mesh),
      instanceVersion: mesh instanceof THREE.InstancedMesh ? mesh.instanceMatrix.version : undefined,
      world: mesh.matrixWorld.clone(), physical: physicalMesh(mesh), mask: mesh.layers.mask, faces: faces(mesh),
    })), hits: new Map() };
    segmentQueries.set(occluders, segments); cameraLayers.delete(occluders);
    for (const { mesh } of segments.meshes) { preparePhotoOccluder(mesh); prepareComponents(mesh.geometry); }
  }
  return segments;
}

export function markerMergeAllowed(a: THREE.Vector3, b: THREE.Vector3, camera: THREE.Camera, occluders: THREE.Object3D[], segments = prepareMarkerQueries(occluders)): boolean {
  const before = layersTo(a, camera, occluders), after = layersTo(b, camera, occluders);
  if (before.length !== after.length || before.some((layer, i) => !layerMatches(layer, after[i]) || ![...layer.parts].some(part => after[i].parts.has(part)))) return false;
  const distance = a.distanceTo(b);
  if (distance <= .03) return true;
  // Physical separation stays unchanged while only the camera moves. The scene
  // snapshot's validated geometry/visibility owns this camera-independent cache.
  const first = a.toArray().join(','), second = b.toArray().join(',');
  const key = camera.layers.mask + ':' + (first < second ? first + ';' + second : second + ';' + first);
  const cached = segments.hits.get(key);
  if (cached !== undefined) return cached;
  const ray = new THREE.Raycaster(a, b.clone().sub(a).divideScalar(distance), .015, distance - .015);
  ray.layers.mask = camera.layers.mask;
  const allowed = hitsBetween(ray, occluders).length === 0;
  // ponytail: bound old coordinate pairs retained during continuous editor drags.
  if (segments.hits.size >= 8192) segments.hits.clear();
  segments.hits.set(key, allowed);
  return allowed;
}

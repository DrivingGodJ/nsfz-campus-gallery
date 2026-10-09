import * as THREE from 'three';
import type { MapPhoto } from './MapCameraRig';
import { MAP_PHOTO_FOCUS_DISTANCE } from './map-card-viewport.ts';
import { acceleratePhotoOccluder, isOwnBuildingOccluder, isPhotoOccluder } from './photo-occlusion.ts';
import { isAerialPhoto, photoLocationId } from './locations.ts';

export const PHOTO_MERGE_METERS = 2;
export const PHOTO_MARKER_LIFT = 1.8;
export const PHOTO_POINT_LIFT = .4;
export type PhotoSpot = { id: string; photos: MapPhoto[]; position: THREE.Vector3 };
export type PhotoCluster = PhotoSpot & { spots: PhotoSpot[] };
const shootingPoint = (photo: MapPhoto) => new THREE.Vector3(photo.position.x, photo.position.height, photo.position.z);
export const photoPointPosition = (photo: MapPhoto) => new THREE.Vector3(photo.position.x, photo.pointHeight ?? photo.position.height + PHOTO_POINT_LIFT, photo.position.z);
const center = (points: THREE.Vector3[]) => points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length);
const markerPoint = (position: THREE.Vector3) => position.clone().add(new THREE.Vector3(0, PHOTO_MARKER_LIFT, 0));
const photoBuildingId = (photo: MapPhoto) => isAerialPhoto(photo) ? undefined : photoLocationId(photo);
function groupPosition(spots: PhotoSpot[]) {
  const middle = center(spots.map(spot => spot.position));
  // Anchor merged thumbnails to a real shooting spot, rather than empty space between distant photos.
  return spots.reduce((nearest, spot) => spot.position.distanceToSquared(middle) < nearest.position.distanceToSquared(middle) ? spot : nearest).position.clone();
}

function photoAnchorVisible(anchor: THREE.Vector3, camera: THREE.Camera, size: { width: number; height: number }, occluders: THREE.Object3D[], ray: THREE.Raycaster, halfSize: [number, number], buildingId?: string) {
  const projected = anchor.clone().project(camera);
  // Keep partially clipped thumbnails at their real position until their entire
  // rectangle leaves the canvas. Depth and building occlusion still apply.
  const marginX = halfSize[0] / Math.max(1, size.width), marginY = halfSize[1] / Math.max(1, size.height);
  if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) >= 1 + marginX * 2 || Math.abs(projected.y) >= 1 + marginY * 2) return false;
  if (!occluders.length) return true;
  ray.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
  ray.far = Math.max(0, ray.ray.origin.distanceTo(anchor) - .12);
  return !ray.intersectObjects(occluders.filter(object => object instanceof THREE.Mesh && isPhotoOccluder(object) && !isOwnBuildingOccluder(object, buildingId)), false).some(hit => {
    const mesh = hit.object as THREE.Mesh;
    const blockingFace = mesh.geometry?.userData.photoOcclusionMask?.[hit.faceIndex ?? -1] !== 0;
    return blockingFace && mesh.visible && mesh.parent && (!mesh.material || (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(material => !material.transparent && material.depthWrite));
  });
}

export function photoPointVisible(position: THREE.Vector3, camera: THREE.Camera, size: { width: number; height: number }, occluders: THREE.Object3D[] = [], ray = new THREE.Raycaster(), halfSize: [number, number] = [32.5, 24], buildingId?: string) {
  return photoAnchorVisible(markerPoint(position), camera, size, occluders, ray, halfSize, buildingId);
}

// Thumbnail grouping never replaces or moves individual shooting points.
export function visiblePhotoPoints(photos: MapPhoto[], camera: THREE.Camera, size: { width: number; height: number }, occluders: THREE.Object3D[] = []): MapPhoto[] {
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  return photos.filter(photo => photoAnchorVisible(photoPointPosition(photo), camera, size, occluders, ray, [4, 4], photoBuildingId(photo)));
}

export function photoOccluders(scene: THREE.Scene) {
  const meshes: THREE.Object3D[] = [];
  scene.updateMatrixWorld();
  scene.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!isPhotoOccluder(object)) return;
    for (let parent = object.parent; parent; parent = parent.parent) {
      if (parent.userData.photoOccluder) { acceleratePhotoOccluder(object); meshes.push(object); break; }
    }
  });
  return meshes;
}
function shootingDistance(a: MapPhoto, b: MapPhoto) {
  const aerial = (photo: MapPhoto) => photo.captureType === 'aerial' || (photo.captureType === undefined && !!photo.metadata?.aerial);
  if (aerial(a) && aerial(b)) {
    if (!a.altitude || !b.altitude || a.altitude.reference !== b.altitude.reference) return Infinity;
    return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z, a.altitude.meters - b.altitude.meters);
  }
  // Sea-level or missing aerial altitude has no known campus-relative height.
  if ([a, b].some(photo => aerial(photo) && photo.altitude?.reference !== 'takeoff')) return Infinity;
  return shootingPoint(a).distanceTo(shootingPoint(b));
}

// Connected neighbours within two metres stay together at every zoom level.
export function permanentPhotoSpots(photos: MapPhoto[]): PhotoSpot[] {
  const sorted = [...photos].sort((a, b) => a.id.localeCompare(b.id));
  const parents = sorted.map((_, i) => i);
  const root = (i: number): number => parents[i] === i ? i : (parents[i] = root(parents[i]));
  for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) {
    if (shootingDistance(sorted[i], sorted[j]) <= PHOTO_MERGE_METERS) parents[root(j)] = root(i);
  }
  const groups = new Map<number, MapPhoto[]>();
  sorted.forEach((photo, i) => { const key = root(i); groups.set(key, [...(groups.get(key) || []), photo]); });
  return [...groups.values()].map(group => ({ id: group[0].id, photos: group, position: center(group.map(shootingPoint)) }));
}

export function cameraPhotoClusters(spots: PhotoSpot[], camera: THREE.Camera, size: { width: number; height: number }, occluders: THREE.Object3D[] = [], appearance: { compact?: boolean; selectedId?: string } = {}): PhotoCluster[] {
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  // Include enough offscreen anchors for the largest possible collage, then
  // test the final group's actual size after merging.
  const maxHalfSize: [number, number] = appearance.selectedId ? [43, 32] : appearance.compact ? [30, 24] : [32.5, 24];
  const projected = spots.flatMap(spot => {
    // Nearby photos may belong to different buildings; only their own shell is ignored.
    const photos = spot.photos.filter(photo => photoPointVisible(spot.position, camera, size, occluders, ray, maxHalfSize, photoBuildingId(photo)));
    if (!photos.length) return [];
    const point = markerPoint(spot.position).project(camera);
    return [{ spot: photos.length === spot.photos.length ? spot : { ...spot, photos }, point: new THREE.Vector2(point.x * size.width / 2, point.y * size.height / 2) }];
  });
  const groups: typeof projected[] = [];
  for (const item of projected) {
    // Bound each group's diameter so nearby chains do not merge the whole campus.
    const group = groups.find(group => group.every(other => other.point.distanceTo(item.point) < 76));
    if (group) group.push(item); else groups.push([item]);
  }
  // Separate member points can still yield overlapping group centres. Merge
  // those centres as well so no thumbnail blocks another thumbnail's hit area.
  const projectCenter = (group: typeof projected) => {
    const point = markerPoint(groupPosition(group.map(item => item.spot))).project(camera);
    return new THREE.Vector2(point.x * size.width / 2, point.y * size.height / 2);
  };
  let merged = true;
  while (merged) {
    merged = false;
    const centers = groups.map(projectCenter);
    for (let i = 0; i < groups.length && !merged; i++) for (let j = i + 1; j < groups.length; j++) {
      if (centers[i].distanceTo(centers[j]) < 76) {
        groups[i].push(...groups[j]); groups.splice(j, 1); merged = true; break;
      }
    }
  }
  return groups.map(group => {
    const members = group.map(item => item.spot);
    return { id: members[0].id, spots: members, photos: members.flatMap(spot => spot.photos), position: groupPosition(members) };
  }).filter(cluster => {
    const selected = cluster.photos.some(photo => photo.id === appearance.selectedId);
    const halfSize: [number, number] = selected ? [43, 32] : appearance.compact ? cluster.photos.length > 1 ? [30, 24] : [22, 18] : [32.5, 24];
    return photoPointVisible(cluster.position, camera, size, [], ray, halfSize);
  });
}

export function clusterFocus(cluster: PhotoCluster) {
  const target = markerPoint(cluster.position);
  return { target: target.toArray() as [number, number, number], distance: MAP_PHOTO_FOCUS_DISTANCE };
}

export function clusterReadyToPick(cluster: PhotoCluster, camera: THREE.Camera) {
  return cluster.spots.length === 1 || !(camera instanceof THREE.PerspectiveCamera)
    || camera.position.distanceTo(markerPoint(cluster.position)) <= MAP_PHOTO_FOCUS_DISTANCE + 1;
}

export function collagePhotos(photos: MapPhoto[]): MapPhoto[] {
  if (!photos.length) return [];
  return photos.slice(0, photos.length < 4 ? 2 : 4);
}

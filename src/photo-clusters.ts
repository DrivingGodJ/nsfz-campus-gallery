import * as THREE from 'three';
import type { MapPhoto } from './MapCameraRig';
import { MAP_PHOTO_FOCUS_DISTANCE } from './map-card-viewport.ts';
import { acceleratePhotoOccluder, isOwnBuildingOccluder, isPhotoOccluder, isPhotoOpacityOnlyOccluder, photoOpacityRaycast, photoRayIntersectsOccluder } from './photo-occlusion.ts';
import { isAerialPhoto, photoLocationId } from './locations.ts';
import { campusLocations } from './locations.ts';
import { buildingLevels } from './building-model.ts';
import { dormitoryObservatory } from './facade-geometry.ts';
import { featureFootprints } from './location-geometry.ts';
import { insideShape } from './terrain-height.ts';
import { markerMergeAllowed, markerOcclusionLayers, prepareMarkerQueries } from './photo-marker-occlusion.ts';
import type { Campus, Shape, Site } from './types';

export const PHOTO_MERGE_METERS = 2;
export const PHOTO_MARKER_LIFT = 1.8;
export const PHOTO_POINT_LIFT = .4;
export type PhotoSpot = { id: string; photos: MapPhoto[]; position: THREE.Vector3 };
export type PhotoCluster = PhotoSpot & { spots: PhotoSpot[]; markerWidth?: number; markerHeight?: number; opacity?: number; regionId?: string; regionName?: string; collapsed?: boolean; overflow?: boolean; occlusionLayers?: number; cameraDistance?: number };
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

function photoAnchorUnblocked(anchor: THREE.Vector3, camera: THREE.Camera, occluders: THREE.Mesh[], ray: THREE.Raycaster) {
  if (!occluders.length) return true;
  const projected = anchor.clone().project(camera);
  ray.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
  ray.layers.mask = camera.layers.mask;
  ray.far = Math.max(0, ray.ray.origin.distanceTo(anchor) - .12);
  const hits: THREE.Intersection[] = [];
  for (const mesh of occluders) {
    if (!photoRayIntersectsOccluder(mesh, ray)) continue;
    hits.length = 0; ray.intersectObject(mesh, false, hits);
    if (hits.some(hit => mesh.geometry?.userData.photoOcclusionMask?.[hit.faceIndex ?? -1] !== 0
      && mesh.visible && mesh.parent && (!mesh.material || (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(material => !material.transparent && material.depthWrite)))) return false;
  }
  return true;
}

function photoAnchorVisible(anchor: THREE.Vector3, camera: THREE.Camera, size: { width: number; height: number }, occluders: THREE.Mesh[], ray: THREE.Raycaster, halfSize: [number, number]) {
  const projected = anchor.clone().project(camera);
  // Keep partially clipped thumbnails at their real position until their entire
  // rectangle leaves the canvas. Depth and building occlusion still apply.
  const marginX = halfSize[0] / Math.max(1, size.width), marginY = halfSize[1] / Math.max(1, size.height);
  if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) >= 1 + marginX * 2 || Math.abs(projected.y) >= 1 + marginY * 2) return false;
  return photoAnchorUnblocked(anchor, camera, occluders, ray);
}

export function photoPointOpacity(anchor: THREE.Vector3, camera: THREE.Camera, occluders: THREE.Object3D[], ray = new THREE.Raycaster()) {
  const projected = anchor.clone().project(camera);
  ray.setFromCamera(new THREE.Vector2(projected.x, projected.y), camera);
  ray.far = Math.max(0, ray.ray.origin.distanceTo(anchor) - .12);
  const layers: { point: THREE.Vector3; normal: THREE.Vector3 }[] = [];
  const hits: THREE.Intersection[] = [];
  for (const mesh of occluders) if (mesh instanceof THREE.Mesh && isPhotoOccluder(mesh) && photoRayIntersectsOccluder(mesh, ray)) photoOpacityRaycast(mesh, ray, hits);
  hits.sort((a, b) => a.distance - b.distance);
  for (const hit of hits) {
    const mesh = hit.object as THREE.Mesh;
    // The thumbnail mask lets corridor photos stay clickable, but the real
    // opaque slabs still contribute to the softer marker's depth cue.
    if (!hit.face) continue;
    const normal = hit.face.normal.clone().transformDirection(mesh.matrixWorld);
    // One physical wall/slab includes both faces and any coincident triangles.
    // Compare thickness along the face normal so oblique views do not count a
    // thin slab twice merely because the ray travels far between its faces.
    if (layers.some(layer => Math.abs(normal.dot(layer.normal)) > .95 && Math.abs(hit.point.clone().sub(layer.point).dot(layer.normal)) < .5)) continue;
    layers.push({ point: hit.point, normal });
  }
  return Math.max(.14, .85 * .62 ** layers.length);
}

export function photoPointVisible(position: THREE.Vector3, camera: THREE.Camera, size: { width: number; height: number }, occluders: THREE.Object3D[] = [], ray = new THREE.Raycaster(), halfSize: [number, number] = [32.5, 24], buildingId?: string) {
  const blockers = occluders.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh && isPhotoOccluder(object) && !isPhotoOpacityOnlyOccluder(object) && !isOwnBuildingOccluder(object, buildingId));
  return photoAnchorVisible(markerPoint(position), camera, size, blockers, ray, halfSize);
}

// Thumbnail grouping never replaces or moves individual shooting points.
export function visiblePhotoPoints(photos: MapPhoto[], camera: THREE.Camera, size: { width: number; height: number }, occluders: THREE.Object3D[] = []): MapPhoto[] {
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  return photos.flatMap(photo => {
    const anchor = photoPointPosition(photo);
    if (!photoAnchorVisible(anchor, camera, size, [], ray, [3, 3])) return [];
    return [{ ...photo, pointOpacity: photoPointOpacity(anchor, camera, occluders, ray) }];
  });
}

export function photoOccluders(scene: THREE.Scene) {
  const meshes: THREE.Object3D[] = [];
  scene.updateMatrixWorld();
  scene.traverseVisible(object => {
    if (!(object instanceof THREE.Mesh)) return;
    if (!isPhotoOccluder(object)) return;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      if (parent.userData.photoOccluder || parent.userData.photoOpacityOccluder) { acceleratePhotoOccluder(object); meshes.push(object); break; }
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

export function cameraPhotoClusters(spots: PhotoSpot[], camera: THREE.Camera, size: { width: number; height: number }, occluders: THREE.Object3D[] = [], appearance: { compact?: boolean; minimal?: boolean; selectedId?: string } = {}): PhotoCluster[] {
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  // Include enough offscreen anchors for the largest possible collage, then
  // test the final group's actual size after merging.
  const maxHalfSize: [number, number] = appearance.minimal ? [22, 22] : appearance.selectedId ? [43, 32] : appearance.compact ? [30, 24] : [32.5, 24];
  const hardOccluders = occluders.filter((object): object is THREE.Mesh => object instanceof THREE.Mesh && isPhotoOccluder(object) && !isPhotoOpacityOnlyOccluder(object));
  const byBuilding = new Map<string | undefined, THREE.Mesh[]>();
  const blockers = (buildingId?: string) => {
    let list = byBuilding.get(buildingId);
    if (!list) { list = hardOccluders.filter(mesh => !isOwnBuildingOccluder(mesh, buildingId)); byBuilding.set(buildingId, list); }
    return list;
  };
  const projected = spots.flatMap(spot => {
    // Nearby photos may belong to different buildings; only their own shell is ignored.
    const visible = new Map<string | undefined, boolean>();
    const anchor = markerPoint(spot.position);
    const photos = spot.photos.filter(photo => {
      const buildingId = photoBuildingId(photo);
      if (!visible.has(buildingId)) visible.set(buildingId, photoAnchorVisible(anchor, camera, size, blockers(buildingId), ray, maxHalfSize));
      return visible.get(buildingId);
    });
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
    const halfSize: [number, number] = appearance.minimal ? [22, 22] : selected ? [43, 32] : appearance.compact ? cluster.photos.length > 1 ? [30, 24] : [22, 18] : [32.5, 24];
    return photoPointVisible(cluster.position, camera, size, [], ray, halfSize);
  });
}

export const PHOTO_REGION_EXPAND_DISTANCE = 60;
export function photoMarkerSize(distance: number) {
  const markerWidth = Math.round(Math.min(88, Math.max(46, 3000 / (Number.isFinite(distance) ? Math.max(1, distance) : Infinity))));
  return { markerWidth, markerHeight: Math.round(Math.max(44, markerWidth * .75)) };
}

type PhotoRegion = { id: string; name: string; footprints: Shape[]; bounds: THREE.Box3; landscape: boolean; building: boolean; interiors: { shape: Shape; bottom: number; top: number }[] };
const regionGeometry = new WeakMap<Campus, { site: Site; regions: PhotoRegion[] }>();
type PhotoRegionAssignment = { campus: Campus; site: Site; x: number; y: number; z: number; locationId: string | undefined; aerial: boolean; region?: PhotoRegion; id: string; name: string; spot: PhotoSpot; inside: boolean };
const photoRegionAssignments = new WeakMap<MapPhoto, PhotoRegionAssignment>();
function photoRegions(campus: Campus, site: Site) {
  const cached = regionGeometry.get(campus);
  if (cached?.site.buildingOverrides === site.buildingOverrides) return cached.regions;
  const regions = campusLocations(campus, site).map(location => {
    const info = location.building ? buildingLevels(location.building, site.buildingOverrides[location.id]) : undefined;
    const footprints: Shape[] = info ? info.sections.map(part => ({ outer: part.outer, holes: part.holes || [] }))
      : featureFootprints(location.feature!, campus.features, location.surfaceHeight);
    const bottom = info?.baseElevation ?? location.surfaceHeight;
    const top = bottom + (info?.height ?? location.feature?.wallHeight ?? 3.6);
    const bounds = new THREE.Box3().setFromPoints(footprints.flatMap(shape => shape.outer.flatMap(([x, z]) => [new THREE.Vector3(x, bottom, z), new THREE.Vector3(x, top, z)])));
    const interiors = info ? info.sections.map((section, index) => ({ shape: footprints[index], bottom, top: bottom + section.height })) : [];
    const observatory = info?.observatoryFloor && location.building ? dormitoryObservatory(location.building, info.floorHeight) : undefined;
    if (observatory) {
      const roomBottom = bottom + observatory.floorY, roomTop = roomBottom + observatory.drumRise + observatory.domeRise + .01;
      interiors.push({ shape: observatory.shape, bottom: roomBottom, top: roomTop });
      footprints.push(observatory.shape);
      for (const [x, z] of observatory.shape.outer) bounds.expandByPoint(new THREE.Vector3(x, roomTop, z));
    }
    return { id: location.id, name: location.name, footprints, bounds, building: !!location.building, interiors,
      landscape: !!location.feature && ['water', 'forest', 'plaza', 'runningTrack', 'basketballCourts', 'sport', 'green'].includes(location.feature.type) };
  });
  regionGeometry.set(campus, { site, regions });
  return regions;
}

function photoRegionAssignment(photo: MapPhoto, campus: Campus, site: Site, regions: PhotoRegion[], known: Map<string, PhotoRegion>, origin: number[]) {
  const { x, height: y, z } = photo.position, locationId = photoLocationId(photo, campus), aerial = isAerialPhoto(photo);
  const cached = photoRegionAssignments.get(photo);
  if (cached?.campus === campus && cached.site.buildingOverrides === site.buildingOverrides && cached.x === x && cached.y === y && cached.z === z
    && cached.locationId === locationId && cached.aerial === aerial) return cached;
  const position = shootingPoint(photo), point: [number, number] = [x, z];
  const inferred = locationId ? undefined : regions.filter(region => y >= region.bounds.min.y - .5 && y <= region.bounds.max.y + .5
    && region.footprints.some(shape => insideShape(point, shape))).sort((a, b) => {
    const spanA = a.bounds.getSize(new THREE.Vector3()), spanB = b.bounds.getSize(new THREE.Vector3());
    return spanA.x * spanA.z - spanB.x * spanB.z;
  })[0];
  const nearby = locationId || inferred ? undefined : regions.filter(region => region.landscape && y >= region.bounds.min.y - .5
    && y <= region.bounds.max.y + .5 && region.bounds.distanceToPoint(position) <= 30)
    .sort((a, b) => a.bounds.distanceToPoint(position) - b.bounds.distanceToPoint(position))[0];
  // ponytail: 96 m outdoor tiles bound unspecified areas; use mapped polygons
  // when the archive gains explicit destinations for those spaces.
  const tileX = Math.floor(x / 96), tileZ = Math.floor(z / 96);
  const id = locationId || inferred?.id || nearby?.id || `outdoor/${tileX}/${tileZ}`;
  const region = known.get(id) || inferred || nearby, dx = (tileX + .5) * 96 - origin[0], dz = (tileZ + .5) * 96 - origin[1];
  const direction = Math.abs(dx) > Math.abs(dz) ? dx < 0 ? '西' : '东' : dz < 0 ? '北' : '南';
  const inside = !aerial && !!region?.interiors.some(section => y >= section.bottom && y < section.top && insideShape(point, section.shape));
  const assignment = { campus, site, x, y, z, locationId, aerial, region, id, name: region?.name || '校园' + direction + '侧', spot: { id: photo.id, photos: [photo], position }, inside };
  photoRegionAssignments.set(photo, assignment);
  return assignment;
}

// Public map markers aggregate by a real destination first, and only compare
// neighbouring screen cards after that destination is close enough to explore.
export function regionPhotoClusters(photos: MapPhoto[], camera: THREE.Camera, size: { width: number; height: number }, occluders: THREE.Object3D[], options: { campus: Campus; site: Site; selectedId?: string }): PhotoCluster[] {
  camera.updateMatrixWorld();
  const regions = photoRegions(options.campus, options.site), known = new Map(regions.map(region => [region.id, region]));
  const markerQueries = prepareMarkerQueries(occluders);
  const hardOccluders = occluders.filter((object): object is THREE.Mesh => {
    if (!(object instanceof THREE.Mesh) || !isPhotoOccluder(object) || isPhotoOpacityOnlyOccluder(object)) return false;
    for (let parent: THREE.Object3D | null = object; parent; parent = parent.parent) {
      if (parent.userData.photoOccluder) { acceleratePhotoOccluder(object); return true; }
    }
    return false;
  });
  const boundary = options.campus.boundary || [], boundaryX = boundary.map(point => point[0]), boundaryZ = boundary.map(point => point[1]);
  const origin = boundary.length ? [(Math.min(...boundaryX) + Math.max(...boundaryX)) / 2, (Math.min(...boundaryZ) + Math.max(...boundaryZ)) / 2] : [0, 0];
  const groups = new Map<string, { region?: PhotoRegion; name: string; spots: PhotoSpot[]; inside: Set<string> }>();
  for (const photo of [...photos].sort((a, b) => a.id.localeCompare(b.id))) {
    if (![photo.position.x, photo.position.z, photo.position.height].every(Number.isFinite)) continue;
    const { id, name, region, spot, inside } = photoRegionAssignment(photo, options.campus, options.site, regions, known, origin);
    let group = groups.get(id);
    if (!group) {
      group = { region, name, spots: [], inside: new Set() }; groups.set(id, group);
    }
    group.spots.push(spot); if (inside) group.inside.add(spot.id);
  }
  const result: PhotoCluster[] = [], ray = new THREE.Raycaster();
  for (const [regionId, group] of groups) {
    const regionName = group.spots.every(spot => isAerialPhoto(spot.photos[0])) ? '航拍' : group.name;
    const bounds = group.region && !group.region.bounds.isEmpty() ? group.region.bounds
      : new THREE.Box3().setFromPoints(group.spots.map(spot => spot.position));
    const distance = Math.min(bounds.distanceToPoint(camera.position), ...group.spots.map(spot => spot.position.distanceTo(camera.position)));
    const collapsed = !group.spots.some(spot => spot.id === options.selectedId) && distance > PHOTO_REGION_EXPAND_DISTANCE;
    const inside = group.inside;
    const appearance = (spot: PhotoSpot) => {
      const occlusionLayers = !collapsed && inside.has(spot.id) ? markerOcclusionLayers(spot.position, camera, occluders) : 0;
      return { opacity: Math.max(.18, .68 ** occlusionLayers), occlusionLayers, cameraDistance: spot.position.distanceTo(camera.position) };
    };
    const dimensions = (spot: PhotoSpot) => photoMarkerSize(camera.position.distanceTo(spot.position));
    const halfSize = (spot: PhotoSpot, grouped: boolean): [number, number] => {
      const { markerWidth, markerHeight } = dimensions(spot), count = grouped ? 6 : 0;
      return [collapsed ? Math.max(markerWidth / 2 + count, 55) : markerWidth / 2 + count, markerHeight / 2 + (collapsed ? 21 : count)];
    };
    // Project first: fully offscreen destinations need no physical rays. A far
    // collection still keeps all unblocked members, including offscreen shots.
    const inView = group.spots.filter(spot => photoAnchorVisible(spot.position, camera, size, [], ray, halfSize(spot, true)));
    if (!inView.length) continue;
    const otherBuildings = hardOccluders.filter(mesh => !isOwnBuildingOccluder(mesh, regionId));
    const eligible = (collapsed ? group.spots : inView).filter(spot => photoAnchorUnblocked(spot.position, camera, inside.has(spot.id) ? otherBuildings : hardOccluders, ray));
    const eligibleIds = new Set(eligible.map(spot => spot.id));
    const visible = collapsed ? inView.filter(spot => eligibleIds.has(spot.id)) : eligible;
    if (!visible.length) continue;
    const clusters: PhotoSpot[][] = [];
    if (collapsed) clusters.push(eligible);
    else {
      const projections = new Map(visible.map(spot => {
        const projected = spot.position.clone().project(camera);
        return [spot.id, { x: projected.x * size.width / 2, y: projected.y * size.height / 2, ...dimensions(spot) }];
      }));
      const compatible = (a: PhotoSpot, b: PhotoSpot) => {
        const first = a.photos[0], second = b.photos[0];
        if (isAerialPhoto(first) !== isAerialPhoto(second) || first.floor !== second.floor || inside.has(a.id) !== inside.has(b.id)) return false;
        const pa = projections.get(a.id)!, pb = projections.get(b.id)!;
        return Math.abs(pa.x - pb.x) < (pa.markerWidth + pb.markerWidth) / 2 + 6
          && Math.abs(pa.y - pb.y) < (pa.markerHeight + pb.markerHeight) / 2 + 6
          && markerMergeAllowed(a.position, b.position, camera, occluders, markerQueries);
      };
      for (const spot of visible) {
        const cluster = clusters.find(items => items.every(other => compatible(spot, other)));
        if (cluster) cluster.push(spot); else clusters.push([spot]);
      }
    }
    const middle = bounds.getCenter(new THREE.Vector3()), regional: PhotoCluster[] = [];
    for (const spots of clusters) {
      const candidates = (collapsed ? visible : spots).filter(spot => photoAnchorVisible(spot.position, camera, size, [], ray, halfSize(spot, spots.length > 1)));
      if (!candidates.length) continue;
      const representative = candidates.find(spot => spot.id === options.selectedId)
        || candidates.reduce((nearest, spot) => spot.position.distanceToSquared(middle) < nearest.position.distanceToSquared(middle) ? spot : nearest);
      regional.push({ id: collapsed ? 'region/' + regionId + '/' + representative.id : representative.id, photos: spots.flatMap(spot => spot.photos), spots,
        position: representative.position.clone(), ...dimensions(representative), cameraDistance: representative.position.distanceTo(camera.position),
        regionId, regionName, collapsed, overflow: false });
    }
    if (group.region?.building && !collapsed) {
      regional.sort((a, b) => a.cameraDistance! - b.cameraDistance! || a.id.localeCompare(b.id));
      if (regional.length > 10) {
        const remainder = regional.splice(10), spots = remainder.flatMap(cluster => cluster.spots);
        const nearest = spots.reduce((first, spot) => spot.position.distanceToSquared(camera.position) < first.position.distanceToSquared(camera.position) ? spot : first);
        const cameraDistance = nearest.position.distanceTo(camera.position);
        regional.push({ ...remainder[0], id: 'overflow/' + regionId + '/' + nearest.id,
          photos: remainder.flatMap(cluster => cluster.photos), spots, position: nearest.position.clone(),
          ...photoMarkerSize(cameraDistance), cameraDistance,
          collapsed: false, overflow: true });
      }
    }
    for (const cluster of regional) {
      const representative = cluster.spots.find(spot => spot.position.equals(cluster.position))!;
      result.push({ ...cluster, ...appearance(representative) });
    }
  }
  return result;
}

export function clusterFocus(cluster: PhotoCluster) {
  const target = markerPoint(cluster.position);
  return { target: target.toArray() as [number, number, number], distance: MAP_PHOTO_FOCUS_DISTANCE };
}

export function clusterReadyToPick(cluster: PhotoCluster, camera: THREE.Camera, direct = false) {
  return direct || cluster.spots.length === 1 || !(camera instanceof THREE.PerspectiveCamera)
    || camera.position.distanceTo(markerPoint(cluster.position)) <= MAP_PHOTO_FOCUS_DISTANCE + 1;
}

export function collagePhotos(photos: MapPhoto[]): MapPhoto[] {
  if (!photos.length) return [];
  return photos.slice(0, photos.length < 4 ? 2 : 4);
}

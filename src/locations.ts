import { bridgeHeight, bridgeSurfaceHeight, curvedStairSurfaceHeight } from './structure-geometry.ts';
import { buildingLevels } from './building-model.ts';
import { groundElevationAt } from './sports-ground-geometry.ts';
import type { Building, Campus, Feature, Photo, Site } from './types';

export type CampusLocation = { id: string; name: string; kind: 'building' | 'feature'; surfaceHeight: number; levelText: string; building?: Building; feature?: Feature };

export function featureSurfaceHeight(feature: Feature, campus: Campus, site: Site) {
  if (feature.type === 'bridge') return bridgeHeight(feature, campus.buildings, site.buildingOverrides);
  if (feature.type === 'tunnelEntrance' && feature.curvedStair) return feature.curvedStair.topHeight;
  return feature.height ?? 0;
}

export function campusLocations(campus: Campus, site: Site): CampusLocation[] {
  return [
    ...campus.buildings.map((building, i) => ({ id: building.id,
      name: site.buildingOverrides[building.id]?.name || building.name || '未命名建筑 ' + String(i + 1).padStart(2, '0'),
      kind: 'building' as const, building, surfaceHeight: building.baseElevation ?? 0, levelText: '楼层' })),
    ...campus.features.filter(feature => !!feature.name?.trim()).map(feature => ({
      id: feature.id, name: feature.name!.trim(), kind: 'feature' as const, feature,
      surfaceHeight: featureSurfaceHeight(feature, campus, site),
      levelText: feature.type === 'tunnelEntrance' ? '入口 / 楼梯' : feature.type === 'bridge' ? '桥面' : feature.type === 'boardwalk' ? '栈道' : (feature.height ?? 0) < 0 ? '地下' : '地面'
    }))
  ];
}

// Annotation and filtering share broad destinations, including circulation spaces.
const ancillaryBuildingIds = new Set(['way/1277841229', 'local/stand-office']);
const filterFeatureTypes = new Set<Feature['type']>(['water', 'forest', 'sport', 'runningTrack', 'basketballCourts', 'undergroundRoom', 'tunnel', 'tunnelEntrance', 'undergroundCorridor', 'undergroundTrack']);
export const isFilterableCampusFeature = (feature: Feature) => filterFeatureTypes.has(feature.type) || feature.id === 'local/footbridge';
export function campusFilterLocations(campus: Campus, site: Site): CampusLocation[] {
  return campusLocations(campus, site).filter(location => location.building
    ? !ancillaryBuildingIds.has(location.id)
    : !!location.feature && isFilterableCampusFeature(location.feature));
}

export function resolveLocationId(id: string, campus?: Campus) {
  const seen = new Set<string>();
  while (campus?.buildingAliases?.[id] && !seen.has(id)) {
    seen.add(id);
    id = campus.buildingAliases[id];
  }
  return id;
}

// Resolve legacy building aliases without changing the horizontal shooting position.
export const photoLocationId = (photo: Pick<Photo, 'locationId' | 'buildingId'>, campus?: Campus) => resolveLocationId(photo.locationId ?? photo.buildingId ?? '', campus);

export const isAerialPhoto = (photo: Photo) => photo.captureType === 'aerial' || (photo.captureType === undefined && !!photo.metadata?.aerial);
// A directory filter, never a destination offered during photo annotation.
export const AERIAL_LOCATION_FILTER = 'capture/aerial';
export const altitudeLabel = (photo: Photo) => photo.altitude?.reference === 'seaLevel' ? '拍摄海拔' : '航拍高度（相对起飞点）';

export function photoCameraHeightRange(photo: Photo, campus: Campus, site: Site) {
  const id = photoLocationId(photo, campus), building = campus.buildings.find(b => b.id === id);
  const feature = campus.features.find(f => f.id === id);
  const clearHeight = building ? buildingLevels(building, site.buildingOverrides[id]).floorHeight
    : feature && (feature.height ?? 0) < 0 ? feature.wallHeight ?? 3.6 : 3.6;
  return { min: .1, max: Math.max(.1, clearHeight - .1) };
}

export function photoMapHeight(photo: Photo, campus: Campus, site: Site) {
  if (isAerialPhoto(photo)) {
    // Sea-level altitude cannot be converted to campus-relative height without a ground datum.
    return photo.altitude?.reference === 'takeoff' ? photo.altitude.meters : 1.6;
  }
  const range = photoCameraHeightRange(photo, campus, site);
  const cameraHeight = Math.min(range.max, Math.max(range.min, Number.isFinite(photo.cameraHeight) ? photo.cameraHeight! : 1.6));
  const id = photoLocationId(photo, campus), building = campus.buildings.find(b => b.id === id);
  if (building) {
    const info = buildingLevels(building, site.buildingOverrides[id]);
    return info.baseElevation + (Math.max(1, photo.floor) - 1) * info.floorHeight + cameraHeight;
  }
  const feature = campus.features.find(f => f.id === id);
  if (!feature) return groundElevationAt(campus, [photo.position.x, photo.position.z]) + cameraHeight;
  const surface = featureSurfaceHeight(feature, campus, site);
  if (feature.type === 'tunnelEntrance' && feature.curvedStair) return curvedStairSurfaceHeight(feature.curvedStair, [photo.position.x, photo.position.z]) + cameraHeight;
  return (feature.type === 'bridge' ? bridgeSurfaceHeight(feature, surface, [photo.position.x, photo.position.z]) : surface) + cameraHeight;
}

export function samePhotoSpot(a: Photo, b: Photo, campus: Campus, site: Site) {
  if (isAerialPhoto(a) && isAerialPhoto(b) && (a.altitude?.reference !== b.altitude?.reference
    || (a.altitude && b.altitude && Math.abs(a.altitude.meters - b.altitude.meters) >= 2))) return false;
  return Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) < 3
    && Math.abs(photoMapHeight(a, campus, site) - photoMapHeight(b, campus, site)) < 2
    && isAerialPhoto(a) === isAerialPhoto(b);
}

export function aerialImportText(photo: Photo) {
  if (!isAerialPhoto(photo)) return '';
  const source = photo.metadata?.aerial;
  const hasGPS = Number.isFinite(source?.latitude) && Number.isFinite(source?.longitude);
  const location = hasGPS ? photo.placed ? '已按经纬度标记拍摄位置。' : '照片坐标超出校园地图范围，请重新标记位置。' : '未读取到完整经纬度，请在地图标记位置。';
  const height = photo.altitude ? photo.altitude.reference === 'takeoff'
    ? '已读取相对起飞点的高度，可按实际情况校准。'
    : '已记录海拔；缺少相对高度，地图只标水平位置。'
    : '未读取到航拍高度，请补充后保存。';
  return location + height;
}

export function assignPhotoLocation(photo: Photo, id: string, campus: Campus, site: Site): Photo {
  id = resolveLocationId(id, campus);
  const location = campusLocations(campus, site).find(item => item.id === id);
  if (id && !location) throw new Error('找不到所选拍摄地点，请重新选择。');
  return { ...photo, locationId: id, buildingId: location?.building?.id || '', floor: !isAerialPhoto(photo) && location?.building ? 1 : 0,
    cameraHeight: undefined, position: { x: photo.position.x, z: photo.position.z } };
}

export function photosAtLocation(photos: Photo[], id: string, floor = 0, campus?: Campus) {
  if (id === AERIAL_LOCATION_FILTER) return photos.filter(isAerialPhoto);
  id = resolveLocationId(id, campus);
  return photos.filter(photo => (!id || photoLocationId(photo, campus) === id) && (!floor || photo.floor === floor));
}

export function photoLocationText(photo: Photo, campus: Campus, site: Site) {
  const location = campusLocations(campus, site).find(item => item.id === photoLocationId(photo, campus));
  if (isAerialPhoto(photo)) return (location?.name || '校园') + ' · 航拍';
  if (location?.building) return location.name + ' · ' + photo.floor + ' 楼';
  if (location) return location.name;
  return '校园室外';
}

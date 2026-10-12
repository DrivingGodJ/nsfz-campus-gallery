import type { Campus, Feature, Photo, Site } from './types';
import { isAerialPhoto, photoLocationId, photoMapHeight } from './locations.ts';

export function isUndergroundFeature(feature?: Feature) {
  return !!feature && ['undergroundRoom', 'undergroundCorridor', 'tunnel', 'tunnelJunction', 'undergroundTrack'].includes(feature.type);
}

export function isUndergroundLocation(campus: Campus, id?: string, floor?: number) {
  return isUndergroundFeature(campus.features.find(feature => feature.id === id))
    || floor === -1 && campus.buildings.some(building => building.id === id && building.basement);
}

export function isUndergroundPhoto(photo: Photo, campus: Campus, site: Site) {
  if (isAerialPhoto(photo)) return false;
  const id = photoLocationId(photo, campus);
  if (isUndergroundLocation(campus, id, photo.floor)) return true;
  const feature = campus.features.find(item => item.id === id);
  return isUndergroundFeature(feature) || feature?.type === 'tunnelEntrance' && photoMapHeight(photo, campus, site) < 0;
}

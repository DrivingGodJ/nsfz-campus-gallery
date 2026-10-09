import type { Campus, Feature, Photo, Site } from './types';
import { isAerialPhoto, photoLocationId, photoMapHeight } from './locations.ts';

export function isUndergroundFeature(feature?: Feature) {
  return !!feature && ['undergroundRoom', 'undergroundCorridor', 'tunnel', 'tunnelJunction', 'undergroundTrack'].includes(feature.type);
}

export function isUndergroundPhoto(photo: Photo, campus: Campus, site: Site) {
  if (isAerialPhoto(photo)) return false;
  const feature = campus.features.find(item => item.id === photoLocationId(photo, campus));
  return isUndergroundFeature(feature) || feature?.type === 'tunnelEntrance' && photoMapHeight(photo, campus, site) < 0;
}

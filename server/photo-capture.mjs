/** @param {{captureType?:string,metadata?:{aerial?:unknown}}} photo */
export const isAerialPhoto = photo => photo.captureType === 'aerial' || (photo.captureType === undefined && !!photo.metadata?.aerial);

/**
 * @template {{captureType?:string,metadata?:{aerial?:unknown},locationId?:unknown,buildingId?:unknown}} T
 * @param {T} photo
 * @returns {T}
 */
export function withoutAerialLocation(photo) {
  if (!isAerialPhoto(photo)) return photo;
  const next = { ...photo };
  delete next.locationId;
  delete next.buildingId;
  return next;
}

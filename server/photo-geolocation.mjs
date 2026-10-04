// Same WGS84 projection as the OSM campus importer; east is +x, north is -z.
export function projectPhotoGPS(latitude, longitude, map) {
  if (![latitude, longitude, map.origin?.lat, map.origin?.lon].every(Number.isFinite)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  const radians = Math.PI / 180, radius = 6378137;
  return { x: (longitude - map.origin.lon) * radians * radius * Math.cos(map.origin.lat * radians),
    z: -(latitude - map.origin.lat) * radians * radius };
}

export function positionWithinMap(position, map) {
  const xs = map.boundary.map(p => p[0]), zs = map.boundary.map(p => p[1]);
  return Number.isFinite(position?.x) && Number.isFinite(position?.z)
    && position.x >= Math.min(...xs) - 80 && position.x <= Math.max(...xs) + 80
    && position.z >= Math.min(...zs) - 80 && position.z <= Math.max(...zs) + 80;
}

export function automaticPhotoPlacement(metadata, map) {
  const aerial = metadata.aerial;
  if (!aerial) return { captureType: 'ground', position: { x: 0, z: 0 }, placed: false };
  const projected = projectPhotoGPS(aerial.latitude, aerial.longitude, map);
  const placed = projected !== undefined && positionWithinMap(projected, map);
  const altitude = Number.isFinite(aerial.relativeAltitude)
    ? { meters: aerial.relativeAltitude, reference: 'takeoff' }
    : Number.isFinite(aerial.absoluteAltitude) ? { meters: aerial.absoluteAltitude, reference: 'seaLevel' } : undefined;
  return { captureType: 'aerial', position: placed ? projected : { x: 0, z: 0 }, placed, ...(altitude ? { altitude } : {}) };
}

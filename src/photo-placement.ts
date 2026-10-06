import { Plane, Vector3, type Ray } from 'three';
import type { Campus, Photo, Site } from './types';
import { isAerialPhoto, photoLocationId, photoMapHeight } from './locations.ts';
import { curvedStairTreads, pointOnStairTread } from './structure-geometry.ts';

export function photoPlacementPoint(ray: Ray, photo: Photo | null, campus: Campus, site: Site): { x: number; z: number } | null {
  const feature = photo && !isAerialPhoto(photo) && campus.features.find(item => item.id === photoLocationId(photo, campus));
  const target = new Vector3();
  if (feature && feature.type === 'tunnelEntrance' && feature.curvedStair) {
    // The transparent ground and picking meshes may be above the stairs.
    // Intersect every real tread and retain the nearest forward surface hit.
    let nearest: { x: number; z: number } | null = null, distance = Infinity;
    for (const tread of curvedStairTreads(feature.curvedStair)) {
      if (!ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -tread.height), target)
        || !pointOnStairTread([target.x, target.z], tread.ring)) continue;
      const nextDistance = target.distanceToSquared(ray.origin);
      if (nextDistance < distance) { nearest = { x: target.x, z: target.z }; distance = nextDistance; }
    }
    return nearest;
  }
  return ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -(photo ? photoMapHeight(photo, campus, site) : 0)), target)
    ? { x: target.x, z: target.z } : null;
}

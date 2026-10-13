import { buildingLevels } from './building-model.ts';
import { isAerialPhoto, photoLocationId, resolveLocationId } from './locations.ts';
import { insideShape } from './terrain-height.ts';
import { Box3, Vector3, type Camera } from 'three';
import { FULL_MAP_VIEWPORT, type MapViewport } from './map-card-viewport.ts';
import { expandedPhotoRegions } from './photo-clusters.ts';
import type { MapPhoto } from './MapCameraRig';
import type { Campus, Site } from './types';

// Absolute scene height: a raised building's first floor does not start at zero.
export function buildingFloorCutoff(campus: Campus, site: Site, id: string, floor: number): number | undefined {
  const building = campus.buildings.find(item => item.id === resolveLocationId(id, campus));
  if (!building || !Number.isFinite(floor) || floor <= 0) return;
  const levels = buildingLevels(building, site.buildingOverrides[building.id]);
  return levels.baseElevation + Math.min(floor, levels.floors) * levels.floorHeight;
}

const regionCache = new WeakMap<Campus, { overrides: Site['buildingOverrides']; regions: ReturnType<typeof createBuildingRegions> }>();
function createBuildingRegions(campus: Campus, site: Site) {
  return campus.buildings.map(building => {
    const override = site.buildingOverrides[building.id], levels = buildingLevels(building, override);
    const shapes = levels.sections.map(section => ({ outer: section.outer, holes: section.holes || [] }));
    const bounds = new Box3().setFromPoints(shapes.flatMap(shape => shape.outer.flatMap(([x, z]) => [
      new Vector3(x, levels.baseElevation, z), new Vector3(x, levels.baseElevation + levels.height, z)])));
    const span = bounds.getSize(new Vector3());
    const declared = [override?.floors ?? building.floors, ...(building.parts || []).map(part => override?.partFloors?.[part.id] ?? part.floors)];
    return { id: building.id, shapes, bounds, area: span.x * span.z,
      hasFloors: levels.floors > 1 && declared.some(value => typeof value === 'number' && Number.isFinite(value) && value > 1) };
  }).sort((a, b) => a.area - b.area);
}
function buildingRegions(campus: Campus, site: Site) {
  const cached = regionCache.get(campus);
  if (cached?.overrides === site.buildingOverrides) return cached.regions;
  const regions = createBuildingRegions(campus, site);
  regionCache.set(campus, { overrides: site.buildingOverrides, regions });
  return regions;
}
const ownerCache = new WeakMap<MapPhoto, { regions: ReturnType<typeof buildingRegions>; x: number; z: number; location: string; owner?: string }>();
function photoBuildingOwner(photo: MapPhoto, campus: Campus, regions: ReturnType<typeof buildingRegions>) {
  const location = photoLocationId(photo, campus), { x, z } = photo.position;
  const cached = ownerCache.get(photo);
  if (cached?.regions === regions && cached.x === x && cached.z === z && cached.location === location) return cached.owner;
  const owner = location || regions.find(building => building.shapes.some(shape => insideShape([x, z], shape)))?.id;
  ownerCache.set(photo, { regions, x, z, location, owner });
  return owner;
}

export function buildingPhotosThroughFloor(photos: MapPhoto[], campus: Campus, site: Site, buildingId: string, floor: number): MapPhoto[] {
  const id = resolveLocationId(buildingId, campus), cutoff = buildingFloorCutoff(campus, site, id, floor);
  if (cutoff === undefined) return photos;
  const regions = buildingRegions(campus, site);
  return photos.filter(photo => {
    if (isAerialPhoto(photo)) return true;
    if (photoBuildingOwner(photo, campus, regions) !== id) return true;
    if (Number.isFinite(photo.floor) && photo.floor > 0 && photo.floor > floor) return false;
    // Old/unassigned floor records still follow the same physical cut as the model.
    return !Number.isFinite(photo.position.height) || photo.position.height <= cutoff + 1e-6;
  });
}

// Use the full source list here, so a low cut with no remaining photos does not
// remove the very control the visitor needs to restore the upper floors.
export function expandedPhotoBuildings(photos: MapPhoto[], campus: Campus, site: Site, camera: Camera, size: { width: number; height: number }, viewport: MapViewport = FULL_MAP_VIEWPORT, selectedId?: string, candidates?: ReturnType<typeof expandedPhotoRegions>): { id: string; distance: number }[] {
  if (size.width <= 0 || size.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return [];
  const regions = buildingRegions(campus, site);
  return (candidates || expandedPhotoRegions(photos, campus, site, camera, viewport, selectedId))
    .filter(candidate => regions.some(region => region.id === candidate.id && region.hasFloors))
    .map(({ id, distance }) => ({ id, distance }));
}

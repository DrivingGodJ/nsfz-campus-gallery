import type { Campus, Feature, Point, Shape, Site } from './types';
import type { MapObjectBounds } from './map-orbit';
import { buildingLevels } from './building-model.ts';
import { featureSurfaceHeight } from './locations.ts';
import { passageFootprint, undergroundLayout } from './underground-geometry.ts';
import { bridgeLayout } from './bridge-geometry.ts';
import { curvedStairPoint, curvedStairTreads } from './structure-geometry.ts';
import { gardenFootprints, pergolaLayout } from './garden-geometry.ts';

// Picking, highlighting and camera focus must describe the same footprint,
// including joined underground routes and bridges with connecting stairs.
export function featureFootprints(feature: Feature, features: Feature[], height: number, alignedFootprints?: Shape[]): Shape[] {
  if (alignedFootprints) return alignedFootprints;
  if (['boardwalk', 'lakePavilion', 'pergola'].includes(feature.type)) return gardenFootprints(feature, features);
  if (feature.type === 'bridge') return bridgeLayout(feature, height).footprint;
  if (feature.type === 'tunnelEntrance' && feature.curvedStair) return [{ outer: curvedStairTreads({ ...feature.curvedStair, steps: 1 })[0].ring, holes: [] }];
  if (feature.outer) return [{ outer: feature.outer, holes: feature.holes || [] }];
  return feature.points?.length ? [feature.points, ...(feature.branches || [])].map(points => passageFootprint(points, feature.width || 4)) : [];
}

export function mapLocationTarget(campus: Campus, site: Site, id?: string, cutawayFloor?: number): { target: [number, number, number]; bounds: MapObjectBounds } | null {
  const building = campus.buildings.find(building => building.id === id);
  let points: Point[], center: Point | undefined, bottom: number, top: number;
  if (building) {
    const info = buildingLevels(building, site.buildingOverrides[building.id]);
    const height = cutawayFloor ? Math.min(info.height, cutawayFloor * info.floorHeight) : info.height;
    points = info.sections.flatMap(section => section.outer);
    center = building.center; bottom = info.baseElevation + .12; top = height + bottom;
  } else {
    const feature = campus.features.find(feature => feature.id === id);
    if (!feature) return null;
    const height = feature.type === 'pergola' && feature.pergola ? pergolaLayout(feature).height : featureSurfaceHeight(feature, campus, site);
    const aligned = undergroundLayout(campus.features).locations.get(feature.id);
    points = featureFootprints(feature, campus.features, height, aligned).flatMap(shape => shape.outer);
    center = feature.track?.center || feature.courts?.center;
    bottom = top = height;
    if (feature.type === 'tunnelEntrance' && feature.curvedStair) {
      const stair = feature.curvedStair, middle = curvedStairPoint(stair, .5);
      center = [middle[0], middle[2]];
      bottom = Math.min(stair.topHeight, stair.bottomHeight); top = Math.max(stair.topHeight, stair.bottomHeight);
    }
  }
  if (!points.length) return null;
  const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
  const minZ = Math.min(...points.map(p => p[1])), maxZ = Math.max(...points.map(p => p[1]));
  return { target: [center?.[0] ?? (minX + maxX) / 2, (bottom + top) / 2, center?.[1] ?? (minZ + maxZ) / 2],
    bounds: { min: [minX, bottom, minZ], max: [maxX, top, maxZ] } };
}

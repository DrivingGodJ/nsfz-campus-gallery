import polygonClipping from 'polygon-clipping';
import { passageFootprint } from './underground-geometry.ts';
import { bridgeLayout } from './bridge-geometry.ts';
import type { Campus, Feature, Shape } from './types';

const polygon = (shape: Shape) => [shape.outer, ...shape.holes];
const shapes = (polygons: ReturnType<typeof polygonClipping.union>): Shape[] => polygons.map(([outer, ...holes]) => ({ outer, holes }));
const union = (items: Shape[]) => items.length ? polygonClipping.union(polygon(items[0]), ...items.slice(1).map(polygon)) : [];
const subtract = (shape: Shape, mask: ReturnType<typeof polygonClipping.union>) => mask.length ? shapes(polygonClipping.difference(polygon(shape), mask)) : [shape];
const featureShape = (feature: Feature): Shape => ({ outer: feature.outer!, holes: feature.holes || [] });

export function groundSurfaces(campus: Campus) {
  const waters = campus.features.filter(feature => feature.type === 'water' && feature.outer);
  const waterMask = union(waters.map(featureShape));
  const roads = campus.features.filter(feature => feature.type === 'path' && feature.points && !feature.representedBy)
    .map(feature => passageFootprint(feature.points!, feature.width || 3));
  // Road-level bridges replace their source paths. Cut water below their decks
  // too, so the nearly coplanar faces cannot flicker at distant camera angles.
  const lowBridges = campus.features.filter(feature => feature.type === 'bridge' && feature.points
    && !feature.archRise && feature.deckHeight !== undefined && feature.deckHeight <= .12)
    .flatMap(feature => bridgeLayout(feature, feature.deckHeight!).deck);
  const roadMask = union([...roads, ...lowBridges]), features = new Map<string, Shape[]>();
  const previousWaters: Shape[] = [];
  for (const water of waters) {
    const excluded = union([...previousWaters, ...shapes(roadMask)]);
    features.set(water.id, subtract(featureShape(water), excluded));
    previousWaters.push(featureShape(water));
  }
  const plazas = campus.features.filter(feature => feature.type === 'plaza' && feature.outer);
  const previousPlazas: Shape[] = [];
  for (const plaza of plazas) {
    const visible = subtract(featureShape(plaza), union([...shapes(waterMask), ...shapes(roadMask), ...previousPlazas]));
    features.set(plaza.id, visible);
    previousPlazas.push(...visible);
  }
  const landMask = union([...shapes(waterMask), ...previousPlazas]);
  // Cut the lake out of every underlying ground layer. The source outlines,
  // photo positions and paths stay intact; each visible lake area has one face.
  const visibleLand: Shape[] = [];
  const forests = campus.features.filter(feature => feature.type === 'forest' && feature.outer).map(featureShape);
  for (const feature of campus.features.filter(feature => feature.outer && ['green', 'sport'].includes(feature.type))) {
    const visible = subtract(featureShape(feature), union([...shapes(landMask), ...shapes(roadMask), ...forests, ...visibleLand]));
    features.set(feature.id, visible);
    visibleLand.push(...visible);
  }
  const campusShape = { outer: campus.boundary, holes: [] };
  return { features,
    campus: subtract(campusShape, union([...shapes(landMask), ...visibleLand, ...forests, ...shapes(roadMask)])),
    background: subtract({ outer: [[-600, -600], [600, -600], [600, 600], [-600, 600], [-600, -600]], holes: [] }, union([campusShape, ...shapes(landMask), ...visibleLand, ...forests, ...shapes(roadMask)]))
  };
}

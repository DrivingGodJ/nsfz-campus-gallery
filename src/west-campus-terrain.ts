import * as THREE from 'three';
import polygonClipping from 'polygon-clipping';
import { architectureBar, architectureBatch } from './architecture-geometry.ts';
import { buildingGeometry, snapFootprint } from './building-geometry.ts';
import { roadFootprint } from './road-geometry.ts';
import { rampSurfaceHeight } from './terrain-height.ts';
import { straightStairTreads } from './structure-geometry.ts';
import type { Building, Feature, Point, Shape } from './types';

export const WEST_TERRACE_ID = 'local/west-campus-terrace';
export const WEST_RAMP_IDS = ['local/west-lower-ramp'];
export const WEST_STAIR_ID = 'local/west-upper-stairs';
const polygon = (shape: Shape) => [shape.outer, ...shape.holes];
const shapes = (polygons: polygonClipping.MultiPolygon): Shape[] => polygons.map(([outer, ...holes]) => ({ outer, holes }));
const prism = (shape: Shape, height: number) => buildingGeometry(shape, height, 3.6).rotateX(-Math.PI / 2);

// Road pieces use the same footprint as the original road. Only the raised
// portion moves; explicit ramps replace their own short source-route sections.
export function terrainRoadGeometry(feature: Feature, features: Feature[]) {
  const footprint = roadFootprint(feature), terrace = features.find(f => f.id === WEST_TERRACE_ID);
  const parts: THREE.BufferGeometry[] = [];
  if (feature.id === WEST_STAIR_ID) return architectureBatch(parts);
  if (feature.type === 'path' && feature.ramp) {
    const geometry = prism(footprint, .04), vertices = geometry.getAttribute('position');
    // Miter vertices can lie just outside the route's half-width. They still
    // share its longitudinal profile; never drop those corners to low ground.
    const profile = { ...feature, width: Infinity };
    for (let i = 0; i < vertices.count; i++) vertices.setY(i, vertices.getY(i) + .075 + rampSurfaceHeight(profile, [vertices.getX(i), vertices.getZ(i)])!);
    geometry.computeVertexNormals(); parts.push(geometry);
  } else if (feature.height !== undefined) {
    parts.push(prism(footprint, .04).translate(0, feature.height + .075, 0));
  } else if (terrace?.platform) {
    const road = snapFootprint([polygon(footprint)]), raised = snapFootprint([polygon(terrace.platform)]);
    for (const [polygons, elevation] of [[polygonClipping.intersection(road, raised), terrace.height ?? 0], [polygonClipping.difference(road, raised), 0]] as const) {
      for (const shape of shapes(polygons)) parts.push(prism(shape, .04).translate(0, elevation + .075, 0));
    }
  } else parts.push(prism(footprint, .04).translate(0, .075, 0));
  return architectureBatch(parts);
}

export function westCampusTerrainGeometry(features: Feature[], buildings: Building[] = []) {
  const terrace = features.find(f => f.id === WEST_TERRACE_ID);
  const body: THREE.BufferGeometry[] = [], paving: THREE.BufferGeometry[] = [], stairs: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [], shrubs: THREE.BufferGeometry[] = [];
  if (!terrace?.platform) return { body: architectureBatch(body), paving: architectureBatch(paving), stairs: architectureBatch(stairs), rails: architectureBatch(rails, false), shrubs: architectureBatch(shrubs, false) };
  const ramps = features.filter(f => WEST_RAMP_IDS.includes(f.id));
  const stairFeature = features.find(f => f.id === WEST_STAIR_ID);
  const rampCuts = [...ramps, ...(stairFeature ? [stairFeature] : [])].map(f => polygon(roadFootprint(f)));
  const walls = buildings.filter(b => ['way/1233313436', 'way/1233313437', 'way/1233313439', 'local/unknown-west-corner'].includes(b.id));
  // The widened slope mouth may overlap a surveyed corner. Keep the building
  // foundations level there while cutting the complete open walking route.
  const cuts = walls.length ? polygonClipping.difference(snapFootprint(rampCuts), snapFootprint(walls.map(polygon))) : snapFootprint(rampCuts);
  const platform = snapFootprint([polygon(terrace.platform)]);
  const visible = cuts.length ? polygonClipping.difference(platform, cuts) : platform;
  for (const shape of shapes(visible)) {
    body.push(prism(shape, terrace.height!));
    paving.push(prism(shape, .005).translate(0, terrace.height!, 0));
  }
  for (const feature of ramps) {
    const footprint = roadFootprint(feature), profile = { ...feature, width: Infinity }, elevation = (point: Point) => rampSurfaceHeight(profile, point)!;
    // Real sloping ground supports the thin road paving from below.
    const support = prism(footprint, 1), vertices = support.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) if (vertices.getY(i) > .5) vertices.setY(i, elevation([vertices.getX(i), vertices.getZ(i)]));
    support.computeVertexNormals(); body.push(support);
    const ring = footprint.outer, count = (ring.length - 1) / 2;
    const sides = [ring.slice(0, count), ring.slice(count, -1).reverse()];
    for (const [side, points] of sides.entries()) for (let i = 1; i < points.length; i++) {
      // _DSC2548 confirms the guard on the high bank; the near low bank is open.
      if (side === 0) continue;
      const from = points[i - 1], to = points[i], length = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const a = elevation(from) + .115, b = elevation(to) + .115, railHeight = feature.railHeight ?? 1.05;
      for (const rise of [.1, railHeight]) rails.push(architectureBar([from[0], a + rise, from[1]], [to[0], b + rise, to[1]], .055));
      body.push(architectureBar([from[0], a + .06, from[1]], [to[0], b + .06, to[1]], .12));
      const posts = Math.max(1, Math.ceil(length / .32));
      for (let n = 0; n <= posts; n++) {
        const t = n / posts, x = from[0] + (to[0] - from[0]) * t, z = from[1] + (to[1] - from[1]) * t, y = a + (b - a) * t;
        rails.push(architectureBar([x, y, z], [x, y + railHeight, z], .04));
      }
      if (i < points.length - 1) {
        const dx = (to[0] - from[0]) / length, dz = (to[1] - from[1]) / length;
        const bank = prism(roadFootprint({ ...feature, points: [[from[0]-dz*.45,from[1]+dx*.45],[to[0]-dz*.45,to[1]+dx*.45]], width: .9 }), 1), bankVertices = bank.getAttribute('position');
        for (let n = 0; n < bankVertices.count; n++) if (bankVertices.getY(n) > .5) bankVertices.setY(n, elevation([bankVertices.getX(n),bankVertices.getZ(n)]) + .08);
        bank.computeVertexNormals();body.push(bank);
        for (let u = .6; u < length; u += 1.1) {
          const t = u / length, x = from[0] + dx * u - dz * .45, z = from[1] + dz * u + dx * .45;
          shrubs.push(new THREE.IcosahedronGeometry(.45, 0).scale(1.25, .8, 1).translate(x, a + (b - a) * t + .28, z));
        }
      }
    }
  }
  if (stairFeature?.riseStair) {
    const { from, to, width, topHeight, bottomHeight } = stairFeature.riseStair;
    for (const tread of straightStairTreads(from, to, topHeight, bottomHeight)) {
      const shape = roadFootprint({ ...stairFeature, points: [tread.from, tread.to], width });
      if (tread.height > 0) body.push(prism(shape, tread.height));
      stairs.push(prism(shape, .04).translate(0, tread.height + .075, 0));
    }
    const ring = roadFootprint(stairFeature).outer;
    for (const [a, b] of [[ring[0], ring[1]], [ring[3], ring[2]]]) {
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]), steps = Math.ceil(length / .7);
      rails.push(architectureBar([a[0], topHeight + 1.165, a[1]], [b[0], bottomHeight + 1.165, b[1]], .055));
      for (let n = 0; n <= steps; n++) {
        const t = n / steps, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, y = topHeight + (bottomHeight - topHeight) * t + .115;
        rails.push(architectureBar([x, y, z], [x, y + 1.05, z], .045));
      }
    }
  }
  return { body: architectureBatch(body), paving: architectureBatch(paving), stairs: architectureBatch(stairs), rails: architectureBatch(rails, false), shrubs: architectureBatch(shrubs, false) };
}

import { useMapColor } from './MapTheme';
import { Edges, Line } from '@react-three/drei';
import { useContext, useEffect, useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import type { Feature, Point, Shape } from './types';
import { boardwalkLayout, boardwalkPlanks, gardenFootprints, pavilionPoint, pavilionRoofGeometry, pergolaLayout } from './garden-geometry';
import type { RailPoint } from './bridge-geometry';
import { LocationHtml, LocationName, LocationSelection } from './LocationSelection';

function Bar({ from, to, radius = .065, color = '#796e56' }: { from: RailPoint; to: RailPoint; radius?: number; color?: string }) {
  const mapColor = useMapColor();
  const direction = new THREE.Vector3(...to).sub(new THREE.Vector3(...from)), length = direction.length();
  if (length < 1e-6) return null;
  const rotation = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return <mesh position={from.map((n, i) => (n + to[i]) / 2) as RailPoint} quaternion={rotation}><cylinderGeometry args={[radius, radius, length, 6]} /><meshStandardMaterial color={mapColor(color)} roughness={.95} /></mesh>;
}
function Slab({ footprints, height, color, thickness = .18, edgeColor }: { footprints: Shape[]; height: number; color: string; thickness?: number; edgeColor?: string }) {
  const mapColor = useMapColor();
  const shapes = useMemo(() => footprints.map(data => {
    const shape = new THREE.Shape(data.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = data.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    return shape;
  }), [footprints]);
  return <>{shapes.map((shape, i) => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, height - thickness, 0]}><extrudeGeometry args={[shape, {depth: thickness, bevelEnabled: false}]} /><meshStandardMaterial color={mapColor(color)} roughness={.95} />{edgeColor && <Edges color={mapColor(edgeColor)} threshold={25} />}</mesh>)}</>;
}
function Name({ feature, position, labelPortal }: { feature: Feature; position: RailPoint; labelPortal: RefObject<HTMLDivElement> }) {
  if (feature.hideLabel || !feature.name?.trim()) return null;
  return <LocationHtml portal={labelPortal} position={position} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name!} /></LocationHtml>;
}
function Boardwalk({ feature, features, labelPortal }: { feature: Feature; features: Feature[]; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const layout = useMemo(() => boardwalkLayout(feature, features), [feature, features]);
  const planks = useMemo(() => boardwalkPlanks(feature, features), [feature, features]);
  useEffect(() => () => planks.dispose(), [planks]);
  const position = feature.points![Math.floor(feature.points!.length / 2)];
  return <group><Slab footprints={layout.deck} height={layout.height} color="#b4a286" />
    <lineSegments geometry={planks} raycast={() => null}><lineBasicMaterial color={mapColor('#96896f')} /></lineSegments>
    {layout.railChains.map((chain, i) => <group key={i}>{[.45, .95].map(offset => <group key={offset}>{chain.slice(1).map((to, j) => <Bar key={j} from={[chain[j][0], chain[j][1] + offset, chain[j][2]]} to={[to[0], to[1] + offset, to[2]]} radius={offset > .5 ? .07 : .045} />)}</group>)}</group>)}
    {layout.posts.map((p, i) => <mesh key={i} position={[p[0], p[1] + .5, p[2]]}><boxGeometry args={[.15, 1, .15]} /><meshStandardMaterial color={mapColor('#796e56')} roughness={.95} /></mesh>)}
    <Name feature={feature} position={[position[0], layout.height + 3.5, position[1]]} labelPortal={labelPortal} />
  </group>;
}
function Pavilion({ feature, features, labelPortal }: { feature: Feature; features: Feature[]; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const model = feature.pavilion!, base = feature.height ?? .26, r = model.span / 2 - .4;
  const layout = useMemo(() => pavilionRoofGeometry(model, base), [model, base]);
  const footprints = useMemo(() => gardenFootprints(feature, features), [feature, features]);
  useEffect(() => () => layout.geometry.dispose(), [layout]);
  const corner = (x: number, z: number, y: number): RailPoint => { const p = pavilionPoint(model, x, z); return [p[0], y, p[1]]; };
  const corners: Point[] = [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]];
  return <group><Slab footprints={footprints} height={base} color="#b4a286" />
    {corners.slice(0, -1).map(([x, z], i) => <Bar key={i} from={corner(x, z, base)} to={corner(x, z, base + model.postHeight)} radius={.14} color="#796e56" />)}
    {corners.slice(1).map(([x, z], i) => <Bar key={i} from={corner(corners[i][0], corners[i][1], base + model.postHeight)} to={corner(x, z, base + model.postHeight)} radius={.12} />)}
    <mesh geometry={layout.geometry}><meshStandardMaterial color={mapColor('#7e8c83')} roughness={.95} side={THREE.DoubleSide} /></mesh>
    {[...layout.eaves, ...layout.ribs].map((points, i) => <Line key={i} points={points.map(([x, y, z]) => [x, y + .015, z])} color={mapColor('#596f63')} lineWidth={1.2} raycast={() => null} />)}
    <mesh position={[model.center[0], layout.peak + .07, model.center[1]]}><sphereGeometry args={[.16, 8, 6]} /><meshStandardMaterial color={mapColor('#596f63')} /></mesh>
    <Name feature={feature} position={[model.center[0], layout.peak + 1.8, model.center[1]]} labelPortal={labelPortal} />
  </group>;
}
function Pergola({ feature, labelPortal }: { feature: Feature; labelPortal: RefObject<HTMLDivElement> }) {
  const layout = useMemo(() => pergolaLayout(feature), [feature]);
  const { selectedId, onSelect, placing, featuresSelectable } = useContext(LocationSelection);
  const model = feature.pergola!, selected = selectedId === feature.id;
  return <group onClick={e => { if (onSelect && !placing && featuresSelectable !== false && e.delta < 5) { e.stopPropagation(); onSelect(feature.id); } }}>
    <Slab footprints={layout.footprint} height={layout.height} thickness={layout.height - layout.base} color={selected ? '#93aa98' : '#d7d2c3'} edgeColor={selected ? '#567760' : '#aaa895'} />
    <Name feature={feature} position={[model.hub[0], layout.height + 1.8, model.hub[1]]} labelPortal={labelPortal} />
  </group>;
}
export default function LakeGarden({ feature, features, labelPortal }: { feature: Feature; features: Feature[]; labelPortal: RefObject<HTMLDivElement> }) {
  if (feature.type === 'boardwalk') return <Boardwalk feature={feature} features={features} labelPortal={labelPortal} />;
  if (feature.type === 'lakePavilion' && feature.pavilion) return <Pavilion feature={feature} features={features} labelPortal={labelPortal} />;
  if (feature.type === 'pergola' && feature.pergola) return <Pergola feature={feature} labelPortal={labelPortal} />;
  return null;
}

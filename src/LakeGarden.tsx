import { useMapColor } from './MapTheme';
import { Edges, Line } from '@react-three/drei';
import { useContext, useEffect, useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import type { Feature, Shape } from './types';
import { boardwalkDetails, boardwalkLayout, boardwalkPlanks, gardenFootprints, pavilionDetails, pavilionRoofGeometry, pergolaLayout } from './garden-geometry';
import type { RailPoint } from './bridge-geometry';
import { LocationHtml, LocationName, LocationSelection } from './LocationSelection';
import { wisteriaArchitecture } from './wisteria-architecture';

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
  const details = useMemo(() => boardwalkDetails(feature, features), [feature, features]);
  useEffect(() => () => { planks.dispose(); Object.values(details).forEach(geometry => geometry.dispose()); }, [planks, details]);
  const position = feature.points![Math.floor(feature.points!.length / 2)];
  return <group><Slab footprints={layout.deck} height={layout.height} color="#a18b73" />
    <lineSegments geometry={planks} raycast={() => null}><lineBasicMaterial color={mapColor('#96896f')} /></lineSegments>
    {(['timber', 'supports'] as const).map(key => <mesh key={key} geometry={details[key]}><meshStandardMaterial color={mapColor('#79604f')} roughness={.95} /></mesh>)}
    <mesh geometry={details.caps}><meshStandardMaterial color={mapColor('#74776a')} roughness={.95} /></mesh>
    <Name feature={feature} position={[position[0], layout.height + 3.5, position[1]]} labelPortal={labelPortal} />
  </group>;
}
function Pavilion({ feature, features, labelPortal }: { feature: Feature; features: Feature[]; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const model = feature.pavilion!, base = feature.height ?? .26;
  const layout = useMemo(() => pavilionRoofGeometry(model, base), [model, base]);
  const footprints = useMemo(() => gardenFootprints(feature, features), [feature, features]);
  const details = useMemo(() => pavilionDetails(model, base), [model, base]);
  useEffect(() => () => { layout.geometry.dispose(); Object.values(details).forEach(geometry => geometry.dispose()); }, [layout, details]);
  return <group><Slab footprints={footprints} height={base} color="#a18b73" />
    <mesh geometry={details.timber}><meshStandardMaterial color={mapColor('#79604f')} roughness={.95} /></mesh>
    <mesh geometry={details.stone}><meshStandardMaterial color={mapColor('#81918a')} roughness={.95} /></mesh>
    <mesh geometry={details.rocks}><meshStandardMaterial color={mapColor('#afa797')} roughness={.95} /></mesh>
    <lineSegments geometry={details.tiles} raycast={() => null}><lineBasicMaterial color={mapColor('#65756b')} /></lineSegments>
    <mesh geometry={layout.geometry}><meshStandardMaterial color={mapColor('#7e8c83')} roughness={.95} side={THREE.DoubleSide} /></mesh>
    {[...layout.eaves, ...layout.ribs].map((points, i) => <Line key={i} points={points.map(([x, y, z]) => [x, y + .015, z])} color={mapColor('#596f63')} lineWidth={1.2} raycast={() => null} />)}
    <mesh position={[model.center[0], layout.peak + .07, model.center[1]]}><sphereGeometry args={[.16, 8, 6]} /><meshStandardMaterial color={mapColor('#596f63')} /></mesh>
    <Name feature={feature} position={[model.center[0], layout.peak + 1.8, model.center[1]]} labelPortal={labelPortal} />
  </group>;
}
function Pergola({ feature, library, labelPortal }: { feature: Feature; library: Shape; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const layout = useMemo(() => pergolaLayout(feature), [feature]);
  const architecture = useMemo(() => wisteriaArchitecture(feature, library), [feature, library]);
  useEffect(() => () => Object.values(architecture).forEach(geometry => geometry.dispose()), [architecture]);
  const { selectedId, onSelect, placing, featuresSelectable } = useContext(LocationSelection);
  const model = feature.pergola!, selected = selectedId === feature.id;
  return <group onClick={e => { if (onSelect && !placing && featuresSelectable !== false && e.delta < 5) { e.stopPropagation(); onSelect(feature.id); } }}>
    {(['floor', 'end', 'beams', 'posts'] as const).map(key => <mesh key={key} geometry={architecture[key]}><meshStandardMaterial color={mapColor(selected ? '#93aa98' : '#d7d2c3')} roughness={.95} /></mesh>)}
    <group onClick={e => { if (onSelect && !placing && e.delta < 5 && feature.connectedTo?.[0]) { e.stopPropagation(); onSelect(feature.connectedTo[0]); } }}>
      {(['room', 'roof', 'steps'] as const).map(key => <mesh key={key} geometry={architecture[key]}><meshStandardMaterial color={mapColor('#d7d2c3')} roughness={.95} /></mesh>)}
      <mesh geometry={architecture.door}><meshStandardMaterial color={mapColor('#b7b09d')} roughness={.95} /></mesh>
      <mesh geometry={architecture.details} raycast={() => null}><meshStandardMaterial color={mapColor('#979784')} roughness={.95} /></mesh>
    </group>
    <Name feature={feature} position={[model.hub[0], layout.height + 1.8, model.hub[1]]} labelPortal={labelPortal} />
  </group>;
}
export default function LakeGarden({ feature, features, connectedBuilding, labelPortal }: { feature: Feature; features: Feature[]; connectedBuilding?: Shape; labelPortal: RefObject<HTMLDivElement> }) {
  if (feature.type === 'boardwalk') return <Boardwalk feature={feature} features={features} labelPortal={labelPortal} />;
  if (feature.type === 'lakePavilion' && feature.pavilion) return <Pavilion feature={feature} features={features} labelPortal={labelPortal} />;
  if (feature.type === 'pergola' && feature.pergola && connectedBuilding) return <Pergola feature={feature} library={connectedBuilding} labelPortal={labelPortal} />;
  return null;
}

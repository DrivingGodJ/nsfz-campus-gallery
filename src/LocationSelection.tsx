import { useMapColor } from './MapTheme';
import { createContext, useContext, useEffect, useMemo, type ComponentProps, type RefObject } from 'react';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { Campus, Feature, Shape, Site } from './types';
import { featureSurfaceHeight } from './locations';
import { undergroundLayout } from './underground-geometry';
import { featureFootprints } from './location-geometry';
import { bridgeLayout } from './bridge-geometry';
import { archedBridgeGeometry } from './bridge-mesh';
import { pergolaLayout } from './garden-geometry';

export const LocationSelection = createContext<{ selectedId?: string; onSelect?: (id: string) => void; placing?: boolean; featuresSelectable?: boolean; selectableIds?: ReadonlySet<string> }>({});

export function LocationHtml({ children, ...props }: ComponentProps<typeof Html>) {
  const selection = useContext(LocationSelection);
  // Drei's Html mounts a separate DOM root. Carry the selection state into it.
  return <Html {...props}><LocationSelection.Provider value={selection}>{children}</LocationSelection.Provider></Html>;
}

export function LocationName({ id, name, underground = false, building = false }: { id: string; name: string; underground?: boolean; building?: boolean }) {
  const { selectedId, onSelect, placing, featuresSelectable, selectableIds } = useContext(LocationSelection);
  if (selectableIds && !selectableIds.has(id)) return null;
  const selected = id === selectedId;
  const className = (building ? 'building-label' : 'structure-label') + (underground ? ' underground' : '') + (selected ? ' active' : '');
  return onSelect && !placing && (!selectableIds || selectableIds.has(id)) && (building || featuresSelectable !== false)
    ? <button type="button" className={className + ' location-name'} aria-label={'选择地点：' + name} aria-pressed={selected} onClick={e => { e.stopPropagation(); onSelect(id); }}>{name}</button>
    : <span className={className}>{name}</span>;
}

function FeatureTarget({ feature, campus, site, alignedFootprints, labelPortal }: { feature: Feature; campus: Campus; site: Site; alignedFootprints?: Shape[]; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const { selectedId, onSelect, placing } = useContext(LocationSelection);
  const height = feature.type === 'pergola' && feature.pergola ? pergolaLayout(feature).height : featureSurfaceHeight(feature, campus, site);
  const archTarget = useMemo(() => feature.type === 'bridge' && feature.archRise ? archedBridgeGeometry(feature, height + .25) : null, [feature, height]);
  const archOutline = useMemo(() => archTarget ? bridgeLayout(feature, height).railChains : [], [feature, height, archTarget]);
  useEffect(() => () => archTarget?.dispose(), [archTarget]);
  const footprints = useMemo(() => featureFootprints(feature, campus.features, height, alignedFootprints), [feature, height, alignedFootprints, campus.features]);
  const shapes = useMemo(() => footprints.map(data => {
    const shape = new THREE.Shape(data.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = data.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    return shape;
  }), [footprints]);
  const points = feature.points || feature.outer?.slice(0, -1) || [];
  const center = points.reduce((sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length], [0, 0]);
  return <group onClick={e => { if (!placing && e.delta < 5) { e.stopPropagation(); onSelect?.(feature.id); } }}>
    {archTarget ? <mesh geometry={archTarget}><meshBasicMaterial side={THREE.DoubleSide} transparent opacity={0} depthWrite={false} colorWrite={false} /></mesh> : shapes.map((shape, i) => <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, height + .25, 0]}><shapeGeometry args={[shape]} /><meshBasicMaterial side={THREE.DoubleSide} transparent opacity={0} depthWrite={false} colorWrite={false} /></mesh>)}
    {selectedId === feature.id && (archTarget ? archOutline.map((chain, i) => <Line key={i} points={chain.map(([x, y, z]) => [x, y + .3, z])} color={mapColor('#355f45')} lineWidth={2.5} depthWrite={false} renderOrder={27} raycast={() => null} />) : footprints.flatMap((shape, i) => [shape.outer, ...shape.holes].map((ring, j) => <Line key={i + '/' + j} points={ring.map(([x, z]) => [x, height + .3, z])} color={mapColor('#355f45')} lineWidth={2.5} depthTest={height >= 0} depthWrite={false} renderOrder={27} raycast={() => null} />)))}
    {!feature.hideLabel && ['path', 'water', 'green', 'sport'].includes(feature.type) && <LocationHtml portal={labelPortal} position={[center[0], height + 4, center[1]]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name!} /></LocationHtml>}
  </group>;
}

export function FeatureTargets({ campus, site, underground, labelPortal }: { campus: Campus; site: Site; underground: boolean; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const { onSelect, featuresSelectable, selectableIds } = useContext(LocationSelection);
  const layout = useMemo(() => undergroundLayout(campus.features), [campus.features]);
  if (!onSelect || featuresSelectable === false) return null;
  return <>{campus.features.filter(feature => feature.name?.trim() && (!selectableIds || selectableIds.has(feature.id)) && (underground || feature.type === 'tunnelEntrance' || (feature.height ?? 0) >= 0)).map(feature => <FeatureTarget key={feature.id} feature={feature} campus={campus} site={site} alignedFootprints={layout.locations.get(feature.id)} labelPortal={labelPortal} />)}</>;
}

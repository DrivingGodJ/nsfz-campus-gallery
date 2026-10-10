import { useMapColor } from './MapTheme';
import { Line } from '@react-three/drei';
import { memo, useEffect, useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import type { Feature, Shape } from './types';
import { basketballEquipment, basketballSurfaces } from './basketball-geometry';
import { basketballFenceGeometry } from './basketball-fence-geometry';
import { LocationHtml, LocationName } from './LocationSelection';

function CourtSurface({ data, color }: { data: Shape; color: string }) {
  const mapColor = useMapColor();
  const shape = useMemo(() => {
    const shape = new THREE.Shape(data.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = data.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    return shape;
  }, [data]);
  return <mesh userData={{ photoOpacityOccluder: true }} rotation={[-Math.PI / 2, 0, 0]} position={[0, .16, 0]} renderOrder={1}><shapeGeometry args={[shape]} /><meshStandardMaterial color={mapColor(color)} roughness={1} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} /></mesh>;
}
export default memo(function BasketballCourts({ feature, labelPortal }: { feature: Feature; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const { courts, surround } = useMemo(() => basketballSurfaces(feature), [feature]);
  const equipment = useMemo(() => basketballEquipment(feature.courts!), [feature.courts]);
  const fence = useMemo(() => basketballFenceGeometry(feature), [feature]);
  useEffect(() => () => { for (const part of [equipment.metal, equipment.bases, equipment.glass, equipment.rims, equipment.nets]) part.dispose(); }, [equipment]);
  useEffect(() => () => { fence.frame.dispose(); fence.wire.dispose(); }, [fence]);
  return <group>
    {surround.map((shape, i) => <CourtSurface key={i} data={shape} color="#b2c29f" />)}
    {courts.map((court, i) => <group key={i}>
      <CourtSurface data={court.surface} color={i % 2 ? '#80a093' : '#78998a'} />
      {court.marks.map((mark, j) => <Line key={j} points={mark.points.map(([x, z]) => [x, .23, z])} color={mapColor('#f0eedb')} lineWidth={1.15} dashed={mark.dashed} dashSize={.35} gapSize={.25} renderOrder={2} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />)}
    </group>)}
    <mesh geometry={equipment.bases}><meshStandardMaterial color={mapColor('#568fa4')} roughness={.85} /></mesh>
    <mesh geometry={equipment.metal}><meshStandardMaterial color={mapColor('#b5bdb7')} roughness={.65} metalness={.25} /></mesh>
    <mesh geometry={equipment.glass} raycast={() => null}><meshStandardMaterial color={mapColor('#a4bfbd')} roughness={.3} transparent opacity={.3} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={equipment.rims}><meshStandardMaterial color={mapColor('#bd6d3d')} roughness={.7} /></mesh>
    <mesh geometry={equipment.nets} raycast={() => null}><meshStandardMaterial color={mapColor('#f0eedb')} roughness={1} /></mesh>
    <mesh geometry={fence.frame} raycast={() => null}><meshStandardMaterial color={mapColor('#83918a')} roughness={.7} metalness={.3} /></mesh>
    <lineSegments geometry={fence.wire} raycast={() => null}><lineBasicMaterial color={mapColor('#83918a')} transparent opacity={.6} depthWrite={false} /></lineSegments>
    <LocationHtml portal={labelPortal} position={[feature.courts!.center[0], 4, feature.courts!.center[1]]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name!} /></LocationHtml>
  </group>;
});

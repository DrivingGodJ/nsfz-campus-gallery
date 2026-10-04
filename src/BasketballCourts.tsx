import { useMapColor } from './MapTheme';
import { Line } from '@react-three/drei';
import { useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import type { Feature, Shape } from './types';
import { basketballSurfaces } from './basketball-geometry';
import { LocationHtml, LocationName } from './LocationSelection';

function CourtSurface({ data, color }: { data: Shape; color: string }) {
  const mapColor = useMapColor();
  const shape = useMemo(() => {
    const shape = new THREE.Shape(data.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = data.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    return shape;
  }, [data]);
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .16, 0]} renderOrder={1}><shapeGeometry args={[shape]} /><meshStandardMaterial color={mapColor(color)} roughness={1} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} /></mesh>;
}
export default function BasketballCourts({ feature, labelPortal }: { feature: Feature; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const { courts, surround } = useMemo(() => basketballSurfaces(feature), [feature]);
  return <group>
    {surround.map((shape, i) => <CourtSurface key={i} data={shape} color="#b2c29f" />)}
    {courts.map((court, i) => <group key={i}>
      <CourtSurface data={court.surface} color={i % 2 ? '#80a093' : '#78998a'} />
      {court.marks.map((mark, j) => <Line key={j} points={mark.points.map(([x, z]) => [x, .23, z])} color={mapColor('#f0eedb')} lineWidth={1.15} dashed={mark.dashed} dashSize={.35} gapSize={.25} renderOrder={2} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />)}
    </group>)}
    <LocationHtml portal={labelPortal} position={[feature.courts!.center[0], 4, feature.courts!.center[1]]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name!} /></LocationHtml>
  </group>;
}

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { BOUNDARY_WATER_COLORS, boundaryWaterGardenGeometry } from './boundary-water-garden';
import type { Feature } from './types';

export default function BoundaryWaterGarden({ feature }: { feature: Feature }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => boundaryWaterGardenGeometry(feature), [feature]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group>{(Object.keys(geometry) as (keyof typeof geometry)[]).map(kind => <mesh key={kind} geometry={geometry[kind]} raycast={() => null}>
    {['water', 'fall', 'foam'].includes(kind)
      ? <meshBasicMaterial color={mapColor(BOUNDARY_WATER_COLORS[kind])} side={THREE.DoubleSide} />
      : <meshStandardMaterial color={mapColor(BOUNDARY_WATER_COLORS[kind])} roughness={kind === 'wetRock' ? .8 : .98} side={THREE.DoubleSide} />}
  </mesh>)}</group>;
}

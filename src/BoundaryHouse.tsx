import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { boundaryHouseGeometry, BOUNDARY_HOUSE_COLORS } from './boundary-house-geometry';
import type { Building } from './types';

export default function BoundaryHouse({ building, height, cutaway }: { building: Building; height: number; cutaway: boolean }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => boundaryHouseGeometry(building, height, cutaway), [building, height, cutaway]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group>{(Object.keys(geometry) as (keyof typeof geometry)[]).map(kind => <mesh key={kind} geometry={geometry[kind]}>
    <meshStandardMaterial color={mapColor(BOUNDARY_HOUSE_COLORS[kind])} roughness={.95} side={THREE.DoubleSide} transparent={cutaway} opacity={cutaway ? .62 : 1} />
  </mesh>)}</group>;
}

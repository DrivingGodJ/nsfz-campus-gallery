import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { luxunMemorialGeometry, LUXUN_MEMORIAL_COLORS } from './luxun-memorial-geometry';
import type { Building } from './types';

export default function LuxunMemorial({ building, height, floorHeight, cutawayHeight }: { building: Building; height: number; floorHeight: number; cutawayHeight?: number }) {
  const mapColor = useMapColor(), cutaway = cutawayHeight !== undefined;
  const geometry = useMemo(() => luxunMemorialGeometry(building, height, floorHeight, cutawayHeight), [building, height, floorHeight, cutawayHeight]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group>{(Object.keys(geometry) as (keyof typeof geometry)[]).map(kind => <mesh key={kind} geometry={geometry[kind]}>
    <meshStandardMaterial color={mapColor(LUXUN_MEMORIAL_COLORS[kind])} roughness={.96} side={THREE.DoubleSide} transparent={cutaway} opacity={cutaway ? .62 : 1} />
  </mesh>)}</group>;
}

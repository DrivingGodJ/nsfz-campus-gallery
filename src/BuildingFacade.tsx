import { useMapColor } from './MapTheme';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Building } from './types';
import { facadeGeometry, FACADE_COLORS } from './facade-geometry';

export default function BuildingFacade({ building, floors, floorHeight, height, selected, cutaway }: { building: Building; floors: number; floorHeight: number; height: number; selected: boolean; cutaway: boolean }) {
  const mapColor = useMapColor();
  const model = useMemo(() => facadeGeometry(building, floors, floorHeight, height), [building, floors, floorHeight, height]);
  useEffect(() => () => model.geometries.forEach(({ geometry }) => geometry.dispose()), [model]);
  return <group>{model.geometries.map(({ kind, geometry }) => <mesh key={kind} geometry={geometry}>
    <meshStandardMaterial color={mapColor(selected && kind !== 'glass' && kind !== 'frame' ? '#b0bead' : FACADE_COLORS[kind])} side={THREE.DoubleSide} roughness={kind === 'glass' ? .46 : .9} metalness={kind === 'glass' ? .08 : 0} transparent={cutaway} opacity={cutaway ? .62 : 1} depthWrite={!cutaway} />
  </mesh>)}</group>;
}

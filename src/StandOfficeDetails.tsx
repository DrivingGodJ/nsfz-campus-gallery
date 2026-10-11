import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { standOfficeGeometry } from './stand-office-geometry';
import type { Building } from './types';
import { buildingMaterialColor } from './building-colors';

export default function StandOfficeDetails({ building, height, floorHeight, cutawayHeight }: {
  building: Building; height: number; floorHeight: number; cutawayHeight?: number;
}) {
  const mapColor = useMapColor();
  const model = useMemo(() => standOfficeGeometry(building, height, floorHeight, cutawayHeight), [building, height, floorHeight, cutawayHeight]);
  useEffect(() => () => Object.values(model).forEach(geometry => geometry.dispose()), [model]);
  return <group>{Object.entries(model).map(([kind, geometry]) => <mesh key={kind} geometry={geometry} raycast={() => null}>
    <meshStandardMaterial color={buildingMaterialColor(building, kind === 'rails' ? 'rail' : 'trim', kind === 'rails' ? '#dce2dc' : '#e9e7df', mapColor)} roughness={.88} side={THREE.DoubleSide} forceSinglePass transparent={cutawayHeight !== undefined} opacity={cutawayHeight === undefined ? 1 : .65} depthWrite={cutawayHeight === undefined} />
  </mesh>)}</group>;
}

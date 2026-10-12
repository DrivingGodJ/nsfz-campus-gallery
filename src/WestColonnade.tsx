import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { buildingMaterialColor } from './building-colors';
import { useMapColor } from './MapTheme';
import { westColonnadeGeometry } from './west-colonnade-geometry';
import type { Building } from './types';

export default function WestColonnade({ building, height, floorHeight, cutawayHeight }: {
  building: Building; height: number; floorHeight: number; cutawayHeight?: number;
}) {
  const mapColor = useMapColor();
  const model = useMemo(() => westColonnadeGeometry(building, height, floorHeight, cutawayHeight), [building, height, floorHeight, cutawayHeight]);
  useEffect(() => () => Object.values(model).forEach(geometry => geometry.dispose()), [model]);
  return <group>{Object.entries(model).map(([kind, geometry]) => <mesh key={kind} geometry={geometry} {...(kind === 'rails' ? { raycast: () => null } : {})}>
    <meshStandardMaterial color={buildingMaterialColor(building, kind === 'rails' ? 'rail' : kind === 'slabs' ? 'body' : kind === 'brick' ? 'brick' : 'trim', kind === 'rails' ? '#cbcbbf' : kind === 'brick' ? '#62645d' : '#d7d2c3', mapColor)} roughness={.95} side={THREE.DoubleSide} forceSinglePass transparent={cutawayHeight !== undefined} opacity={cutawayHeight === undefined ? 1 : .62} depthWrite={cutawayHeight === undefined} />
  </mesh>)}</group>;
}

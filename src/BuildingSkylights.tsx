import { useEffect, useMemo } from 'react';
import { useMapColor } from './MapTheme';
import { buildingSkylightGeometry } from './skylight-geometry';
import * as THREE from 'three';
import type { Building, BuildingPart } from './types';

export default function BuildingSkylights({ building, sections, cutawayHeight }: { building: Building; sections: (BuildingPart & { height: number })[]; cutawayHeight?: number }) {
  const mapColor = useMapColor();
  const roofs = useMemo(() => buildingSkylightGeometry(building, sections, cutawayHeight), [building, sections, cutawayHeight]);
  useEffect(() => () => roofs.forEach(roof => { roof.glass.dispose(); roof.frame.dispose(); }), [roofs]);
  return <group>{roofs.map(roof => <group key={roof.id}>
    <mesh geometry={roof.glass} renderOrder={3}><meshBasicMaterial color={mapColor('#348bac')} transparent opacity={.92} depthWrite side={THREE.DoubleSide} forceSinglePass toneMapped={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} /></mesh>
    <mesh geometry={roof.frame}><meshStandardMaterial color={mapColor('#b6c9cc')} roughness={.65} metalness={.2} /></mesh>
  </group>)}</group>;
}

import { useEffect, useMemo } from 'react';
import type { Building } from './types';
import { useMapColor } from './MapTheme';
import { dormitoryEntranceGeometry } from './dormitory-entrance-geometry';

export default function DormitoryEntrance({ building, visibleHeight }: { building: Building; visibleHeight?: number }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => dormitoryEntranceGeometry(building, visibleHeight), [building, visibleHeight]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group name="dormitory-modern-entrance">
    <mesh geometry={geometry.metal}><meshStandardMaterial color={mapColor('#bfc5c3')} roughness={.32} metalness={.7} /></mesh>
    <mesh geometry={geometry.dark}><meshStandardMaterial color={mapColor('#202927')} roughness={.45} /></mesh>
    <mesh geometry={geometry.glass}><meshStandardMaterial color={mapColor('#8cafb1')} roughness={.18} transparent opacity={.25} depthWrite={false} /></mesh>
    <mesh geometry={geometry.screens}><meshStandardMaterial color={mapColor('#82b3c1')} emissive="#386878" emissiveIntensity={.15} roughness={.4} /></mesh>
  </group>;
}

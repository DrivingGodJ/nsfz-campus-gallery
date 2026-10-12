import { useEffect, useMemo } from 'react';
import { securityGateGeometry } from './gate-frontage-geometry';
import { useMapColor } from './MapTheme';
import type { Feature } from './types';

export default function SecurityGate({ feature }: { feature: Feature }) {
  const model = feature.securityGate!, mapColor = useMapColor();
  const geometry = useMemo(() => securityGateGeometry(model), [model]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group name={feature.id} position={[model.center[0], feature.height ?? .12, model.center[1]]} rotation={[0, -Math.atan2(model.axis[1], model.axis[0]), 0]}>
    <mesh geometry={geometry.metal}><meshStandardMaterial color={mapColor('#a9b7af')} roughness={.3} metalness={.65} /></mesh>
    <mesh geometry={geometry.roof}><meshStandardMaterial color={mapColor('#bacbc1')} roughness={.4} metalness={.4} /></mesh>
    <mesh geometry={geometry.glass}><meshStandardMaterial color={mapColor('#94b5b1')} roughness={.18} transparent opacity={.28} depthWrite={false} /></mesh>
    <mesh geometry={geometry.rubber}><meshStandardMaterial color={mapColor('#26352d')} roughness={.9} /></mesh>
    <mesh geometry={geometry.panel}><meshStandardMaterial color={mapColor('#306773')} roughness={.4} /></mesh>
  </group>;
}

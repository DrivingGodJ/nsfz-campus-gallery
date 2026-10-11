import { useEffect, useMemo } from 'react';
import type { Feature } from './types';
import { useMapColor } from './MapTheme';
import { woodenHutGeometry } from './wooden-hut-geometry';

export default function WoodenHut({ feature }: { feature: Feature }) {
  const model = feature.woodenHut!, mapColor = useMapColor();
  const geometry = useMemo(() => woodenHutGeometry(model), [model]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group name={feature.id} position={[model.center[0], feature.height ?? .02, model.center[1]]} rotation={[0, -Math.atan2(model.axis[1], model.axis[0]), 0]}>
    <mesh geometry={geometry.wood}><meshStandardMaterial color={mapColor('#925c32')} roughness={.95} /></mesh>
    <mesh geometry={geometry.trim}><meshStandardMaterial color={mapColor('#dddcd0')} roughness={.8} /></mesh>
    <mesh geometry={geometry.base}><meshStandardMaterial color={mapColor('#595d52')} roughness={1} /></mesh>
    <mesh geometry={geometry.roof}><meshStandardMaterial color={mapColor('#4c534a')} roughness={.9} /></mesh>
    <mesh geometry={geometry.glass}><meshStandardMaterial color={mapColor('#769da0')} roughness={.22} transparent opacity={.4} depthWrite={false} /></mesh>
  </group>;
}

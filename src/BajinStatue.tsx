import { useEffect, useMemo } from 'react';
import type { Feature } from './types';
import { useMapColor } from './MapTheme';
import { bajinStatueGeometry } from './bajin-statue-geometry';

export default function BajinStatue({ feature }: { feature: Feature }) {
  const model = feature.statue!, mapColor = useMapColor();
  const geometry = useMemo(() => bajinStatueGeometry(model), [model]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group name={feature.id} position={[model.center[0], feature.height ?? .02, model.center[1]]} rotation={[0, Math.atan2(-model.axis[1], model.axis[0]), 0]}>
    <mesh geometry={geometry.steps}><meshStandardMaterial color={mapColor('#b2b2a5')} roughness={.95} /></mesh>
    <mesh geometry={geometry.pedestal}><meshStandardMaterial color={mapColor('#79534a')} roughness={.9} /></mesh>
    <mesh geometry={geometry.bust}><meshStandardMaterial color={mapColor('#d3dcd5')} vertexColors roughness={.85} metalness={.12} /></mesh>
  </group>;
}

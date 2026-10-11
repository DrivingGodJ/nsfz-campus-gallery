import { useEffect, useMemo } from 'react';
import type { Feature } from './types';
import { useMapColor } from './MapTheme';
import { parallelBarsGeometry } from './parallel-bars-geometry';

export default function ParallelBars({ feature }: { feature: Feature }) {
  const model = feature.parallelBars!, mapColor = useMapColor();
  const geometry = useMemo(() => parallelBarsGeometry(model), [model]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group name={feature.id} position={[model.center[0], feature.height ?? .02, model.center[1]]}
    rotation={[0, -Math.atan2(model.axis[1], model.axis[0]), 0]}>
    <mesh geometry={geometry.pad}><meshStandardMaterial color={mapColor('#424744')} roughness={1} /></mesh>
    <mesh geometry={geometry.posts}><meshStandardMaterial color={mapColor('#287051')} roughness={.6} metalness={.15} /></mesh>
    <mesh geometry={geometry.rails}><meshStandardMaterial color={mapColor('#b8c3c2')} roughness={.32} metalness={.75} /></mesh>
  </group>;
}

import { useEffect, useMemo } from 'react';
import type { Feature } from './types';
import { useMapColor } from './MapTheme';
import { benchGeometry } from './bench-geometry';

export default function Bench({ feature }: { feature: Feature }) {
  const model = feature.bench!, mapColor = useMapColor();
  const geometry = useMemo(() => benchGeometry(model), [model]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group name={feature.id} position={[model.center[0], feature.height ?? .02, model.center[1]]}
    rotation={[0, -Math.atan2(model.axis[1], model.axis[0]), 0]}>
    <mesh geometry={geometry.seat}><meshStandardMaterial color={mapColor('#585440')} roughness={.95} /></mesh>
    <mesh geometry={geometry.supports}><meshStandardMaterial color={mapColor('#39453c')} roughness={.9} /></mesh>
  </group>;
}

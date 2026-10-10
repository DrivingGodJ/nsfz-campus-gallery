import { useEffect, useMemo } from 'react';
import type { Feature } from './types';
import { useMapColor } from './MapTheme';
import { aircraftDisplayGeometry } from './aircraft-display-geometry';

export default function AircraftDisplay({ feature }: { feature: Feature }) {
  const model = feature.aircraft!, mapColor = useMapColor();
  const geometry = useMemo(() => aircraftDisplayGeometry(model), [model]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group name={feature.id} position={[model.center[0], feature.height ?? .02, model.center[1]]}
    rotation={[0, Math.atan2(model.axis[0], model.axis[1]), 0]}>
    <mesh geometry={geometry.body}><meshStandardMaterial color={mapColor('#c1cbd0')} roughness={.42} metalness={.35} /></mesh>
    <mesh geometry={geometry.dark}><meshStandardMaterial color={mapColor('#263a42')} roughness={.65} /></mesh>
    <mesh geometry={geometry.gear}><meshStandardMaterial color={mapColor('#858f8c')} roughness={.6} metalness={.25} /></mesh>
  </group>;
}

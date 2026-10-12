import { useEffect, useMemo } from 'react';
import type { Feature } from './types';
import { useMapColor } from './MapTheme';
import { courtyardSculptureGeometry } from './courtyard-sculpture-geometry';

export default function CourtyardSculpture({ feature }: { feature: Feature }) {
  const model = feature.sculpture!, mapColor = useMapColor();
  const geometry = useMemo(() => courtyardSculptureGeometry(model), [model]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  const colors = { silver: '#c8cbc7', pedestal: '#44352f', rim: '#b3a18b', soil: '#655749', leaves: '#597451', orange: '#d66f38', cream: '#e3ddad' };
  return <group name={feature.id} position={[model.center[0], feature.height ?? .135, model.center[1]]} rotation={[0, Math.atan2(model.facing[0], model.facing[1]), 0]}>
    {Object.entries(geometry).map(([kind, part]) => <mesh key={kind} geometry={part}>
      <meshStandardMaterial color={mapColor(colors[kind as keyof typeof colors])} roughness={kind === 'silver' ? .3 : .9} metalness={kind === 'silver' ? .35 : 0} />
    </mesh>)}
  </group>;
}

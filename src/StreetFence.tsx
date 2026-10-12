import { useEffect, useMemo } from 'react';
import { useMapColor } from './MapTheme';
import { STREET_FENCE_COLOR, streetFenceGeometry } from './street-fence-geometry';
import type { Feature } from './types';
import { hedgeFenceGeometry } from './gate-frontage-geometry';

export default function StreetFence({ feature }: { feature: Feature }) {
  const mapColor = useMapColor(), geometry = useMemo(() => streetFenceGeometry(feature), [feature]);
  const hedge = useMemo(() => feature.hedge ? hedgeFenceGeometry(feature) : null, [feature]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => { if (hedge) Object.values(hedge).forEach(part => part.dispose()); }, [hedge]);
  return <group name={feature.id}><mesh geometry={geometry} raycast={() => null}>
    <meshStandardMaterial color={mapColor(STREET_FENCE_COLOR)} roughness={.7} metalness={.4} />
  </mesh>{hedge && (Object.keys(hedge) as (keyof typeof hedge)[]).map(key => <mesh key={key} geometry={hedge[key]} raycast={() => null}>
    <meshStandardMaterial color={mapColor({ foliage: '#2f6445', tips: '#447b50', rails: '#8daba0', base: '#b8b6a2' }[key])} roughness={key === 'rails' ? .4 : .95} metalness={key === 'rails' ? .45 : 0} />
  </mesh>)}</group>;
}

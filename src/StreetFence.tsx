import { useEffect, useMemo } from 'react';
import { useMapColor } from './MapTheme';
import { STREET_FENCE_COLOR, streetFenceGeometry } from './street-fence-geometry';
import type { Feature } from './types';

export default function StreetFence({ feature }: { feature: Feature }) {
  const mapColor = useMapColor(), geometry = useMemo(() => streetFenceGeometry(feature), [feature]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh name={feature.id} geometry={geometry} raycast={() => null}>
    <meshStandardMaterial color={mapColor(STREET_FENCE_COLOR)} roughness={.7} metalness={.4} />
  </mesh>;
}

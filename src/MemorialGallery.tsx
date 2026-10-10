import { useEffect, useMemo } from 'react';
import type { Feature } from './types';
import { useMapColor } from './MapTheme';
import { memorialGalleryGeometry } from './memorial-gallery-geometry';

const colors = { floor: '#b0b2ab', frame: '#e5e8e2', roof: '#d8e1de', walls: '#bbbfb7', boards: '#43534e', paper: '#e1e2d8', ink: '#919b94' };
export default function MemorialGallery({ feature }: { feature: Feature }) {
  const geometry = useMemo(() => memorialGalleryGeometry(feature), [feature]), mapColor = useMapColor();
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group name={feature.id}>{Object.entries(colors).map(([key, color]) => <mesh key={key} geometry={geometry[key]}>
    <meshStandardMaterial color={mapColor(color)} roughness={key === 'roof' ? .55 : .9} />
  </mesh>)}</group>;
}

import { useContext, useEffect, useMemo } from 'react';
import { MapTheme, MapTime, useMapColor } from './MapTheme';
import { AVENUE_GARDEN_COLORS, avenueGardenGeometry } from './avenue-garden';
import type { Feature, Shape } from './types';

export default function AvenueGarden({ features, buildings }: { features: Feature[]; buildings: Shape[] }) {
  const mapColor = useMapColor(), time = useContext(MapTime), theme = useContext(MapTheme);
  const geometry = useMemo(() => avenueGardenGeometry(features, buildings), [features, buildings]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  const lit = time === 'night' || time === 'dusk' || (!time && theme === 'dark');
  return <group name="avenue-garden">{(Object.keys(AVENUE_GARDEN_COLORS) as (keyof typeof AVENUE_GARDEN_COLORS)[]).map(key =>
    <mesh key={key} geometry={geometry[key]} raycast={() => null}>
      <meshStandardMaterial color={mapColor(AVENUE_GARDEN_COLORS[key])} roughness={.95}
        emissive={key === 'lamps' && lit ? '#eab45d' : '#000000'} emissiveIntensity={key === 'lamps' && lit ? .85 : 0} />
    </mesh>)}</group>;
}

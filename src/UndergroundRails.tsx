import { useEffect, useMemo } from 'react';
import { useMapColor } from './MapTheme';
import { undergroundRailGeometry } from './underground-rail-geometry';
import type { RailPoint } from './bridge-geometry';

export default function UndergroundRails({ chains }: { chains: RailPoint[][] }) {
  const mapColor = useMapColor(), geometry = useMemo(() => undergroundRailGeometry(chains), [chains]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry}><meshStandardMaterial color={mapColor('#a8adae')} metalness={.72} roughness={.3} /></mesh>;
}

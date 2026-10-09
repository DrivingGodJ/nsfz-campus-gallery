import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import type { Feature, Shape } from './types';
import { RIVER_COLORS, riverLandscapeGeometry } from './river-landscape';

export default function RiverLandscape({ features, buildings }: { features: Feature[]; buildings: Shape[] }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => riverLandscapeGeometry(features, buildings), [features, buildings]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group>{(Object.keys(RIVER_COLORS) as (keyof typeof RIVER_COLORS)[]).map(key => <mesh key={key} geometry={geometry[key]} raycast={() => null}>
    <meshStandardMaterial color={mapColor(RIVER_COLORS[key])} roughness={.98} side={THREE.DoubleSide} />
  </mesh>)}</group>;
}

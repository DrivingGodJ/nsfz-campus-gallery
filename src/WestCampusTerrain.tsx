import { useEffect, useMemo } from 'react';
import { useMapColor } from './MapTheme';
import { westCampusTerrainGeometry } from './west-campus-terrain';
import type { Building, Feature } from './types';

export default function WestCampusTerrain({ features, buildings }: { features: Feature[]; buildings: Building[] }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => westCampusTerrainGeometry(features, buildings), [features, buildings]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  const colors = { body: '#bbb5a3', paving: '#cfd5bd', stairs: '#e9e4d4', rails: '#747d73', shrubs: '#617353' };
  return <group>{Object.entries(geometry).map(([kind, part]) => <mesh key={kind} geometry={part} userData={kind === 'body' || kind === 'paving' || kind === 'stairs' ? { photoOccluder: true, photoOpacityOccluder: true } : undefined} {...(kind === 'rails' || kind === 'shrubs' ? { raycast: () => null } : {})}>
    <meshStandardMaterial color={mapColor(colors[kind as keyof typeof colors])} roughness={1} />
  </mesh>)}</group>;
}

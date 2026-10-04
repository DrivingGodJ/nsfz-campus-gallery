import { useContext, useEffect, useMemo } from 'react';
import type { Feature } from './types';
import { LocationSelection } from './LocationSelection';
import { useMapColor } from './MapTheme';
import { FLAG_PLATFORM_GROUND, flagPlatformGeometry, flagPlatformLayout, flagPlatformRotation } from './flag-platform-geometry';

export default function FlagPlatform({ feature }: { feature: Feature }) {
  const model = feature.flagPlatform!, mapColor = useMapColor();
  const { selectedId, onSelect, placing, featuresSelectable } = useContext(LocationSelection);
  const layout = useMemo(() => flagPlatformLayout(model), [model]);
  const geometry = useMemo(() => flagPlatformGeometry(model), [model]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const stone = mapColor(selectedId === feature.id ? '#b0bead' : '#dddacb');
  const poleBottom = model.platformHeight + layout.poleBaseHeight;
  return <group name={feature.id} position={[model.center[0], FLAG_PLATFORM_GROUND, model.center[1]]} rotation={[0, flagPlatformRotation(model), 0]}
    onClick={e => { if (onSelect && !placing && featuresSelectable !== false && e.delta < 5) { e.stopPropagation(); onSelect(feature.id); } }}>
    <mesh position={[0, layout.baseHeight / 2, 0]}><boxGeometry args={[model.width + .24, layout.baseHeight, model.depth + .36]} /><meshStandardMaterial color={mapColor('#d7d2c3')} roughness={.95} /></mesh>
    <mesh geometry={geometry}><meshStandardMaterial color={stone} roughness={.95} /></mesh>
    <mesh position={[0, model.platformHeight + layout.poleBaseHeight / 2, 0]}><cylinderGeometry args={[.18, .22, layout.poleBaseHeight, 16]} /><meshStandardMaterial color={mapColor('#adb7ae')} roughness={.45} metalness={.45} /></mesh>
    <mesh position={[0, poleBottom + model.poleHeight / 2, 0]}><cylinderGeometry args={[.045, .075, model.poleHeight, 16]} /><meshStandardMaterial color={mapColor('#c6ceca')} roughness={.3} metalness={.65} /></mesh>
    <mesh position={[0, poleBottom + model.poleHeight + .08, 0]}><sphereGeometry args={[.095, 16, 12]} /><meshStandardMaterial color={mapColor('#adb7ae')} roughness={.3} metalness={.65} /></mesh>
  </group>;
}

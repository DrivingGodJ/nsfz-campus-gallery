import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { ARCHITECTURE_COLORS, GYM_ID, gymArchitecture, teachingRailGeometry } from './architecture-geometry';
import type { Building, BuildingPart } from './types';

type Section = BuildingPart & { height: number; floors: number };
export default function BuildingArchitecture({ building, sections, floorHeight, cutawayHeight, gym }: {
  building: Building; sections: Section[]; floorHeight: number; cutawayHeight?: number;
  gym?: ReturnType<typeof gymArchitecture>;
}) {
  const mapColor = useMapColor();
  const rails = useMemo(() => teachingRailGeometry(building, sections, floorHeight, cutawayHeight), [building, sections, floorHeight, cutawayHeight]);
  useEffect(() => () => rails.dispose(), [rails]);
  const detail = useRef<THREE.Group>(null), railMaterial = useRef<THREE.MeshStandardMaterial>(null), frameMaterial = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ camera }) => {
    const distance = Math.hypot(camera.position.x - building.center[0], camera.position.y, camera.position.z - building.center[1]);
    const opacity = THREE.MathUtils.clamp((430 - distance) / 180, 0, 1);
    if (detail.current) detail.current.visible = opacity > 0;
    if (railMaterial.current) railMaterial.current.opacity = opacity;
    if (frameMaterial.current) frameMaterial.current.opacity = opacity;
  });
  // The roof remains visible at campus scale; only small rail details fade away.
  return <group>
    {gym && building.id === GYM_ID && <>
      <mesh geometry={gym.roof}><meshStandardMaterial color={mapColor(ARCHITECTURE_COLORS.roof)} roughness={.9} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={gym.glass}><meshStandardMaterial color={mapColor(ARCHITECTURE_COLORS.glass)} roughness={.6} /></mesh>
    </>}
    <group ref={detail}>
      {gym && <mesh geometry={gym.frame}><meshStandardMaterial ref={frameMaterial} color={mapColor(ARCHITECTURE_COLORS.frame)} roughness={.9} transparent depthWrite /></mesh>}
      <mesh geometry={rails} raycast={() => null}>
      <meshStandardMaterial ref={railMaterial} color={mapColor(ARCHITECTURE_COLORS.rail)} roughness={.9} transparent depthWrite />
    </mesh></group>
  </group>;
}

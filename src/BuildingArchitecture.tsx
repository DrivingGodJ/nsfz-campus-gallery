import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { ARCHITECTURE_COLORS, GYM_ID, gymArchitecture, teachingRailGeometry, teachingWindowGeometry } from './architecture-geometry';
import { teachingStairGeometry } from './teaching-stairs';
import type { Building, BuildingPart } from './types';

type Section = BuildingPart & { height: number; floors: number };
export default function BuildingArchitecture({ building, sections, floorHeight, cutawayHeight, gym }: {
  building: Building; sections: Section[]; floorHeight: number; cutawayHeight?: number;
  gym?: ReturnType<typeof gymArchitecture>;
}) {
  const mapColor = useMapColor();
  const rails = useMemo(() => teachingRailGeometry(building, sections, floorHeight, cutawayHeight), [building, sections, floorHeight, cutawayHeight]);
  const stairs = useMemo(() => teachingStairGeometry(building, sections, floorHeight, cutawayHeight), [building, sections, floorHeight, cutawayHeight]);
  const windows = useMemo(() => teachingWindowGeometry(building, sections, floorHeight, cutawayHeight), [building, sections, floorHeight, cutawayHeight]);
  useEffect(() => () => rails.dispose(), [rails]);
  useEffect(() => () => Object.values(stairs).forEach(geometry => geometry.dispose()), [stairs]);
  useEffect(() => () => Object.values(windows).forEach(geometry => geometry.dispose()), [windows]);
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
    <mesh geometry={windows.glass} raycast={() => null}><meshStandardMaterial color={mapColor('#a4bfbd')} roughness={.35} transparent opacity={.16} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={stairs.concrete}><meshStandardMaterial color={mapColor('#d7d2c3')} roughness={.95} /></mesh>
    {gym && building.id === GYM_ID && <>
      <mesh geometry={gym.roof}><meshStandardMaterial color={mapColor(ARCHITECTURE_COLORS.roof)} roughness={.9} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={gym.stairs}><meshStandardMaterial color={mapColor('#d7d2c3')} roughness={.95} /></mesh>
      <mesh geometry={gym.glass} raycast={() => null}><meshStandardMaterial color={mapColor(ARCHITECTURE_COLORS.glass)} roughness={.6} transparent opacity={.24} depthWrite={false} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={gym.stairGlass} raycast={() => null}><meshStandardMaterial color={mapColor(ARCHITECTURE_COLORS.glass)} roughness={.6} transparent opacity={.18} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    </>}
    <group ref={detail}>
      <mesh geometry={windows.frames} raycast={() => null}><meshStandardMaterial color={mapColor('#d2d6cc')} roughness={.8} /></mesh>
      <mesh geometry={stairs.rails} raycast={() => null}><meshStandardMaterial color={mapColor('#5e99ac')} roughness={.85} /></mesh>
      {gym && <mesh geometry={gym.stairRails} raycast={() => null}><meshStandardMaterial color={mapColor('#879690')} roughness={.65} /></mesh>}
      {gym && <mesh geometry={gym.frame}><meshStandardMaterial ref={frameMaterial} color={mapColor(ARCHITECTURE_COLORS.frame)} roughness={.9} transparent depthWrite /></mesh>}
      <mesh geometry={rails} raycast={() => null}>
      <meshStandardMaterial ref={railMaterial} color={mapColor(ARCHITECTURE_COLORS.rail)} roughness={.9} transparent depthWrite />
    </mesh></group>
  </group>;
}

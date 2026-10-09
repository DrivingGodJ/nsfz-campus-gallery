import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GYM_ID } from './architecture-geometry';
import { gymDetailGeometry, STANDS_ID, standsArchitecture, THEATRE_ID, theatreInteriorGeometry } from './venue-geometry';
import { useMapColor } from './MapTheme';
import type { Building } from './types';

export default function VenueDetails({ building, height, floorHeight, cutawayHeight, stands }: {
  building: Building; height: number; floorHeight: number; cutawayHeight?: number; stands?: ReturnType<typeof standsArchitecture>;
}) {
  const mapColor = useMapColor(), detail = useRef<THREE.Group>(null);
  const auditorium = useMemo(() => building.id === THEATRE_ID ? theatreInteriorGeometry(building, height, floorHeight, cutawayHeight) : undefined, [building, height, floorHeight, cutawayHeight]);
  const gym = useMemo(() => building.id === GYM_ID ? gymDetailGeometry(building, height, floorHeight, cutawayHeight) : undefined, [building, height, floorHeight, cutawayHeight]);
  useEffect(() => () => { if (auditorium) Object.values(auditorium).forEach(geometry => geometry.dispose()); }, [auditorium]);
  useEffect(() => () => { if (gym) Object.values(gym).forEach(geometry => geometry.dispose()); }, [gym]);
  useFrame(({ camera }) => {
    if (detail.current) detail.current.visible = Math.hypot(camera.position.x - building.center[0], camera.position.y - (building.baseElevation ?? 0), camera.position.z - building.center[1]) < 300;
  });
  const material = (color: string, transparent = false) => <meshStandardMaterial color={mapColor(color)} roughness={transparent ? .35 : .9} transparent={transparent} opacity={transparent ? .22 : 1} depthWrite={!transparent} side={THREE.DoubleSide} />;
  return <group>
    {stands && building.id === STANDS_ID && <>
      <mesh geometry={stands.tiersBlue}>{material('#88a8b2')}</mesh>
      <mesh geometry={stands.tiersRed}>{material('#b5705e')}</mesh>
      <mesh geometry={stands.tiersGreen}>{material('#7f9881')}</mesh>
      <mesh geometry={stands.canopy}>{material('#c1c5be')}</mesh>
      <mesh geometry={stands.glass} raycast={() => null}>{material('#8da7ac', true)}</mesh>
    </>}
    <group ref={detail}>
      {stands && <>
        <mesh geometry={stands.frames}>{material('#c8c6b8')}</mesh>
        <mesh geometry={stands.rails} raycast={() => null}>{material('#5f6c66')}</mesh>
      </>}
      {auditorium && <>
        <mesh geometry={auditorium.tiers}>{material('#7c8179')}</mesh>
        <mesh geometry={auditorium.seats}>{material('#b8b7aa')}</mesh>
        <mesh geometry={auditorium.wood}>{material('#a77856')}</mesh>
        <mesh geometry={auditorium.curtains}>{material('#845345')}</mesh>
        <mesh geometry={auditorium.rails} raycast={() => null}>{material('#70645a')}</mesh>
      </>}
      {gym && <>
        <mesh geometry={gym.metal}>{material('#b5bdb7')}</mesh>
        <mesh geometry={gym.blue}>{material('#568fa4')}</mesh>
        <mesh geometry={gym.glass} raycast={() => null}>{material('#a4bfbd', true)}</mesh>
        <mesh geometry={gym.screens}>{material('#334b4d')}</mesh>
        <mesh geometry={gym.lattice} raycast={() => null}>{material('#b8b3a1')}</mesh>
      </>}
    </group>
  </group>;
}

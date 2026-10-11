import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GYM_ID } from './architecture-geometry';
import { gymDetailGeometry, STANDS_ID, standsArchitecture, THEATRE_ID, theatreInteriorGeometry } from './venue-geometry';
import { useMapColor } from './MapTheme';
import type { Building } from './types';
import { buildingColors, buildingMaterialColor, type BuildingColors } from './building-colors';

export default function VenueDetails({ building, height, floorHeight, cutawayHeight, stands }: {
  building: Building; height: number; floorHeight: number; cutawayHeight?: number; stands?: ReturnType<typeof standsArchitecture>;
}) {
  const mapColor = useMapColor(), detail = useRef<THREE.Group>(null);
  const canopy = useMemo(() => {
    if (!stands) return;
    const geometry = stands.canopy, normal = geometry.getAttribute('normal'), index = geometry.getIndex();
    if (!normal?.count) return geometry;
    const count = index?.count ?? normal.count;
    geometry.clearGroups();
    let start = 0, current = -1;
    // DJI_0004 / 6880d600 show a grey canopy top and a warm brown ceiling.
    for (let i = 0; i < count; i += 3) {
      const material = [0, 1, 2].every(j => normal.getY(index ? index.getX(i + j) : i + j) < -.5) ? 1 : 0;
      if (material !== current) {
        if (current >= 0) geometry.addGroup(start, i - start, current);
        start = i; current = material;
      }
    }
    geometry.addGroup(start, count - start, current);
    return geometry;
  }, [stands]);
  const auditorium = useMemo(() => building.id === THEATRE_ID ? theatreInteriorGeometry(building, height, floorHeight, cutawayHeight) : undefined, [building, height, floorHeight, cutawayHeight]);
  const gym = useMemo(() => building.id === GYM_ID ? gymDetailGeometry(building, height, floorHeight, cutawayHeight) : undefined, [building, height, floorHeight, cutawayHeight]);
  useEffect(() => () => { if (auditorium) Object.values(auditorium).forEach(geometry => geometry.dispose()); }, [auditorium]);
  useEffect(() => () => { if (gym) Object.values(gym).forEach(geometry => geometry.dispose()); }, [gym]);
  useFrame(({ camera }) => {
    if (detail.current) detail.current.visible = Math.hypot(camera.position.x - building.center[0], camera.position.y - (building.baseElevation ?? 0), camera.position.z - building.center[1]) < 300;
  });
  const material = (color: string, transparent = false, kind?: keyof BuildingColors, attach = 'material') => <meshStandardMaterial attach={attach} color={kind ? buildingMaterialColor(building, kind, color, mapColor) : buildingColors(building) ? color : mapColor(color)} roughness={transparent ? .35 : .9} transparent={transparent} opacity={transparent ? .22 : 1} depthWrite={!transparent} side={THREE.DoubleSide} />;
  return <group>
    {stands && building.id === STANDS_ID && <>
      <mesh geometry={stands.tiersBlue}>{material('#88a8b2', false, 'tierBlue')}</mesh>
      <mesh geometry={stands.tiersRed}>{material('#b5705e', false, 'tierRed')}</mesh>
      <mesh geometry={stands.tiersGreen}>{material('#7f9881', false, 'tierGreen')}</mesh>
      <mesh geometry={canopy}>{material('#c1c5be', false, 'roof', 'material-0')}{material('#977b69', false, 'canopyUnderside', 'material-1')}</mesh>
      <mesh geometry={stands.glass} raycast={() => null}>{material('#8da7ac', true, 'glass')}</mesh>
    </>}
    <group ref={detail}>
      {stands && <>
        <mesh geometry={stands.frames}>{material('#c8c6b8', false, 'frame')}</mesh>
        <mesh geometry={stands.rails} raycast={() => null}>{material('#5f6c66', false, 'rail')}</mesh>
      </>}
      {auditorium && <>
        <mesh geometry={auditorium.tiers}>{material('#626b65')}</mesh>
        <mesh geometry={auditorium.seats}>{material('#e1ddd2')}</mesh>
        <mesh geometry={auditorium.wood}>{material('#a96340')}</mesh>
        <mesh geometry={auditorium.curtains}>{material('#805148')}</mesh>
        <mesh geometry={auditorium.rails} raycast={() => null}>{material('#70645a')}</mesh>
      </>}
      {gym && <>
        <mesh geometry={gym.metal}>{material('#b5bdb7', false, 'metal')}</mesh>
        <mesh geometry={gym.blue}>{material('#3986a0')}</mesh>
        <mesh geometry={gym.glass} raycast={() => null}>{material('#a4bfbd', true, 'glass')}</mesh>
        <mesh geometry={gym.screens}>{material('#334b4d')}</mesh>
        <mesh geometry={gym.lattice} raycast={() => null}>{material('#b8b3a1', false, 'trim')}</mesh>
      </>}
    </group>
  </group>;
}

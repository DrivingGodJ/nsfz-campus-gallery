import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { buildingMaterialColor, type BuildingColors } from './building-colors';
import { PHOTO_FACADE_COLORS, photoFacadeDetailGeometry } from './photo-facade-geometry';
import type { Building, BuildingPart } from './types';

const materials: Record<keyof typeof PHOTO_FACADE_COLORS, keyof BuildingColors> = { stone: 'trim', roof: 'roof', accent: 'brick', glass: 'glass', frame: 'frame' };

export default function PhotoFacadeDetails({ building, sections, floorHeight, cutawayHeight }: {
  building: Building; sections: (BuildingPart & { floors: number; height: number })[]; floorHeight: number; cutawayHeight?: number;
}) {
  const mapColor = useMapColor(), group = useRef<THREE.Group>(null);
  const model = useMemo(() => photoFacadeDetailGeometry(building, sections, floorHeight, cutawayHeight), [building, sections, floorHeight, cutawayHeight]);
  useEffect(() => () => Object.values(model).forEach(geometry => geometry.dispose()), [model]);
  useFrame(({ camera }) => { if (group.current) group.current.visible = Math.hypot(camera.position.x - building.center[0], camera.position.y, camera.position.z - building.center[1]) < 500; });
  return <group ref={group}>{(Object.keys(model) as (keyof typeof model)[]).filter(kind => model[kind].getAttribute('position').count).map(kind => <mesh key={kind} geometry={model[kind]} raycast={() => null}>
    <meshStandardMaterial color={buildingMaterialColor(building, materials[kind], PHOTO_FACADE_COLORS[kind], mapColor)} side={THREE.DoubleSide} forceSinglePass roughness={kind === 'glass' ? .4 : .85} metalness={kind === 'frame' ? .15 : 0} transparent={kind === 'glass' || cutawayHeight !== undefined} opacity={kind === 'glass' ? .26 : cutawayHeight === undefined ? 1 : .65} depthWrite={kind !== 'glass' && cutawayHeight === undefined} />
  </mesh>)}</group>;
}

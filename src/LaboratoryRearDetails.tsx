import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { Trees } from './Forest';
import { LAB_REAR_COLORS, laboratoryRearFacadeGeometry } from './laboratory-rear-geometry';
import { LAB_REAR_GROUND_COLORS, laboratoryRearLandscape } from './laboratory-rear-landscape';
import type { Building } from './types';

export default function LaboratoryRearDetails({ building, height, floorHeight, cutawayHeight }: {
  building: Building; height: number; floorHeight: number; cutawayHeight?: number;
}) {
  const mapColor = useMapColor();
  const facade = useMemo(() => laboratoryRearFacadeGeometry(building, height, floorHeight, cutawayHeight), [building, height, floorHeight, cutawayHeight]);
  const ground = useMemo(() => laboratoryRearLandscape(building), [building]);
  useEffect(() => () => Object.values(facade).forEach(geometry => geometry.dispose()), [facade]);
  useEffect(() => () => Object.values(ground.geometry).forEach(geometry => geometry.dispose()), [ground]);
  return <group name="laboratory-rear-photo-details">
    {(Object.keys(LAB_REAR_COLORS) as (keyof typeof LAB_REAR_COLORS)[]).map(kind => <mesh key={kind} geometry={facade[kind]} raycast={() => null}>
      <meshStandardMaterial color={mapColor(LAB_REAR_COLORS[kind])} roughness={kind === 'glass' ? .28 : .9} metalness={kind === 'metal' || kind === 'frames' ? .18 : 0}
        side={THREE.DoubleSide} forceSinglePass transparent={kind === 'glass'} opacity={kind === 'glass' ? .42 : 1} depthWrite={kind !== 'glass'} />
    </mesh>)}
    {(Object.keys(LAB_REAR_GROUND_COLORS) as (keyof typeof LAB_REAR_GROUND_COLORS)[]).map(kind => <mesh key={kind} geometry={ground.geometry[kind]} raycast={() => null}>
      <meshStandardMaterial color={mapColor(LAB_REAR_GROUND_COLORS[kind])} roughness={.95} />
    </mesh>)}
    <Trees trees={ground.trees} openCanopy />
  </group>;
}

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { campusExteriorGeometry, EXTERIOR_COLORS } from './campus-exterior-geometry';
import type { Building } from './types';

export default function CampusExteriorDetails({ building, floors, floorHeight, cutawayHeight, annexFloors }: {
  building: Building; floors: number; floorHeight: number; cutawayHeight?: number; annexFloors?: number;
}) {
  const mapColor = useMapColor();
  const model = useMemo(() => campusExteriorGeometry(building, floors, floorHeight, cutawayHeight, annexFloors), [building, floors, floorHeight, cutawayHeight, annexFloors]);
  useEffect(() => () => Object.values(model).forEach(geometry => geometry.dispose()), [model]);
  return <group>{(Object.keys(model) as (keyof typeof model)[]).filter(kind => model[kind].getAttribute('position').count).map(kind => <mesh key={kind} geometry={model[kind]} raycast={() => null}>
    <meshStandardMaterial color={mapColor(EXTERIOR_COLORS[kind])} side={THREE.DoubleSide} roughness={kind === 'glass' ? .42 : .9} metalness={kind === 'glass' ? .12 : 0} transparent={cutawayHeight !== undefined} opacity={cutawayHeight === undefined ? 1 : .6} depthWrite={cutawayHeight === undefined} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
  </mesh>)}</group>;
}

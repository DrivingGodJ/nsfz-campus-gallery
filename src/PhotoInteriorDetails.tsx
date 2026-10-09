import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { PHOTO_INTERIOR_COLORS, photoInteriorGeometry } from './photo-interior-geometry';
import type { Building } from './types';

export default function PhotoInteriorDetails({ building, height, floorHeight, cutawayHeight }: {
  building: Building; height: number; floorHeight: number; cutawayHeight?: number;
}) {
  const mapColor=useMapColor(), detail=useRef<THREE.Group>(null);
  const batches=useMemo(()=>photoInteriorGeometry(building,height,floorHeight,cutawayHeight),[building,height,floorHeight,cutawayHeight]);
  useEffect(()=>()=>batches.forEach(batch=>batch.geometry.dispose()),[batches]);
  useFrame(({camera})=>{
    if(detail.current) detail.current.visible=Math.hypot(camera.position.x-building.center[0],camera.position.y-(building.baseElevation??0),camera.position.z-building.center[1])<280;
  });
  return <group ref={detail}>
    {batches.map(({kind,geometry})=><mesh key={kind} geometry={geometry} raycast={()=>null}>
      <meshStandardMaterial color={mapColor(PHOTO_INTERIOR_COLORS[kind])} roughness={kind==='metal'?.65:.9} metalness={kind==='metal'?.15:0} side={THREE.DoubleSide} />
    </mesh>)}
  </group>;
}

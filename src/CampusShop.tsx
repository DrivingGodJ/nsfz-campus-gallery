import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { campusShopGeometry, CAMPUS_SHOP_COLORS } from './campus-shop-geometry';
import type { Building } from './types';

export default function CampusShop({ building, height, cutaway }: { building: Building; height: number; cutaway: boolean }) {
  const geometry = useMemo(() => campusShopGeometry(building, height, cutaway), [building, height, cutaway]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group>{(Object.keys(geometry) as (keyof typeof geometry)[]).map(kind => <mesh key={kind} geometry={geometry[kind]}>
    <meshStandardMaterial color={CAMPUS_SHOP_COLORS[kind]} roughness={kind === 'glass' ? .25 : .92} side={THREE.DoubleSide}
      transparent={kind === 'glass' || cutaway} opacity={kind === 'glass' ? .32 : cutaway ? .62 : 1} depthWrite={kind !== 'glass'} />
  </mesh>)}</group>;
}

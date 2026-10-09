import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { ghostSurfaceModel } from './map-model-layer';

export default function MapModelLayer({ underground, children }: { underground: boolean; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const invalidate = useThree(state => state.invalidate);
  useLayoutEffect(() => {
    if (!underground || !group.current) return;
    const restore = ghostSurfaceModel(group.current);
    invalidate();
    return restore;
  }, [underground, children, invalidate]);
  return <group ref={group}>{children}</group>;
}

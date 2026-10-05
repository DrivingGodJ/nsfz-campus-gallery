import { useEffect, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import type * as THREE from 'three';
import { renderDepthPixels, type DepthPixels } from './depth-map';

export type DepthMapCapture = () => DepthPixels;

// Lives inside <Canvas> so the depth pass can reuse the live renderer, scene and
// the photo-perspective camera — including its view offset, so the exported
// distances match the framing shown on screen.
export default function DepthMapCapture({ capture }: { capture: RefObject<DepthMapCapture | null> }) {
  const gl = useThree(state => state.gl);
  const scene = useThree(state => state.scene);
  const camera = useThree(state => state.camera);
  const invalidate = useThree(state => state.invalidate);
  useEffect(() => {
    capture.current = () => {
      const rendered = renderDepthPixels({ renderer: gl, scene, camera: camera as THREE.PerspectiveCamera, logarithmic: !!gl.capabilities.logarithmicDepthBuffer });
      // Schedule one normal frame: the canvas itself is untouched, but the
      // renderer's target was swapped and restored during the pass.
      invalidate();
      return rendered;
    };
    return () => { capture.current = null; };
  }, [gl, scene, camera, invalidate, capture]);
  return null;
}

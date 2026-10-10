import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Feature } from './types';
import { useMapColor } from './MapTheme';
import { bajinStatueGeometry } from './bajin-statue-geometry';

export default function BajinStatue({ feature }: { feature: Feature }) {
  const model = feature.statue!, mapColor = useMapColor();
  const yuanLongping = model.variant === 'yuanLongping';
  const geometry = useMemo(() => bajinStatueGeometry(model), [model]);
  const inscription = useMemo(() => {
    if (!yuanLongping) return null;
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 128;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#b8a366'; context.font = '48px "Kaiti SC", "Songti SC", serif';
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('袁隆平', 128, 64);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, [yuanLongping]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  useEffect(() => () => inscription?.dispose(), [inscription]);
  return <group name={feature.id} position={[model.center[0], feature.height ?? .02, model.center[1]]} rotation={[0, Math.atan2(-model.axis[1], model.axis[0]), 0]}>
    <mesh geometry={geometry.steps}><meshStandardMaterial color={mapColor('#b2b2a5')} roughness={.95} /></mesh>
    <mesh geometry={geometry.pedestal}><meshStandardMaterial color={mapColor(yuanLongping ? '#626660' : '#79534a')} roughness={.9} /></mesh>
    <mesh geometry={geometry.bust}><meshStandardMaterial color={mapColor(yuanLongping ? '#b4bbb1' : '#d3dcd5')} vertexColors roughness={.85} metalness={.12} /></mesh>
    {inscription && <mesh position={[0, model.totalHeight * .44, model.depth * .42 + .003]} raycast={() => null}>
      <planeGeometry args={[model.width * .65, model.totalHeight * .105]} />
      <meshBasicMaterial map={inscription} transparent depthWrite={false} />
    </mesh>}
  </group>;
}

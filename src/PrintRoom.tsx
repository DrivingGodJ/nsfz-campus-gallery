import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { printRoomGeometry, printRoomSignGeometry, PRINT_ROOM_COLORS } from './print-room-geometry';
import type { Building } from './types';

export default function PrintRoom({ building, height, cutaway }: { building: Building; height: number; cutaway: boolean }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => printRoomGeometry(building, height, cutaway), [building, height, cutaway]);
  const sign = useMemo(() => printRoomSignGeometry(building, height), [building, height]);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 192;
    const context = canvas.getContext('2d')!;
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillStyle = '#dfb472';
    context.font = '112px "Kaiti SC", "STKaiti", "KaiTi", serif';
    context.fillText('桃李园', 384, 66);
    context.font = '38px "Songti SC", serif'; context.fillText('学生服务中心', 384, 153);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }, []);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  useEffect(() => () => sign.dispose(), [sign]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <group>{(Object.keys(geometry) as (keyof typeof geometry)[]).map(kind => <mesh key={kind} geometry={geometry[kind]}>
    <meshStandardMaterial color={mapColor(PRINT_ROOM_COLORS[kind])} roughness={.97} side={THREE.DoubleSide} transparent={cutaway} opacity={cutaway ? .62 : 1} />
  </mesh>)}<mesh geometry={sign} raycast={() => null}><meshBasicMaterial map={texture} transparent opacity={cutaway ? .62 : 1} depthWrite={false} /></mesh></group>;
}

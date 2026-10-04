import { useMapColor } from './MapTheme';
import { useEffect, useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import type { Feature, GateLandmark as LandmarkModel } from './types';
import { bellGeometry, bellTowerLayout, landmarkRotation, monumentLayout, monumentSignGeometry, type LandmarkBox } from './gate-landmark-geometry';
import { LocationHtml, LocationName } from './LocationSelection';

function Boxes({ items }: { items: LandmarkBox[] }) {
  const mapColor = useMapColor();
  return <>{items.map((box, i) => <mesh key={i} position={box.position} rotation={[0, box.rotation || 0, 0]}><boxGeometry args={box.size} /><meshStandardMaterial color={mapColor(box.color)} roughness={.95} /></mesh>)}</>;
}
function Monument({ model }: { model: LandmarkModel }) {
  const mapColor = useMapColor();
  const layout = useMemo(() => monumentLayout(model), [model]);
  const cap = useMemo(() => new THREE.Shape(layout.ring.map(([x, z]) => new THREE.Vector2(x, -z))), [layout]);
  const geometry = useMemo(() => monumentSignGeometry(model), [model]);
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2048; canvas.height = 256;
    const context = canvas.getContext('2d')!;
    context.fillStyle = mapColor('#795b32'); context.font = '144px "Songti SC", "Noto Serif SC", serif'; context.textAlign = 'center'; context.textBaseline = 'middle';
    context.fillText('南京师范大学附属中学', 1024, 138, 1850);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
  }, [mapColor]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <group><Boxes items={layout.boxes} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, layout.beamBottom, 0]}><extrudeGeometry args={[cap, { depth: layout.beamHeight, bevelEnabled: false }]} /><meshStandardMaterial color={mapColor('#d3c7ae')} roughness={.95} /></mesh>
    <mesh geometry={geometry}><meshBasicMaterial map={texture} transparent depthWrite={false} side={THREE.FrontSide} /></mesh>
  </group>;
}
function BellTower({ model }: { model: LandmarkModel }) {
  const mapColor = useMapColor();
  const layout = useMemo(() => bellTowerLayout(model), [model]);
  const geometry = useMemo(() => bellGeometry(model), [model]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const brass = '#b99b5c', cap = '#aaa38e', bellTop = layout.bell.bottom + layout.bell.height, s = layout.scale;
  return <group><Boxes items={layout.boxes} />
    <mesh position={layout.doorway.position}><planeGeometry args={layout.doorway.size} /><meshStandardMaterial color={mapColor('#526356')} roughness={.65} /></mesh>
    <mesh geometry={geometry} position={[0, layout.bell.bottom, 0]}><meshStandardMaterial color={mapColor(brass)} roughness={.48} metalness={.4} /></mesh>
    <mesh position={[0, (bellTop + layout.chamberTop) / 2, 0]}><cylinderGeometry args={[.055 * s, .055 * s, layout.chamberTop - bellTop, 8]} /><meshStandardMaterial color={mapColor(cap)} /></mesh>
    <mesh position={[0, layout.bell.bottom + .18 * s, 0]}><sphereGeometry args={[.12 * s, 12, 8]} /><meshStandardMaterial color={mapColor('#83653a')} metalness={.35} roughness={.5} /></mesh>
    <mesh position={[0, layout.dome.bottom, 0]}><cylinderGeometry args={[layout.dome.radius * 1.25, layout.dome.radius * 1.25, .22 * s, 24]} /><meshStandardMaterial color={mapColor(cap)} roughness={.9} /></mesh>
    <mesh position={[0, layout.dome.bottom + .1 * s, 0]}><sphereGeometry args={[layout.dome.radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={mapColor('#b9ae92')} roughness={.85} /></mesh>
    <mesh position={[0, layout.mast.bottom - .13 * s, 0]}><cylinderGeometry args={[.2 * s, .26 * s, .45 * s, 12]} /><meshStandardMaterial color={mapColor(cap)} roughness={.85} /></mesh>
    <mesh position={[0, (layout.mast.bottom + layout.mast.top) / 2, 0]}><cylinderGeometry args={[.045 * s, .08 * s, layout.mast.top - layout.mast.bottom, 8]} /><meshStandardMaterial color={mapColor('#6a7366')} roughness={.85} /></mesh>
  </group>;
}
export default function GateLandmark({ feature, labelPortal }: { feature: Feature; labelPortal: RefObject<HTMLDivElement> }) {
  const model = feature.landmark!;
  return <group>
    <group position={[model.center[0], .12, model.center[1]]} rotation={[0, landmarkRotation(model), 0]}>{model.kind === 'gate-monument' ? <Monument model={model} /> : <BellTower model={model} />}</group>
    {!feature.hideLabel && feature.name && <LocationHtml portal={labelPortal} position={[model.center[0], model.totalHeight + 2, model.center[1]]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name} /></LocationHtml>}
  </group>;
}

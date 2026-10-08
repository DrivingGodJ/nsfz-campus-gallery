import { useMapColor } from './MapTheme';
import { Line } from '@react-three/drei';
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Building } from './types';
import { buildingGeometry } from './building-geometry';
import { pavilionGeometry, pavilionSurfaceGeometry, PAVILION_BASE, type PavilionPoint } from './pavilion-geometry';

function GlassSurface({ vertices, indices, opacity, color = '#9fb6ab', wall = false }: { vertices: PavilionPoint[]; indices: number[]; opacity: number; color?: string; wall?: boolean }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => pavilionSurfaceGeometry(vertices, indices), [vertices, indices]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry} renderOrder={2}>
    {wall ? <meshStandardMaterial color={mapColor(color)} transparent opacity={opacity} roughness={.45} metalness={.05} side={THREE.DoubleSide} depthWrite={false} /> : <meshBasicMaterial color={mapColor(color)} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />}
  </mesh>;
}
export default function HistoryPavilion({ building, height, color, selected, cutaway = false }: { building: Building; height: number; color: string; selected: boolean; cutaway?: boolean }) {
  const mapColor = useMapColor();
  const model = building.appearance!;
  const geometry = useMemo(() => pavilionGeometry(model, height, 48, cutaway), [model, height, cutaway]);
  const platforms = useMemo(() => [1, .97, .94].map(scale => {
    const shape = new THREE.Shape(building.outer.map(([x, z]) => new THREE.Vector2(model.center[0] + (x - model.center[0]) * scale, -(model.center[1] + (z - model.center[1]) * scale))));
    shape.holes = building.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    return shape;
  }), [building, model]);
  const bodyShapes = useMemo(() => [geometry.core, geometry.rearWing].map(data => new THREE.Shape(data.outer.map(([x, z]) => new THREE.Vector2(x, -z)))), [geometry]);
  const rearBody = useMemo(() => buildingGeometry(geometry.rearWing, geometry.rearTop - PAVILION_BASE, height, [], [], [], undefined, [], [], cutaway), [geometry, height, cutaway]);
  useEffect(() => () => rearBody.dispose(), [rearBody]);
  const frameColor = selected ? '#567760' : '#b8bbac';
  const wallHeight = geometry.wallTop - PAVILION_BASE;
  const ring = (radius: number, y: number) => geometry.rim.map(([x, , z]): PavilionPoint => [model.center[0] + (x - model.center[0]) * radius / model.radius, y, model.center[1] + (z - model.center[1]) * radius / model.radius]);
  return <group>
    {platforms.map((shape, i) => <mesh key={i} position={[0, .12 + i * .12, 0]} rotation={[-Math.PI / 2, 0, 0]}><extrudeGeometry args={[shape, { depth: .12, bevelEnabled: false }]} /><meshStandardMaterial color={mapColor(color)} roughness={.95} /></mesh>)}
    <mesh geometry={rearBody} position={[0, PAVILION_BASE, 0]} rotation={[-Math.PI / 2, 0, 0]}><meshStandardMaterial color={mapColor(color)} roughness={.95} /></mesh>
    <GlassSurface vertices={geometry.wallVertices} indices={geometry.wallIndices} opacity={.42} color={selected ? '#83a896' : '#93ada2'} wall />
    <GlassSurface vertices={geometry.rearGlassVertices} indices={geometry.rearGlassIndices} opacity={.42} color={selected ? '#83a896' : '#93ada2'} wall />
    <mesh position={[0, PAVILION_BASE + .03, 0]} rotation={[-Math.PI / 2, 0, 0]}><shapeGeometry args={[bodyShapes[0]]} /><meshStandardMaterial color={mapColor('#aeb5a2')} roughness={1} /></mesh>
    <GlassSurface vertices={geometry.roofVertices} indices={geometry.roofIndices} opacity={.35} />
    <GlassSurface vertices={geometry.canopyVertices} indices={geometry.canopyIndices} opacity={.3} />
    {[0, .32, .66, 1].map(level => <Line key={level} points={ring(model.radius, PAVILION_BASE + wallHeight * level)} color={mapColor(frameColor)} lineWidth={1.2} />)}
    {geometry.posts.map((rim, i) => {
      return <group key={i}><mesh position={[rim[0], PAVILION_BASE + wallHeight / 2, rim[2]]}><boxGeometry args={[.14, wallHeight, .14]} /><meshStandardMaterial color={mapColor(frameColor)} roughness={.8} /></mesh>
        {!cutaway && <Line points={[[model.center[0], geometry.peak, model.center[1]], rim]} color={mapColor(frameColor)} lineWidth={1} />}
      </group>;
    })}
    {!cutaway && <><Line points={ring(model.radius * .38, geometry.peak - (geometry.peak - geometry.wallTop) * .38)} color={mapColor(frameColor)} lineWidth={1} />
    <Line points={geometry.canopyInner} color={mapColor(frameColor)} lineWidth={1.2} /><Line points={geometry.canopyOuter} color={mapColor(frameColor)} lineWidth={1.2} />
    {geometry.canopyRibs.map(({ inner, outer }, i) => {
      return <group key={i}><Line points={[inner, outer]} color={mapColor(frameColor)} lineWidth={1} />
        {i % 2 === 0 && <mesh position={[outer[0], (outer[1] + PAVILION_BASE) / 2, outer[2]]}><boxGeometry args={[.12, outer[1] - PAVILION_BASE, .12]} /><meshStandardMaterial color={mapColor(frameColor)} roughness={.8} /></mesh>}
      </group>;
    })}</>}
  </group>;
}

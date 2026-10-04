import { useMapColor } from './MapTheme';
import { Line } from '@react-three/drei';
import { useEffect, useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import type { Building, BuildingOverride, Feature, Point, Shape } from './types';
import { bridgeHeight, bridgeSurfaceHeight, curvedStairPoint, curvedStairTreads, straightStairTreads } from './structure-geometry';
import { undergroundFootprints, undergroundLayout, type PassageOpening } from './underground-geometry';
import { undergroundBoundaryLines, undergroundVolume } from './underground-mesh';
import { BRIDGE_DECK_THICKNESS, bridgeLayout, bridgeRailPosts, bridgeSupports, type RailPoint } from './bridge-geometry';
import { archedBridgeGeometry } from './bridge-mesh';
import { LocationHtml, LocationName } from './LocationSelection';
import GateLandmark from './GateLandmark';
import LakeGarden from './LakeGarden';
import MottoStone from './MottoStone';
import FlagPlatform from './FlagPlatform';

function Segment({ from, to, width, y, thickness, color, ghost = false }: { from: Point; to: Point; width: number; y: number; thickness: number; color: string; ghost?: boolean }) {
  const mapColor = useMapColor();
  const dx = to[0] - from[0], dz = to[1] - from[1];
  return <mesh position={[(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2]} rotation={[0, Math.atan2(dx, dz), 0]} renderOrder={ghost ? 20 : 0}>
    <boxGeometry args={[width, thickness, Math.hypot(dx, dz)]} />
    <meshStandardMaterial color={mapColor(color)} roughness={.9} transparent={ghost} opacity={ghost ? .25 : 1} depthTest={!ghost} depthWrite={!ghost} />
  </mesh>;
}
function RailBar({ from, to, radius, color }: { from: RailPoint; to: RailPoint; radius: number; color: string }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => {
    const direction = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    return { length: direction.length(), rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize()) };
  }, [from, to]);
  if (geometry.length < 1e-6) return null;
  return <mesh position={from.map((n, i) => (n + to[i]) / 2) as RailPoint} quaternion={geometry.rotation}><cylinderGeometry args={[radius, radius, geometry.length, 8]} /><meshStandardMaterial color={mapColor(color)} roughness={.9} /></mesh>;
}
function BridgeRails({ chains, smooth = false }: { chains: RailPoint[][]; smooth?: boolean }) {
  const mapColor = useMapColor();
  const posts = useMemo(() => bridgeRailPosts(chains, 3, smooth), [chains, smooth]);
  const corners = useMemo(() => [...new Map(chains.flat().map(point => [point.map(n => n.toFixed(6)).join(','), point])).values()], [chains]);
  return <group>
    {[{ offset: 1, radius: .065, color: '#5c7866' }, { offset: .48, radius: .04, color: '#738979' }].map(rail => <group key={rail.offset}>
      {chains.map((chain, i) => <group key={i}>{chain.slice(1).map((to, j) => <RailBar key={j} from={[chain[j][0], chain[j][1] + rail.offset, chain[j][2]]} to={[to[0], to[1] + rail.offset, to[2]]} radius={rail.radius} color={rail.color} />)}</group>)}
      {corners.map((point, i) => <mesh key={i} position={[point[0], point[1] + rail.offset, point[2]]}><sphereGeometry args={[rail.radius, 8, 6]} /><meshStandardMaterial color={mapColor(rail.color)} roughness={.9} /></mesh>)}
    </group>)}
    {posts.map((point, i) => <mesh key={i} position={[point[0], point[1] + .5, point[2]]}><boxGeometry args={[.13, 1, .13]} /><meshStandardMaterial color={mapColor('#5c7866')} roughness={.9} /></mesh>)}
  </group>;
}
function BridgeDeck({ shapes, height }: { shapes: { outer: Point[]; holes: Point[][] }[]; height: number }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => shapes.map(data => {
    const shape = new THREE.Shape(data.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = data.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    return shape;
  }), [shapes]);
  return <group>{geometry.map((shape, i) => <mesh key={i} position={[0, height - BRIDGE_DECK_THICKNESS, 0]} rotation={[-Math.PI / 2, 0, 0]}><extrudeGeometry args={[shape, { depth: BRIDGE_DECK_THICKNESS, bevelEnabled: false }]} /><meshStandardMaterial color={mapColor('#b6b39e')} roughness={.9} /></mesh>)}</group>;
}
function ArchedBridgeDeck({ feature, height }: { feature: Feature; height: number }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => archedBridgeGeometry(feature, height), [feature, height]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh geometry={geometry}><meshStandardMaterial color={mapColor('#b6b39e')} roughness={.9} /></mesh>;
}
function BridgeStairs({ from, to, width, top, bottom }: { from: Point; to: Point; width: number; top: number; bottom: number }) {
  return <group>{straightStairTreads(from, to, top, bottom).map((step, i) => {
    const thickness = step.height - bottom + .08;
    return <Segment key={i} from={step.from} to={step.to} width={width} y={bottom - .08 + thickness / 2} thickness={thickness} color={i % 2 ? '#bbb7a4' : '#c9c4af'} />;
  })}</group>;
}
function Bridge({ feature, buildings, overrides, labelPortal }: { feature: Feature; buildings: Building[]; overrides: Record<string, BuildingOverride>; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const points = feature.points!, width = feature.width || 3.5, y = bridgeHeight(feature, buildings, overrides);
  const first = points[0], last = points.at(-1)!;
  const layout = useMemo(() => bridgeLayout(feature, y), [feature, y]);
  const center: Point = [(first[0] + last[0]) / 2, (first[1] + last[1]) / 2];
  return <group>{feature.archRise ? <ArchedBridgeDeck feature={feature} height={y} /> : <BridgeDeck shapes={layout.deck} height={y} />}<BridgeRails chains={layout.railChains} smooth={!!feature.archRise} />
    {bridgeSupports(feature, y).map((support, i) => <mesh key={i} position={support.position}><boxGeometry args={support.size} /><meshStandardMaterial color={mapColor('#9b9f8e')} /></mesh>)}
    {layout.stairs.map(stair => <BridgeStairs key={stair.id} from={stair.from} to={stair.to} width={width} top={stair.top} bottom={stair.bottom} />)}
    {feature.connections?.filter(c => c.buildingId).map(connection => {
      const end = connection.points.at(-1)!, building = buildings.find(b => b.id === connection.buildingId);
      if (!building) return null;
      const edges = building.outer.slice(1).map((to, i) => {
        const from = building.outer[i], dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
        return { normal: [dz / length, -dx / length], distance: Math.abs((end[0] - from[0]) * dz - (end[1] - from[1]) * dx) / length };
      }).sort((a, b) => a.distance - b.distance);
      const normal = edges[0].normal;
      return <mesh key={connection.id} position={[end[0] + normal[0] * .08, y + 1.1, end[1] + normal[1] * .08]} rotation={[0, Math.atan2(normal[0], normal[1]), 0]}><planeGeometry args={[2.5, 2.2]} /><meshStandardMaterial color={mapColor('#627966')} roughness={.9} side={THREE.DoubleSide} /></mesh>;
    })}
    {!feature.hideLabel && feature.name && <LocationHtml portal={labelPortal} position={[center[0], bridgeSurfaceHeight(feature, y, center) + 4, center[1]]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name} /></LocationHtml>}
  </group>;
}
function Entrance({ feature, underground, labelPortal }: { feature: Feature; underground: boolean; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const stair = feature.curvedStair;
  const treads = useMemo(() => stair ? curvedStairTreads(stair).map(tread => ({ ...tread, shape: new THREE.Shape(tread.ring.map(([x, z]) => new THREE.Vector2(x, -z))) })) : [], [stair]);
  const opening = useMemo(() => stair ? new THREE.Shape(curvedStairTreads({ ...stair, steps: 1 })[0].ring.map(([x, z]) => new THREE.Vector2(x, -z))) : null, [stair]);
  if (!stair || !opening) return null;
  const top = curvedStairPoint(stair, 0);
  const markerSize = feature.width || 3.2;
  return <group>
    <mesh position={[top[0], top[1] + markerSize / 2, top[2]]} rotation={[0, -stair.startAngle, 0]}>
      <boxGeometry args={[markerSize, markerSize, markerSize]} />
      <meshStandardMaterial color={mapColor('#b7b69e')} roughness={.9} />
    </mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .14, 0]}><shapeGeometry args={[opening]} /><meshStandardMaterial color={mapColor('#6b8174')} transparent opacity={underground ? .12 : .48} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    {underground && treads.map((tread, i) => <group key={i}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, tread.height - .16, 0]} renderOrder={25}><extrudeGeometry args={[tread.shape, { depth: .16, bevelEnabled: false }]} /><meshStandardMaterial color={mapColor(i % 2 ? '#b2ae95' : '#c8c2a8')} roughness={1} transparent opacity={.25} depthTest={false} depthWrite={false} /></mesh>
      <Line points={tread.ring.map(([x, z]) => [x, tread.height + .01, z])} color={mapColor('#667867')} lineWidth={.7} transparent opacity={.5} depthTest={false} depthWrite={false} renderOrder={26} />
    </group>)}
    <mesh position={[top[0], .04, top[2]]} rotation={[0, Math.atan2(-Math.sin(stair.startAngle) * stair.sweep, Math.cos(stair.startAngle) * stair.sweep), 0]} renderOrder={25}><boxGeometry args={[stair.width, .16, 1.4]} /><meshStandardMaterial color={mapColor('#b7b69e')} transparent opacity={.25} depthTest={false} depthWrite={false} /></mesh>
    {!feature.hideLabel && feature.name && <LocationHtml portal={labelPortal} position={[top[0], top[1] + markerSize + 1.5, top[2]]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name} underground /></LocationHtml>}
  </group>;
}
const NO_CONNECTIONS: Feature[] = [];
const NO_OPENINGS: PassageOpening[] = [];
function UndergroundArea({ feature, connections = NO_CONNECTIONS, footprints, openings = NO_OPENINGS, labelPortal }: { feature: Feature; connections?: Feature[]; footprints?: Shape[]; openings?: PassageOpening[]; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const floor = feature.height ?? -3, wallHeight = feature.wallHeight || 2.4;
  const corridor = feature.type === 'undergroundCorridor' || feature.type === 'tunnelJunction', tunnel = feature.type === 'tunnel';
  const color = tunnel ? '#d8c6a7' : corridor ? '#bad0c3' : '#bdcedf';
  const lineColor = tunnel ? '#ad9879' : corridor ? '#8faa99' : '#91a7bf';
  const shapes = useMemo(() => (footprints || undergroundFootprints(feature, connections)).map(footprint => {
    const shape = new THREE.Shape(footprint.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = footprint.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    return { shape, volume: undergroundVolume(footprint, wallHeight, openings), boundaries: undergroundBoundaryLines(footprint, openings) };
  }), [feature, connections, footprints, openings, wallHeight]);
  useEffect(() => () => shapes.forEach(item => item.volume.dispose()), [shapes]);
  const labelPosition = (item: Feature): [number, number, number] => {
    const points = item.points || item.outer!.slice(0, -1);
    const center = item.type === 'tunnelJunction' ? points[0] : item.points
      ? item.type === 'undergroundCorridor' ? points.slice(0, 2).reduce((sum, p) => [sum[0] + p[0] / 2, sum[1] + p[1] / 2], [0, 0]) : points[Math.floor(points.length / 2)]
      : points.reduce((sum, p) => [sum[0] + p[0] / points.length, sum[1] + p[1] / points.length], [0, 0]);
    return [center[0], floor + wallHeight + 2, center[1]];
  };
  return <group>
    {shapes.map(({ shape, volume, boundaries }, n) => <group key={n}>
      <mesh geometry={volume} position={[0, floor, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={22}><meshStandardMaterial color={mapColor(color)} transparent opacity={.1} depthTest={false} depthWrite={false} /></mesh>
      <mesh position={[0, floor + .04, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={23}><shapeGeometry args={[shape]} /><meshBasicMaterial color={mapColor(color)} side={THREE.DoubleSide} transparent opacity={.24} depthTest={false} depthWrite={false} /></mesh>
      {boundaries.map((ring, i) => <Line key={i} points={ring.map(([x, z]) => [x, floor + .08, z])} color={mapColor(lineColor)} lineWidth={1.2} transparent opacity={.7} dashed dashSize={2} gapSize={1} depthTest={false} depthWrite={false} renderOrder={24} />)}
    </group>)}
    {[feature, ...connections].filter(item => !item.hideLabel && item.name?.trim()).map(item => <LocationHtml key={item.id} portal={labelPortal} position={labelPosition(item)} center zIndexRange={[5, 1]}><LocationName id={item.id} name={item.name!} underground /></LocationHtml>)}
  </group>;
}
function UndergroundRunway({ feature, labelPortal }: { feature: Feature; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const [from, to] = feature.points!, width = feature.width || 5, floor = feature.height ?? -3;
  const dx = to[0] - from[0], dz = to[1] - from[1], length = Math.hypot(dx, dz);
  const side: Point = [dz / length, -dx / length];
  return <group>
    <Segment from={from} to={to} width={width} y={floor + .04} thickness={.12} color="#b98060" ghost />
    {Array.from({ length: 5 }, (_, i) => {
      const offset = (i / 4 - .5) * width;
      return <Line key={i} points={[[from[0] + side[0] * offset, floor + .12, from[1] + side[1] * offset], [to[0] + side[0] * offset, floor + .12, to[1] + side[1] * offset]]} color={mapColor('#faf0dc')} lineWidth={1} transparent opacity={.8} depthTest={false} depthWrite={false} renderOrder={24} />;
    })}
    <LocationHtml portal={labelPortal} position={[(from[0] + to[0]) / 2, floor + 4.4, (from[1] + to[1]) / 2]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name!} underground /></LocationHtml>
  </group>;
}
export default function CampusStructures({ features, buildings, overrides, underground, labelPortal }: { features: Feature[]; buildings: Building[]; overrides: Record<string, BuildingOverride>; underground: boolean; labelPortal: RefObject<HTMLDivElement> }) {
  const layout = useMemo(() => undergroundLayout(features), [features]);
  return <>{features.map(feature => {
    if (feature.type === 'mottoStone' && feature.stone) return <MottoStone key={feature.id} feature={feature} />;
    if (feature.type === 'flagPlatform' && feature.flagPlatform) return <FlagPlatform key={feature.id} feature={feature} />;
    if (['boardwalk', 'lakePavilion', 'pergola'].includes(feature.type)) return <LakeGarden key={feature.id} feature={feature} features={features} labelPortal={labelPortal} />;
    if (feature.type === 'landmark' && feature.landmark) return <GateLandmark key={feature.id} feature={feature} labelPortal={labelPortal} />;
    if (['undergroundRoom', 'undergroundCorridor', 'tunnel', 'tunnelJunction'].includes(feature.type)) {
      const area = layout.areas.get(feature.id);
      return underground && area ? <UndergroundArea key={feature.id} {...area} labelPortal={labelPortal} /> : null;
    }
    if (!feature.points || feature.points.length < 2) return null;
    if (feature.type === 'undergroundTrack') return underground ? <UndergroundRunway key={feature.id} feature={feature} labelPortal={labelPortal} /> : null;
    if (feature.type === 'bridge') return <Bridge key={feature.id} feature={feature} buildings={buildings} overrides={overrides} labelPortal={labelPortal} />;
    if (feature.type === 'tunnelEntrance') return <Entrance key={feature.id} feature={feature} underground={underground} labelPortal={labelPortal} />;
    return null;
  })}</>;
}

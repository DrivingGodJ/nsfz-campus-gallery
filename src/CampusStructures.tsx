import { useMapColor } from './MapTheme';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { memo, useEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react';
import * as THREE from 'three';
import type { Building, BuildingOverride, Feature, Point, Shape } from './types';
import { bridgeHeight, bridgeSurfaceHeight, curvedStairPoint, curvedStairTreads, straightStairTreads } from './structure-geometry';
import { undergroundFootprints, undergroundLayout, type PassageOpening } from './underground-geometry';
import { undergroundBoundaryLines, undergroundVolume, undergroundMaterialView, undergroundViewMode, undergroundPartVisible, type UndergroundViewSpace, type UndergroundInspectionMode } from './underground-mesh';
import { undergroundDetailGeometry, UNDERGROUND_COLORS } from './underground-details';
import { BRIDGE_DECK_THICKNESS, bridgeLayout, bridgeSupports, type RailPoint } from './bridge-geometry';
import { bridgeRailGeometry } from './bridge-rail-geometry';
import { bridgeNetGeometry } from './bridge-net-geometry';
import { archedBridgeGeometry } from './bridge-mesh';
import { LocationHtml, LocationName } from './LocationSelection';
import GateLandmark from './GateLandmark';
import LakeGarden from './LakeGarden';
import MottoStone from './MottoStone';
import FlagPlatform from './FlagPlatform';
import BajinStatue from './BajinStatue';
import { garageRampGeometry, garageRampFootprint } from './garage-ramp-geometry';
import MapModelLayer from './MapModelLayer';

function UndergroundView({ space, spaces, mode, photoPerspective = false, children }: { space: UndergroundViewSpace; spaces: UndergroundViewSpace[]; mode: UndergroundInspectionMode; photoPerspective?: boolean; children: ReactNode }) {
  const group=useRef<THREE.Group>(null), previous=useRef('');
  useEffect(()=>{previous.current='';},[space,spaces,children,mode,photoPerspective]);
  useFrame(({camera})=>{
    const view = undergroundViewMode(camera.position, space, spaces, mode, photoPerspective);
    const roofVisible = undergroundPartVisible('ceiling', view, camera.position.y, space.floor + space.height);
    const state = view + ':' + roofVisible;
    if(previous.current===state)return;
    previous.current=state;
    group.current?.traverse(object=>{
      if(object.userData.undergroundPlanOnly) object.visible=undergroundPartVisible('plan', view, camera.position.y, space.floor + space.height);
      // The detailed shell has the real window and door openings. The coarse
      // plan volume must not remain behind its photographed clerestories.
      if(object.userData.undergroundPlanVolume) object.visible=undergroundPartVisible('volume', view, camera.position.y, space.floor + space.height);
      const surface = object.userData.undergroundSurface;
      if(object.userData.undergroundCeiling) object.visible=roofVisible || surface && mode==='surface';
      const material=(object as THREE.Mesh).material;
      if(!material)return;
      if(object.userData.undergroundGhostRenderOrder===undefined)object.userData.undergroundGhostRenderOrder=object.renderOrder;
      object.renderOrder=view==='inside'||view==='overview'?0:object.userData.undergroundGhostRenderOrder;
      for(const item of Array.isArray(material)?material:[material]) {
        const opacity=item.userData.undergroundGhostOpacity??item.opacity;
        if(item.userData.undergroundGhostOpacity===undefined)item.userData.undergroundGhostOpacity=opacity;
        undergroundMaterialView(item,surface && !photoPerspective ? mode==='surface'?'inside':'surface' : view,opacity,!!item.userData.undergroundTranslucent);
      }
    });
  }, -1);
  return <group ref={group}>{children}</group>;
}

function GarageEntrance({ feature, mode, photoPerspective }: { feature: Feature; mode: UndergroundInspectionMode; photoPerspective: boolean }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => garageRampGeometry(feature), [feature]);
  const space = useMemo(() => ({ floor: feature.ramp!.bottomHeight, height: feature.ramp!.topHeight + .3 - feature.ramp!.bottomHeight, footprints: [garageRampFootprint(feature)] }), [feature]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  const model = <group>
    <mesh geometry={geometry.floor}><meshStandardMaterial color={mapColor('#929f9c')} roughness={1} side={THREE.DoubleSide} /></mesh>
    {[geometry.leftWall, geometry.rightWall].map((wall, i) => <mesh key={i} geometry={wall}><meshStandardMaterial color={mapColor('#d7d2c3')} roughness={.95} side={THREE.DoubleSide} /></mesh>)}
    <mesh geometry={geometry.doorway}><meshBasicMaterial color={mapColor('#263832')} side={THREE.DoubleSide} /></mesh>
  </group>;
  return photoPerspective ? model : <UndergroundView space={space} spaces={[space]} mode={mode}>{model}</UndergroundView>;
}

function Segment({ from, to, width, y, thickness, color, ghost = false }: { from: Point; to: Point; width: number; y: number; thickness: number; color: string; ghost?: boolean }) {
  const mapColor = useMapColor();
  const dx = to[0] - from[0], dz = to[1] - from[1];
  return <mesh position={[(from[0] + to[0]) / 2, y, (from[1] + to[1]) / 2]} rotation={[0, Math.atan2(dx, dz), 0]} renderOrder={ghost ? 20 : 0}>
    <boxGeometry args={[width, thickness, Math.hypot(dx, dz)]} />
    <meshStandardMaterial color={mapColor(color)} roughness={.9} transparent={ghost} opacity={ghost ? .25 : 1} depthTest={!ghost} depthWrite={!ghost} />
  </mesh>;
}
function BridgeRails({ chains, smooth = false }: { chains: RailPoint[][]; smooth?: boolean }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => bridgeRailGeometry(chains, smooth), [chains, smooth]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group>
    <mesh geometry={geometry.upper}><meshStandardMaterial color={mapColor('#5c7866')} roughness={.9} /></mesh>
    <mesh geometry={geometry.lower}><meshStandardMaterial color={mapColor('#738979')} roughness={.9} /></mesh>
    <mesh geometry={geometry.posts}><meshStandardMaterial color={mapColor('#5c7866')} roughness={.9} /></mesh>
  </group>;
}
function BridgeNet({ feature, chains }: { feature: Feature; chains: RailPoint[][] }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => bridgeNetGeometry(feature, chains), [feature, chains]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <lineSegments geometry={geometry} raycast={() => null}>
    <lineBasicMaterial color={mapColor('#64716a')} transparent opacity={.65} depthWrite={false} />
  </lineSegments>;
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
    {feature.sideNet && <BridgeNet feature={feature} chains={layout.railChains} />}
    {bridgeSupports(feature, y).map((support, i) => <mesh key={i} position={support.position}><boxGeometry args={support.size} /><meshStandardMaterial color={mapColor('#9b9f8e')} /></mesh>)}
    {layout.stairs.flatMap(stair => stair.flights.map((flight, i) => <BridgeStairs key={stair.id + i} {...flight} width={width} />))}
    {layout.stairs.flatMap(stair => stair.landings.map((landing, i) => <Segment key={stair.id + '-landing-' + i} from={landing.from} to={landing.to} width={width} y={landing.height - BRIDGE_DECK_THICKNESS / 2} thickness={BRIDGE_DECK_THICKNESS} color="#b6b39e" />))}
    {feature.connections?.filter(c => c.buildingId && c.buildingId !== 'local/gymnasium').map(connection => {
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
function Entrance({ feature, underground, mode, photoPerspective, labelPortal, spaces }: { feature: Feature; underground: boolean; mode: UndergroundInspectionMode; photoPerspective: boolean; labelPortal: RefObject<HTMLDivElement>; spaces: UndergroundViewSpace[] }) {
  const mapColor = useMapColor();
  const stair = feature.curvedStair;
  const treads = useMemo(() => stair ? curvedStairTreads(stair).map(tread => ({ ...tread, shape: new THREE.Shape(tread.ring.map(([x, z]) => new THREE.Vector2(x, -z))) })) : [], [stair]);
  const opening = useMemo(() => stair ? new THREE.Shape(curvedStairTreads({ ...stair, steps: 1 })[0].ring.map(([x, z]) => new THREE.Vector2(x, -z))) : null, [stair]);
  const canopy = useMemo(() => stair ? new THREE.Shape(curvedStairTreads({ ...stair, sweep: stair.sweep * .7, steps: 1 })[0].ring.map(([x, z]) => new THREE.Vector2(x, -z))) : null, [stair]);
  const rails = useMemo(() => stair ? [-1, 1].map(side => Array.from({ length: stair.steps + 1 }, (_, i) => curvedStairPoint(stair, i / stair.steps, stair.radius + side * (stair.width / 2 - .12)))) : [], [stair]);
  const viewSpace = useMemo(() => stair ? {floor:stair.bottomHeight,height:stair.topHeight + 2.35 - stair.bottomHeight,footprints:[{outer:curvedStairTreads({...stair,steps:1})[0].ring,holes:[]},...spaces.flatMap(space=>space.footprints)]} : null,[stair,spaces]);
  if (!stair || !opening) return null;
  const top = curvedStairPoint(stair, 0);
  const markerSize = feature.width || 3.2;
  const surfaceRails = rails.map(chain => chain.filter(point => point[1] >= -.1));
  const belowRails = rails.map(chain => {
    const below = chain.findIndex(point => point[1] < -.1);
    return below < 0 ? [] : chain.slice(Math.max(0, below - 1));
  }).filter(chain => chain.length > 1);
  const steps = <>
    {!photoPerspective && <BridgeRails chains={belowRails} smooth />}
    <mesh userData={{undergroundPlanOnly:true}} rotation={[-Math.PI / 2, 0, 0]} position={[0, .14, 0]}><shapeGeometry args={[opening]} /><meshStandardMaterial color={mapColor('#6b8174')} transparent opacity={.12} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    {treads.map((tread, i) => <group key={i}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, tread.height - .16, 0]} renderOrder={25}><extrudeGeometry args={[tread.shape, { depth: .16, bevelEnabled: false }]} /><meshStandardMaterial color={mapColor(i % 2 ? '#b2ae95' : '#c8c2a8')} roughness={1} transparent opacity={.25} depthTest={false} depthWrite={false} /></mesh>
      <Line points={tread.ring.map(([x, z]) => [x, tread.height + .01, z])} color={mapColor('#667867')} lineWidth={.7} transparent opacity={.5} depthTest={false} depthWrite={false} renderOrder={26} />
    </group>)}
    <mesh position={[top[0], .04, top[2]]} rotation={[0, Math.atan2(-Math.sin(stair.startAngle) * stair.sweep, Math.cos(stair.startAngle) * stair.sweep), 0]} renderOrder={25}><boxGeometry args={[stair.width, .16, 1.4]} /><meshStandardMaterial color={mapColor('#b7b69e')} transparent opacity={.25} depthTest={false} depthWrite={false} /></mesh>
  </>;
  const below = viewSpace && <UndergroundView space={viewSpace} spaces={spaces} mode={mode} photoPerspective={photoPerspective}>{steps}</UndergroundView>;
  return <group>
    <MapModelLayer underground={mode === 'underground' && !photoPerspective}>
    {canopy && <mesh position={[0, stair.topHeight + 2.35, 0]} rotation={[-Math.PI / 2, 0, 0]}><shapeGeometry args={[canopy]} /><meshStandardMaterial color={mapColor('#a6c4c1')} transparent opacity={.32} depthWrite={false} side={THREE.DoubleSide} /></mesh>}
    {[0, .23, .46, .7].map(progress => {
      const a = curvedStairPoint(stair, progress, stair.radius - stair.width / 2), b = curvedStairPoint(stair, progress, stair.radius + stair.width / 2), roof = stair.topHeight + 2.35;
      return <group key={progress}><Segment from={[a[0], a[2]]} to={[b[0], b[2]]} width={.12} y={roof} thickness={.12} color="#788d87" />
        {[a, b].map((p, i) => <mesh key={i} position={[p[0], (roof + p[1]) / 2, p[2]]}><boxGeometry args={[.13, roof - p[1], .13]} /><meshStandardMaterial color={mapColor('#788d87')} roughness={.75} /></mesh>)}
      </group>;
    })}
    <BridgeRails chains={photoPerspective && underground ? rails : surfaceRails} smooth />
    </MapModelLayer>
    {underground && below ? below : <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .14, 0]}><shapeGeometry args={[opening]} /><meshStandardMaterial color={mapColor('#6b8174')} transparent opacity={.48} depthWrite={false} side={THREE.DoubleSide} /></mesh>}
    {!feature.hideLabel && feature.name && <LocationHtml portal={labelPortal} position={[top[0], top[1] + markerSize + 1.5, top[2]]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name} underground /></LocationHtml>}
  </group>;
}
const NO_CONNECTIONS: Feature[] = [];
const NO_OPENINGS: PassageOpening[] = [];
function UndergroundDetails({ feature, footprint, openings }: { feature: Feature; footprint: Shape; openings: PassageOpening[] }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => undergroundDetailGeometry(feature, [footprint], openings), [feature, footprint, openings]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  return <group>{Object.entries(geometry).map(([kind, part]) => <mesh key={kind} userData={{undergroundCeiling:kind === 'ceiling' || kind === 'skylights',undergroundSurface:kind==='podium'||kind==='skylights'}} geometry={part} renderOrder={kind === 'floor' || kind === 'green' ? 23 : 25}>
    <meshStandardMaterial color={mapColor(UNDERGROUND_COLORS[kind as keyof typeof UNDERGROUND_COLORS])} roughness={kind === 'floor' || kind === 'green' ? .48 : .85}
      emissive={kind === 'lights' ? mapColor('#ede2be') : '#000000'} emissiveIntensity={kind === 'lights' ? .25 : 0}
      userData={{undergroundGhostOpacity:kind === 'glass' || kind === 'skylights' ? .28 : kind === 'nets' ? .38 : kind === 'ceiling' ? .22 : .75,undergroundTranslucent:kind==='glass'||kind==='skylights'||kind==='nets'}}
      transparent opacity={kind === 'glass' || kind === 'skylights' ? .28 : kind === 'nets' ? .38 : kind === 'ceiling' ? .22 : .75} depthTest={false} depthWrite={false} side={THREE.DoubleSide} />
  </mesh>)}</group>;
}
function UndergroundArea({ feature, connections = NO_CONNECTIONS, footprints, openings = NO_OPENINGS, labelPortal, spaces, mode, photoPerspective }: { feature: Feature; connections?: Feature[]; footprints?: Shape[]; openings?: PassageOpening[]; labelPortal: RefObject<HTMLDivElement>; spaces: UndergroundViewSpace[]; mode: UndergroundInspectionMode; photoPerspective: boolean }) {
  const mapColor = useMapColor();
  const floor = feature.height ?? -3, wallHeight = feature.wallHeight || 2.4;
  const corridor = feature.type === 'undergroundCorridor' || feature.type === 'tunnelJunction', tunnel = feature.type === 'tunnel';
  const color = tunnel ? '#d8c6a7' : corridor ? '#bad0c3' : '#bdcedf';
  const lineColor = tunnel ? '#ad9879' : corridor ? '#8faa99' : '#91a7bf';
  const shapes = useMemo(() => (footprints || undergroundFootprints(feature, connections)).map(footprint => {
    const shape = new THREE.Shape(footprint.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    shape.holes = footprint.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    return { footprint, shape, volume: undergroundVolume(footprint, wallHeight, openings, true), boundaries: undergroundBoundaryLines(footprint, openings) };
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
    {shapes.map(({ footprint, shape, volume, boundaries }, n) => {
      const model = <UndergroundView space={{floor,height:wallHeight,footprints:[footprint]}} spaces={spaces} mode={mode} photoPerspective={photoPerspective}>
      <mesh geometry={volume} userData={{undergroundPlanVolume:true}} position={[0, floor, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={22}><meshStandardMaterial color={mapColor(color)} userData={{undergroundGhostOpacity:.1}} side={THREE.DoubleSide} transparent opacity={.1} depthTest={false} depthWrite={false} /></mesh>
      <mesh userData={{undergroundPlanOnly:true}} position={[0, floor + .04, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={23}><shapeGeometry args={[shape]} /><meshBasicMaterial color={mapColor(color)} userData={{undergroundGhostOpacity:.24}} side={THREE.DoubleSide} transparent opacity={.24} depthTest={false} depthWrite={false} /></mesh>
      <group userData={{undergroundPlanOnly:true}}>{boundaries.map((ring, i) => <Line key={i} points={ring.map(([x, z]) => [x, floor + .08, z])} color={mapColor(lineColor)} lineWidth={1.2} transparent opacity={.7} dashed dashSize={2} gapSize={1} depthTest={false} depthWrite={false} renderOrder={24} />)}</group>
      <UndergroundDetails feature={feature} footprint={footprint} openings={openings} />
      </UndergroundView>;
      return <group key={n}>{model}</group>;
    })}
    {(mode === 'underground' || photoPerspective) && [feature, ...connections].filter(item => !item.hideLabel && item.name?.trim()).map(item => <LocationHtml key={item.id} portal={labelPortal} position={labelPosition(item)} center zIndexRange={[5, 1]}><LocationName id={item.id} name={item.name!} underground /></LocationHtml>)}
  </group>;
}
export default memo(function CampusStructures({ features, buildings, overrides, underground, labelPortal, mode = 'surface', photoPerspective = false }: { features: Feature[]; buildings: Building[]; overrides: Record<string, BuildingOverride>; underground: boolean; labelPortal: RefObject<HTMLDivElement>; mode?: UndergroundInspectionMode; photoPerspective?: boolean }) {
  const layout = useMemo(() => undergroundLayout(features), [features]);
  const spaces=useMemo(()=>[...layout.areas.values()].map(area=>({floor:area.feature.height??-3,height:area.feature.wallHeight||2.4,footprints:area.footprints})),[layout]);
  return <>{features.map(feature => {
    const surface = (children: ReactNode) => <MapModelLayer key={feature.id} underground={mode === 'underground' && !photoPerspective}>{children}</MapModelLayer>;
    if (feature.type === 'mottoStone' && feature.stone) return surface(<MottoStone feature={feature} />);
    if (feature.type === 'flagPlatform' && feature.flagPlatform) return surface(<FlagPlatform feature={feature} />);
    if (['boardwalk', 'lakePavilion', 'pergola'].includes(feature.type)) return surface(<LakeGarden feature={feature} features={features} connectedBuilding={buildings.find(building => feature.connectedTo?.includes(building.id))} labelPortal={labelPortal} />);
    if (feature.type === 'landmark' && feature.statue) return surface(<BajinStatue feature={feature} />);
    if (feature.type === 'landmark' && feature.landmark) return surface(<GateLandmark feature={feature} labelPortal={labelPortal} />);
    if (['undergroundRoom', 'undergroundCorridor', 'tunnel', 'tunnelJunction', 'undergroundTrack'].includes(feature.type)) {
      const area = layout.areas.get(feature.id);
      return underground && area ? <UndergroundArea key={feature.id} {...area} labelPortal={labelPortal} spaces={spaces} mode={mode} photoPerspective={photoPerspective} /> : null;
    }
    if (!feature.points || feature.points.length < 2) return null;
    if (feature.type === 'garageEntrance' && feature.ramp && feature.points.length === 2) return <GarageEntrance key={feature.id} feature={feature} mode={mode} photoPerspective={photoPerspective} />;
    if (feature.type === 'bridge') return surface(<Bridge feature={feature} buildings={buildings} overrides={overrides} labelPortal={labelPortal} />);
    if (feature.type === 'tunnelEntrance') return <Entrance key={feature.id} feature={feature} underground={underground} labelPortal={labelPortal} spaces={spaces} mode={mode} photoPerspective={photoPerspective} />;
    return null;
  })}</>;
});

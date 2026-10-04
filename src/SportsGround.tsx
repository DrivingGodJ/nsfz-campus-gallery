import { useMapColor } from './MapTheme';
import { Line } from '@react-three/drei';
import { useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import type { Feature, Point, Shape } from './types';
import { stadiumRing, stadiumSurfaces } from './structure-geometry';
import { LocationHtml, LocationName } from './LocationSelection';

const SURFACE_HEIGHT = .16;
const LINE_HEIGHT = .23;
const lineDepth = { renderOrder: 2, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };

function Ground({ data, color }: { data: Shape; color: string }) {
  const mapColor = useMapColor();
  const shape = useMemo(() => {
    const result = new THREE.Shape(data.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
    result.holes = data.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
    return result;
  }, [data]);
  return <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, SURFACE_HEIGHT, 0]} renderOrder={1}><shapeGeometry args={[shape]} /><meshStandardMaterial color={mapColor(color)} roughness={1} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} /></mesh>;
}
function FieldLine({ points }: { points: Point[] }) {
  const mapColor = useMapColor();
  return <Line points={points.map(([x, z]) => [x, LINE_HEIGHT, z])} color={mapColor('#edf0da')} lineWidth={1.2} {...lineDepth} />;
}
export default function SportsGround({ feature, labelPortal }: { feature: Feature; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const track = feature.track!;
  const surfaces = useMemo(() => stadiumSurfaces(track), [track]);
  const halfLength = track.pitchLength / 2, halfWidth = track.pitchWidth / 2;
  const yaw = Math.atan2(track.axis[0], track.axis[1]);
  return <group position={[track.center[0], 0, track.center[1]]} rotation={[0, yaw, 0]}>
    <Ground data={surfaces.track} color="#ae6652" />
    <Ground data={surfaces.grass} color="#83a575" />
    {surfaces.stripes.map((stripe, i) => <Ground key={i} data={stripe} color={i % 2 ? '#759967' : '#7ea270'} />)}
    {Array.from({ length: track.lanes + 1 }, (_, i) => <Line key={i} points={stadiumRing(track.halfStraight, track.innerRadius + i * track.laneWidth).map(([x, z]) => [x, LINE_HEIGHT, z])} color={mapColor('#f1deca')} lineWidth={.9} {...lineDepth} />)}
    <FieldLine points={[[track.innerRadius, -track.halfStraight], [track.innerRadius + track.lanes * track.laneWidth, -track.halfStraight]]} />
    <FieldLine points={[[-halfWidth, -halfLength], [halfWidth, -halfLength], [halfWidth, halfLength], [-halfWidth, halfLength], [-halfWidth, -halfLength]]} />
    <FieldLine points={[[-halfWidth, 0], [halfWidth, 0]]} />
    <FieldLine points={Array.from({ length: 65 }, (_, i) => [Math.cos(i * Math.PI / 32) * 7.5, Math.sin(i * Math.PI / 32) * 7.5] as Point)} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, LINE_HEIGHT, 0]} renderOrder={2}><circleGeometry args={[.35, 12]} /><meshBasicMaterial color={mapColor('#edf0da')} depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} /></mesh>
    {[-1, 1].map(sign => <group key={sign}>
      {[{ depth: 12, width: 31 }, { depth: 5, width: 18 }].map(box => <FieldLine key={box.depth} points={[[-box.width / 2, sign * halfLength], [-box.width / 2, sign * (halfLength - box.depth)], [box.width / 2, sign * (halfLength - box.depth)], [box.width / 2, sign * halfLength]]} />)}
      <Line points={[[-3, .2, sign * halfLength], [-3, 2, sign * halfLength], [3, 2, sign * halfLength], [3, .2, sign * halfLength]]} color={mapColor('#edf0da')} lineWidth={2} />
      <Line points={[[-3, LINE_HEIGHT, sign * halfLength], [-3, LINE_HEIGHT, sign * (halfLength + 1.8)], [3, LINE_HEIGHT, sign * (halfLength + 1.8)], [3, LINE_HEIGHT, sign * halfLength]]} color={mapColor('#c4d3b7')} lineWidth={1} {...lineDepth} />
    </group>)}
    <LocationHtml portal={labelPortal} position={[0, 4, 0]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name!} /></LocationHtml>
  </group>;
}

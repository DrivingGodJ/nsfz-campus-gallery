import { useMapColor } from './MapTheme';
import { useMemo, type RefObject } from 'react';
import * as THREE from 'three';
import type { Feature } from './types';
import { LocationHtml, LocationName } from './LocationSelection';

export function Trees({ trees }: { trees: Feature['trees'] }) {
  const mapColor = useMapColor();
  return <>{trees?.map((tree, i) => {
    const canopyHeight = tree.height - 1.6;
    return <group key={i} position={[tree.position[0], .12, tree.position[1]]}>
      <mesh position={[0, tree.height * .24, 0]} raycast={() => null}><cylinderGeometry args={[.17, .23, tree.height * .48, 5]} /><meshStandardMaterial color={mapColor('#93806a')} roughness={1} /></mesh>
      <mesh position={[0, 1.6 + canopyHeight / 2, 0]} scale={[tree.radius, canopyHeight / 2, tree.radius]} rotation={[0, i * .7, 0]} raycast={() => null}><icosahedronGeometry args={[1, 0]} /><meshStandardMaterial color={mapColor(['#798e65', '#84966d', '#718b66'][i % 3])} roughness={1} flatShading /></mesh>
    </group>;
  })}</>;
}

export default function Forest({ feature, labelPortal }: { feature: Feature; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const shape = useMemo(() => new THREE.Shape(feature.outer!.map(([x, z]) => new THREE.Vector2(x, -z))), [feature]);
  const corners = feature.outer!.slice(0, -1);
  const center = corners.reduce((sum, point) => [sum[0] + point[0] / corners.length, sum[1] + point[1] / corners.length], [0, 0]);
  return <group>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .075, 0]} raycast={() => null}>
      <shapeGeometry args={[shape]} /><meshStandardMaterial color={mapColor('#b4c29e')} roughness={1} side={THREE.DoubleSide} />
    </mesh>
    <Trees trees={feature.trees} />
    <LocationHtml portal={labelPortal} position={[center[0], 9, center[1]]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name!} /></LocationHtml>
  </group>;
}

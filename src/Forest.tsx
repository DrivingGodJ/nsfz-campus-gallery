import { useMapColor } from './MapTheme';
import { memo, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import type { Feature } from './types';
import { LocationHtml, LocationName } from './LocationSelection';

export const Trees = memo(function Trees({ trees }: { trees: Feature['trees'] }) {
  const mapColor = useMapColor();
  const trunks = useRef<THREE.InstancedMesh>(null), crowns = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!trunks.current || !crowns.current) return;
    const transform = new THREE.Object3D(), color = new THREE.Color();
    trees?.forEach((tree, i) => {
      const canopyHeight = tree.height - 1.6;
      transform.position.set(tree.position[0], .12 + tree.height * .24, tree.position[1]);
      transform.rotation.set(0, 0, 0); transform.scale.set(1, tree.height * .48, 1);
      transform.updateMatrix(); trunks.current!.setMatrixAt(i, transform.matrix);
      transform.position.y = .12 + 1.6 + canopyHeight / 2;
      transform.rotation.y = i * .7; transform.scale.set(tree.radius, canopyHeight / 2, tree.radius);
      transform.updateMatrix(); crowns.current!.setMatrixAt(i, transform.matrix);
      crowns.current!.setColorAt(i, color.set(mapColor(['#798e65', '#84966d', '#718b66'][i % 3])));
    });
    for (const mesh of [trunks.current, crowns.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [trees, mapColor]);
  if (!trees?.length) return null;
  return <>
    <instancedMesh key={'trunks/' + trees.length} ref={trunks} args={[undefined, undefined, trees.length]} raycast={() => null}>
      <cylinderGeometry args={[.17, .23, 1, 5]} /><meshStandardMaterial color={mapColor('#93806a')} roughness={1} />
    </instancedMesh>
    <instancedMesh key={'crowns/' + trees.length} ref={crowns} args={[undefined, undefined, trees.length]} raycast={() => null}>
      <icosahedronGeometry args={[1, 0]} /><meshStandardMaterial roughness={1} flatShading />
    </instancedMesh>
  </>;
});

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

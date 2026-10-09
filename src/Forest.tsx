import { MapTheme, MapTime, useMapColor } from './MapTheme';
import { memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import type { Feature } from './types';
import { LocationHtml, LocationName } from './LocationSelection';
import { treeInstances, treeTrunkGeometry } from './tree-geometry';
import { specimenGroveGeometry, specimenTrees } from './specimen-grove';

export const Trees = memo(function Trees({ trees }: { trees: Feature['trees'] }) {
  const mapColor = useMapColor();
  const trunks = useRef<THREE.InstancedMesh>(null), bases = useRef<THREE.InstancedMesh>(null), crowns = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(treeTrunkGeometry, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useLayoutEffect(() => {
    if (!trunks.current || !bases.current || !crowns.current) return;
    const color = new THREE.Color();
    trees?.forEach((tree, i) => {
      const instances = treeInstances(tree);
      trunks.current!.setMatrixAt(i, instances.trunk); bases.current!.setMatrixAt(i, instances.base);
      instances.crowns.forEach((matrix, j) => {
        crowns.current!.setMatrixAt(i * 3 + j, matrix);
        crowns.current!.setColorAt(i * 3 + j, color.set(mapColor(['#798e65', '#84966d', '#718b66'][(i + j) % 3])));
      });
    });
    for (const mesh of [trunks.current, bases.current, crowns.current]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [trees, mapColor]);
  if (!trees?.length) return null;
  return <>
    <instancedMesh key={'trunks/' + trees.length} ref={trunks} args={[undefined, undefined, trees.length]} raycast={() => null}>
      <primitive object={geometry} attach="geometry" /><meshStandardMaterial color={mapColor('#93806a')} roughness={1} />
    </instancedMesh>
    <instancedMesh key={'bases/' + trees.length} ref={bases} args={[undefined, undefined, trees.length]} raycast={() => null}>
      <cylinderGeometry args={[.98, 1, 1, 6]} /><meshStandardMaterial color={mapColor('#e9e4d4')} roughness={1} />
    </instancedMesh>
    <instancedMesh key={'crowns/' + trees.length} ref={crowns} args={[undefined, undefined, trees.length * 3]} raycast={() => null}>
      <icosahedronGeometry args={[1, 1]} /><meshStandardMaterial roughness={1} />
    </instancedMesh>
  </>;
});

function SpecimenDetails({ feature }: { feature: Feature }) {
  const mapColor = useMapColor(), time = useContext(MapTime), theme = useContext(MapTheme);
  const geometry = useMemo(() => specimenGroveGeometry(feature), [feature]);
  useEffect(() => () => Object.values(geometry).forEach(part => part.dispose()), [geometry]);
  const lit = time === 'night' || time === 'dusk' || (!time && theme === 'dark');
  const colors = { paths: '#b4a286', edging: '#d7d2c3', stone: '#b7b09a', metal: '#796e56', fitness: '#507b66', lattice: '#ad6e45', plants: '#718b66', lamps: '#e3d4a2' };
  return <group>{(Object.keys(colors) as (keyof typeof colors)[]).map(key => <mesh key={key} geometry={geometry[key]} raycast={() => null}>
    <meshStandardMaterial color={mapColor(colors[key])} roughness={.95} side={THREE.DoubleSide}
      emissive={key === 'lamps' && lit ? '#eab45d' : '#000000'} emissiveIntensity={key === 'lamps' && lit ? .85 : 0} />
  </mesh>)}</group>;
}

export default function Forest({ feature, labelPortal }: { feature: Feature; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const specimen = feature.id === 'local/specimen-forest';
  const trees = useMemo(() => specimen ? specimenTrees(feature) : feature.trees, [feature, specimen]);
  const shape = useMemo(() => new THREE.Shape(feature.outer!.map(([x, z]) => new THREE.Vector2(x, -z))), [feature]);
  const corners = feature.outer!.slice(0, -1);
  const center = corners.reduce((sum, point) => [sum[0] + point[0] / corners.length, sum[1] + point[1] / corners.length], [0, 0]);
  return <group>
    <mesh userData={{ photoOpacityOccluder: true }} rotation={[-Math.PI / 2, 0, 0]} position={[0, .075, 0]} raycast={() => null}>
      <shapeGeometry args={[shape]} /><meshStandardMaterial color={mapColor('#b4c29e')} roughness={1} side={THREE.DoubleSide} />
    </mesh>
    <Trees trees={trees} />
    {specimen && <SpecimenDetails feature={feature} />}
    <LocationHtml portal={labelPortal} position={[center[0], 9, center[1]]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name!} /></LocationHtml>
  </group>;
}

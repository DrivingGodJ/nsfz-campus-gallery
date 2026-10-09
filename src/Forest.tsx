import { MapTheme, MapTime, useMapColor } from './MapTheme';
import { memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import type { Feature } from './types';
import { LocationHtml, LocationName } from './LocationSelection';
import { palmCrownGeometry, treeInstances, treeTrunkGeometry } from './tree-geometry';
import { specimenGroveGeometry, specimenTrees } from './specimen-grove';

function TreeBatch({ trees, columnar = false, palm = false, openCanopy = false }: { trees: Feature['trees']; columnar?: boolean; palm?: boolean; openCanopy?: boolean }) {
  const mapColor = useMapColor();
  const trunks = useRef<THREE.InstancedMesh>(null), bases = useRef<THREE.InstancedMesh>(null), crowns = useRef<THREE.InstancedMesh>(null), branches = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => treeTrunkGeometry(columnar), [columnar]);
  const crownGeometry = useMemo(() => palm ? palmCrownGeometry() : new THREE.IcosahedronGeometry(1,1), [palm]);
  useEffect(() => () => { geometry.dispose(); crownGeometry.dispose(); }, [geometry, crownGeometry]);
  useLayoutEffect(() => {
    if (!trunks.current || !bases.current || !crowns.current) return;
    const color = new THREE.Color();
    trees?.forEach((tree, i) => {
      const instances = treeInstances(tree, openCanopy);
      trunks.current!.setMatrixAt(i, instances.trunk); bases.current!.setMatrixAt(i, instances.base);
      instances.branches.forEach((matrix, j) => branches.current?.setMatrixAt(i * 6 + j, matrix));
      instances.crowns.forEach((matrix, j) => {
        crowns.current!.setMatrixAt(i * 3 + j, matrix);
        crowns.current!.setColorAt(i * 3 + j, color.set(mapColor(['#798e65', '#84966d', '#718b66'][(i + j) % 3])));
      });
    });
    for (const mesh of [trunks.current, bases.current, crowns.current, branches.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }, [trees, mapColor, openCanopy]);
  if (!trees?.length) return null;
  return <>
    <instancedMesh key={'trunks/' + trees.length} ref={trunks} args={[undefined, undefined, trees.length]} raycast={() => null}>
      <primitive object={geometry} attach="geometry" /><meshStandardMaterial color={mapColor('#93806a')} roughness={1} />
    </instancedMesh>
    <instancedMesh key={'bases/' + trees.length} ref={bases} args={[undefined, undefined, trees.length]} raycast={() => null}>
      <cylinderGeometry args={[.98, 1, 1, 6]} /><meshStandardMaterial color={mapColor(palm ? '#93806a' : '#e9e4d4')} roughness={1} />
    </instancedMesh>
    {!columnar && <instancedMesh key={'branches/' + trees.length} ref={branches} args={[undefined, undefined, trees.length * 6]} raycast={() => null}>
      <cylinderGeometry args={[.4, 1, 1, 5, 1, false]} /><meshStandardMaterial color={mapColor('#93806a')} roughness={1} />
    </instancedMesh>}
    <instancedMesh key={'crowns/' + trees.length} ref={crowns} args={[undefined, undefined, trees.length * 3]} raycast={() => null}>
      <primitive object={crownGeometry} attach="geometry" /><meshStandardMaterial roughness={1} side={THREE.DoubleSide} />
    </instancedMesh>
  </>;
}

export const Trees = memo(function Trees({ trees, openCanopy = false }: { trees: Feature['trees']; openCanopy?: boolean }) {
  const groups = useMemo(() => ({ plane: trees?.filter(tree => !tree.kind || tree.kind === 'plane'), columnar: trees?.filter(tree => tree.kind === 'columnar'), palm: trees?.filter(tree => tree.kind === 'palm') }), [trees]);
  return <><TreeBatch trees={groups.plane} openCanopy={openCanopy} /><TreeBatch trees={groups.columnar} columnar /><TreeBatch trees={groups.palm} columnar palm /></>;
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
    <Trees trees={trees} openCanopy={specimen} />
    {specimen && <SpecimenDetails feature={feature} />}
    <LocationHtml portal={labelPortal} position={[center[0], 9, center[1]]} center zIndexRange={[5, 1]}><LocationName id={feature.id} name={feature.name!} /></LocationHtml>
  </group>;
}

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapColor } from './MapTheme';
import { ARCHITECTURE_COLORS, GYM_ID, architectureBatch, classroomGlazingGeometry, gymArchitecture, teachingElevatorGeometry, teachingRailGeometry, teachingWindowGeometry } from './architecture-geometry';
import { teachingStairGeometry } from './teaching-stairs';
import { laboratoryLayout, laboratoryWindows } from './laboratory-geometry';
import { cafeteriaLowerProfile, cafeteriaUpperWindows, dormitoryProfile } from './facade-geometry';
import { TEACHING_ID, teachingDetailGeometry } from './teaching-details';
import { teachingClassroomFurniture } from './teaching-classroom-furniture';
import type { Building, BuildingPart } from './types';

type Section = BuildingPart & { height: number; floors: number };
export default function BuildingArchitecture({ building, sections, floorHeight, cutawayHeight, gym }: {
  building: Building; sections: Section[]; floorHeight: number; cutawayHeight?: number;
  gym?: ReturnType<typeof gymArchitecture>;
}) {
  const mapColor = useMapColor();
  const structure = useMemo(() => {
    if (building.facade?.type !== 'laboratory') return building;
    const layout = laboratoryLayout(building);
    return { ...building, floorCorridors: layout.corridors, stairwells: [layout.stair] };
  }, [building]);
  const rails = useMemo(() => teachingRailGeometry(structure, sections, floorHeight, cutawayHeight), [structure, sections, floorHeight, cutawayHeight]);
  const stairs = useMemo(() => teachingStairGeometry(structure, sections, floorHeight, cutawayHeight), [structure, sections, floorHeight, cutawayHeight]);
  const windows = useMemo(() => {
    const visibleHeight = Math.min(Math.max(...sections.map(section => section.height)), cutawayHeight ?? Infinity);
    if (building.facade?.type === 'laboratory') return classroomGlazingGeometry(laboratoryWindows(building, visibleHeight, floorHeight), building.classroomWindows);
    if (building.facade?.type === 'dormitory') {
      const shape = dormitoryProfile(building).shape;
      return teachingWindowGeometry({ ...building, ...shape }, sections.map(section => ({ ...section, ...shape })), floorHeight, cutawayHeight);
    }
    if (building.facade?.type === 'cafeteria' && building.classroomWindows) {
      const boundary = Math.min(visibleHeight, 2 * floorHeight), shape = cafeteriaLowerProfile(building).shape;
      const config = { ...building.classroomWindows, bayWidth: 2.5, windowWidth: 2.35, sill: .2, top: floorHeight - .35, columns: 1 };
      const lower = teachingWindowGeometry({ ...building, ...shape, classroomWindows: config }, [{ ...sections[0], ...shape, height: boundary }], floorHeight);
      const upper = classroomGlazingGeometry(cafeteriaUpperWindows(building, Math.max(0, visibleHeight - boundary), floorHeight), building.classroomWindows);
      for (const geometry of Object.values(upper)) geometry.translate(0, boundary, 0);
      return { glass: architectureBatch([lower.glass, upper.glass], false), frames: architectureBatch([lower.frames, upper.frames], false) };
    }
    return teachingWindowGeometry(building, sections, floorHeight, cutawayHeight);
  }, [building, sections, floorHeight, cutawayHeight]);
  const elevator = useMemo(() => teachingElevatorGeometry(building, sections, floorHeight, cutawayHeight), [building, sections, floorHeight, cutawayHeight]);
  const teaching = useMemo(() => building.id === TEACHING_ID ? teachingDetailGeometry(building, sections, floorHeight, cutawayHeight) : undefined, [building, sections, floorHeight, cutawayHeight]);
  const furniture = useMemo(() => building.id === TEACHING_ID ? teachingClassroomFurniture(building, sections, floorHeight, cutawayHeight) : undefined, [building, sections, floorHeight, cutawayHeight]);
  useEffect(() => () => rails.dispose(), [rails]);
  useEffect(() => () => Object.values(stairs).forEach(geometry => geometry.dispose()), [stairs]);
  useEffect(() => () => Object.values(windows).forEach(geometry => geometry.dispose()), [windows]);
  useEffect(() => () => Object.values(elevator).forEach(geometry => geometry.dispose()), [elevator]);
  useEffect(() => () => { if (teaching) Object.values(teaching).forEach(geometry => geometry.dispose()); }, [teaching]);
  useEffect(() => () => { if (furniture) Object.values(furniture).forEach(geometry => geometry.dispose()); }, [furniture]);
  const detail = useRef<THREE.Group>(null), railMaterial = useRef<THREE.MeshStandardMaterial>(null), frameMaterial = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(({ camera }) => {
    const distance = Math.hypot(camera.position.x - building.center[0], camera.position.y, camera.position.z - building.center[1]);
    const opacity = THREE.MathUtils.clamp((430 - distance) / 180, 0, 1);
    if (detail.current) detail.current.visible = opacity > 0;
    if (railMaterial.current) railMaterial.current.opacity = opacity;
    if (frameMaterial.current) frameMaterial.current.opacity = opacity;
  });
  // The roof remains visible at campus scale; only small rail details fade away.
  return <group>
    {teaching && <>
      <mesh geometry={teaching.columns} raycast={() => null}><meshStandardMaterial color={mapColor('#c5c9be')} roughness={.95} /></mesh>
      <mesh geometry={teaching.paving} raycast={() => null}><meshStandardMaterial color={mapColor('#bda995')} roughness={1} /></mesh>
      <mesh geometry={teaching.inlay} raycast={() => null}><meshStandardMaterial color={mapColor('#92a7a4')} roughness={1} /></mesh>
    </>}
    <mesh geometry={windows.glass} raycast={() => null}><meshStandardMaterial color={mapColor('#a4bfbd')} roughness={.35} transparent opacity={.16} depthWrite={false} side={THREE.DoubleSide} forceSinglePass /></mesh>
    <mesh geometry={elevator.glass} raycast={() => null}><meshStandardMaterial color={mapColor('#a4bfbd')} roughness={.35} transparent opacity={.16} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={elevator.doors} raycast={() => null}><meshStandardMaterial color={mapColor(ARCHITECTURE_COLORS.glass)} roughness={.35} transparent opacity={.3} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={stairs.concrete}><meshStandardMaterial color={mapColor('#d7d2c3')} roughness={.95} /></mesh>
    {gym && building.id === GYM_ID && <>
      <mesh geometry={gym.roof}><meshStandardMaterial color={mapColor(ARCHITECTURE_COLORS.roof)} roughness={.9} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={gym.stairs}><meshStandardMaterial color={mapColor('#d7d2c3')} roughness={.95} /></mesh>
      <mesh geometry={gym.court}><meshStandardMaterial color={mapColor('#c2a47a')} roughness={.95} /></mesh>
      <lineSegments geometry={gym.courtLines} raycast={() => null}><lineBasicMaterial color={mapColor('#f4efe2')} /></lineSegments>
      <mesh geometry={gym.glass} raycast={() => null}><meshStandardMaterial color={mapColor(ARCHITECTURE_COLORS.glass)} roughness={.6} transparent opacity={.24} depthWrite={false} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={gym.stairGlass} raycast={() => null}><meshStandardMaterial color={mapColor(ARCHITECTURE_COLORS.glass)} roughness={.6} transparent opacity={.18} depthWrite={false} side={THREE.DoubleSide} /></mesh>
    </>}
    <group ref={detail}>
      {furniture && <>
        <mesh geometry={furniture.wood} raycast={() => null}><meshStandardMaterial color={mapColor('#baa477')} roughness={.9} /></mesh>
        <mesh geometry={furniture.metal} raycast={() => null}><meshStandardMaterial color={mapColor('#626a65')} roughness={.8} /></mesh>
        <mesh geometry={furniture.boards} raycast={() => null}><meshStandardMaterial color={mapColor('#305b4b')} roughness={1} /></mesh>
        <mesh geometry={furniture.storage} raycast={() => null}><meshStandardMaterial color={mapColor('#c8d3bf')} roughness={.95} /></mesh>
      </>}
      {teaching && <>
        <mesh geometry={teaching.rails} raycast={() => null}><meshStandardMaterial color={mapColor('#5e99ac')} roughness={.85} /></mesh>
        <mesh geometry={teaching.units} raycast={() => null}><meshStandardMaterial color={mapColor('#d2d6cc')} roughness={.85} /></mesh>
        <mesh geometry={teaching.vents} raycast={() => null}><meshStandardMaterial color={mapColor('#89968c')} roughness={.85} /></mesh>
      </>}
      <mesh geometry={windows.frames} raycast={() => null}><meshStandardMaterial color={mapColor('#d2d6cc')} roughness={.8} side={THREE.DoubleSide} /></mesh>
      <mesh geometry={elevator.frames} raycast={() => null}><meshStandardMaterial color={mapColor(ARCHITECTURE_COLORS.frame)} roughness={.5} metalness={.2} /></mesh>
      <mesh geometry={stairs.rails} raycast={() => null}><meshStandardMaterial color={mapColor('#5e99ac')} roughness={.85} /></mesh>
      {gym && <mesh geometry={gym.stairRails} raycast={() => null}><meshStandardMaterial color={mapColor('#879690')} roughness={.65} /></mesh>}
      {gym && <mesh geometry={gym.frame}><meshStandardMaterial ref={frameMaterial} color={mapColor(ARCHITECTURE_COLORS.frame)} roughness={.9} transparent depthWrite /></mesh>}
      <mesh geometry={rails} raycast={() => null}>
      <meshStandardMaterial ref={railMaterial} color={mapColor(ARCHITECTURE_COLORS.rail)} roughness={.9} transparent depthWrite />
    </mesh></group>
  </group>;
}

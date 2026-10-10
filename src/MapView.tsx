import { MapSeason, MapTheme, MapTime, useSystemTheme, useMapColor } from './MapTheme';
import { Component, Suspense, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Edges, Html, Line } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { ArrowDown, ArrowUp, Crosshair } from 'lucide-react';
import { buildingInfo, type Campus, type Feature, type Photo, type Point, type Shape, type Site } from './types';
import CampusStructures from './CampusStructures';
import MapModelLayer from './MapModelLayer';
import MapLevelSwitch, { type MapLevelMode } from './MapLevelSwitch';
import { isUndergroundFeature, isUndergroundPhoto } from './map-level-mode';
import SportsGround from './SportsGround';
import Forest, { Trees } from './Forest';
import RiverLandscape from './RiverLandscape';
import BoundaryWaterGarden from './BoundaryWaterGarden';
import HistoryPavilion from './HistoryPavilion';
import BoundaryHouse from './BoundaryHouse';
import PrintRoom from './PrintRoom';
import LuxunMemorial from './LuxunMemorial';
import BuildingFacade from './BuildingFacade';
import BuildingSkylights from './BuildingSkylights';
import BuildingArchitecture from './BuildingArchitecture';
import VenueDetails from './VenueDetails';
import StandOfficeDetails from './StandOfficeDetails';
import CampusExteriorDetails from './CampusExteriorDetails';
import PhotoFacadeDetails from './PhotoFacadeDetails';
import PhotoInteriorDetails from './PhotoInteriorDetails';
import { PHOTO_INTERIOR_IDS } from './photo-interior-geometry';
import { OFFICE_ID, LIBRARY_ID } from './campus-exterior-geometry';
import { officeWindowLayout } from './office-windows';
import { STANDS_ID, THEATRE_ID, standsArchitecture } from './venue-geometry';
import { STAND_OFFICE_ID, standOfficeOpenings } from './stand-office-geometry';
import { GYM_ID, gymArchitecture } from './architecture-geometry';
import { buildingGeometry } from './building-geometry';
import { cafeteriaBodyGeometry, dormitoryBodyGeometry } from './facade-geometry';
import { laboratoryBodyGeometry } from './laboratory-geometry';
import { buildingFloorLineGeometry } from './building-floor-lines';
import { photoMapSeason, type PhotoSeason } from './photo-season';
import BasketballCourts from './BasketballCourts';
import { FeatureTargets, LocationHtml, LocationName, LocationSelection } from './LocationSelection';
import { directionVector, photoFieldOfView, viewSectorRays } from './photo-view';
import { groundSurfaces } from './ground-geometry';
import { roadFootprint } from './road-geometry';
import { isAerialPhoto, photoCameraHeightRange, photoLocationId, photoMapHeight } from './locations';
import { mapLocationTarget } from './location-geometry';
import { photoPlacementPoint } from './photo-placement';
import PhotoMarkers from './PhotoMarkers';
import { photoMarkerColors } from './photo-marker-colors';
import PhotoClusterPicker from './PhotoClusterPicker';
import { photoPointPosition, type PhotoCluster } from './photo-clusters';
import MapCameraRig, { OVERVIEW_POSITION, type MapCommand, type MapPhoto } from './MapCameraRig';
import { photoPerspectiveIssue } from './photo-perspective';
import PhotoOverlay from './PhotoOverlay';
import type { PhotoOverlayMode } from './photo-overlay';
import type { PhotoViewAdjustment } from './photo-look-controls';
import type { PhotoTime } from './photo-time';
import SkyEnvironment from './SkyEnvironment';
import { photoSkyTime, skyTime } from './sky-environment';
import { mapInteractionHelp, useInputMode } from './input-mode';
import { FULL_MAP_VIEWPORT, type MapViewport } from './map-card-viewport';
import type { PhotoLikes } from './photo-sort';

type Props = {
  campus: Campus; site: Site; photos: Photo[]; selectedPhoto?: Photo | null; onSelectPhoto?: (photo: Photo) => void;
  onVisiblePhotos?: (ids: string[]) => void;
  photoLikes?: PhotoLikes;
  selectedLocation?: string; floor?: number; onLocation?: (id: string) => void; onClearLocation?: () => void; featuresSelectable?: boolean; selectableLocationIds?: string[];
  season?: PhotoSeason | '';
  time?: PhotoTime | '';
  placing?: boolean; onPlace?: (point: { x: number; z: number }) => void; editPhoto?: Photo | null; onHeading?: (heading: number) => void;
  photoPreview?: boolean; photoPerspective?: boolean; photoViewDisabled?: boolean; onExitPhotoPerspective?: () => void; onPhotoOrientation?: (orientation: PhotoViewAdjustment) => void; photoImageSource?: string; photoDepthSource?: string;
  smoothPhotoFraming?: boolean;
  photoOverlayMode?: PhotoOverlayMode; onPhotoOverlayEntered?: () => void; onPhotoOverlayExited?: () => void;
  visibleViewport?: MapViewport;
};
function makeShape(data: Shape) {
  const shape = new THREE.Shape(data.outer.map(([x, z]) => new THREE.Vector2(x, -z)));
  shape.holes = data.holes.map(ring => new THREE.Path(ring.map(([x, z]) => new THREE.Vector2(x, -z))));
  return shape;
}
function Surface({ data, color, height = .06, stableDepth = false, unlit = false }: { data: Shape; color: string; height?: number; stableDepth?: boolean; unlit?: boolean }) {
  const mapColor = useMapColor();
  const shape = useMemo(() => makeShape(data), [data]);
  return <mesh userData={{ photoOpacityOccluder: true }} rotation={[-Math.PI / 2, 0, 0]} position={[0, height, 0]} renderOrder={stableDepth ? 1 : 0}><shapeGeometry args={[shape]} />{unlit ? <meshBasicMaterial color={mapColor(color)} toneMapped={false} /> : <meshStandardMaterial color={mapColor(color)} side={THREE.DoubleSide} roughness={1} polygonOffset={stableDepth} polygonOffsetFactor={-1} polygonOffsetUnits={-1} />}</mesh>;
}
const BuildingMesh = memo(function BuildingMesh({ building, site, index, selected, floor, onClick, placing, labelPortal, bridge }: { building: Campus['buildings'][number]; site: Site; index: number; selected: boolean; floor?: number; onClick?: (id: string) => void; placing?: boolean; labelPortal: RefObject<HTMLDivElement>; bridge?: Campus['features'][number] }) {
  const mapColor = useMapColor();
  const [hover, setHover] = useState(false);
  const info = useMemo(() => buildingInfo(building, site, index), [building, site.buildingOverrides[building.id], index]);
  const cutawayHeight = selected && floor ? floor * info.floorHeight : undefined;
  const gym = useMemo(() => building.id === GYM_ID ? gymArchitecture(building, info.height, info.floorHeight, bridge, cutawayHeight) : undefined, [building, info.height, info.floorHeight, bridge, cutawayHeight]);
  useEffect(() => () => { if (gym) for (const geometry of Object.values(gym)) geometry.dispose(); }, [gym]);
  const stands = useMemo(() => building.id === STANDS_ID ? standsArchitecture(building, info.height, info.floorHeight, cutawayHeight) : undefined, [building, info.height, info.floorHeight, cutawayHeight]);
  useEffect(() => () => { if (stands) Object.values(stands).forEach(geometry => geometry.dispose()); }, [stands]);
  const geometries = useMemo(() => building.facade?.type === 'boundary-house' || building.facade?.type === 'print-room' || building.facade?.type === 'luxun-memorial' ? [] : info.sections.map(section => {
    const height = Math.min(section.height, cutawayHeight ?? section.height);
    const cutaway = cutawayHeight !== undefined && cutawayHeight <= section.height + 1e-6;
    if (gym) return gym.body;
    if (stands) return stands.body;
    if (building.facade?.type === 'laboratory') return laboratoryBodyGeometry(building, height, info.floorHeight, cutaway);
    if (building.facade?.type === 'cafeteria') return cafeteriaBodyGeometry(building, height, info.floorHeight, cutaway);
    if (building.facade?.type === 'dormitory') return dormitoryBodyGeometry(building, height, info.floorHeight, cutaway);
    return buildingGeometry(section, height, info.floorHeight, building.groundPassages,
      building.floorCorridors?.filter(corridor => corridor.partId === section.id),
      building.stairwells?.filter(stair => stair.partId === section.id), building.classroomWindows,
      building.solidCores?.filter(core => core.partId === section.id),
      building.cutouts?.filter(cut => cut.partId === section.id), cutaway,
      building.id === OFFICE_ID ? officeWindowLayout(building, height, info.floorHeight) : building.id === STAND_OFFICE_ID ? standOfficeOpenings(building, height, info.floorHeight) : undefined);
  }), [building, info, cutawayHeight, gym, stands]);
  useEffect(() => () => { if (!gym && !stands) geometries.forEach(geometry => geometry.dispose()); }, [geometries, gym, stands]);
  const height = selected && floor ? Math.min(info.height, floor * info.floorHeight) : info.height;
  const color = selected ? '#93aa98' : hover ? '#c2c4af' : '#d7d2c3';
  const floorLines = useMemo(() => buildingFloorLineGeometry(building, info.sections, info.floorHeight, selected ? floor : undefined), [building, info, selected, floor]);
  useEffect(() => () => floorLines.dispose(), [floorLines]);
  const floorLineMaterial = useRef<THREE.LineBasicMaterial>(null);
  useFrame(({ camera }) => {
    // Subpixel floor lines should fade before they turn into a striped, flickering far view.
    const distance = Math.hypot(camera.position.x - info.center[0], camera.position.y - info.baseElevation - height / 2, camera.position.z - info.center[1]);
    if (floorLineMaterial.current) floorLineMaterial.current.opacity = THREE.MathUtils.clamp((800 - distance) / 500, 0, 1);
  });
  return <group position={[0, info.baseElevation, 0]} userData={{ photoOccluder: true, buildingId: building.id }}>
    {building.appearance?.type === 'glass-pavilion' ? <group onClick={e => { if (!placing && e.delta < 5) { e.stopPropagation(); onClick?.(building.id); } }} onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
      <HistoryPavilion building={building} height={height} color={color} selected={selected} cutaway={cutawayHeight !== undefined && cutawayHeight <= info.height + 1e-6} />
    </group> : <group
      onClick={e => { if (!placing && e.delta < 5) { e.stopPropagation(); onClick?.(building.id); } }}
      onPointerOver={() => setHover(true)} onPointerOut={() => setHover(false)}>
    {building.facade?.type === 'boundary-house' ? <BoundaryHouse building={building} height={height} cutaway={cutawayHeight !== undefined} /> : building.facade?.type === 'print-room' ? <PrintRoom building={building} height={height} cutaway={cutawayHeight !== undefined} /> : building.facade?.type === 'luxun-memorial' ? <LuxunMemorial building={building} height={info.height} floorHeight={info.floorHeight} cutawayHeight={cutawayHeight} /> : info.sections.map((section, i) => <group key={section.id}><mesh geometry={geometries[i]} rotation={[-Math.PI / 2, 0, 0]} position={[0, .12, 0]}>
      <meshStandardMaterial color={mapColor(color)} roughness={.95} transparent={!!(selected && floor)} opacity={selected && floor ? .62 : 1} />
      {building.facade?.type !== 'cafeteria' && <Edges color={mapColor(selected ? '#567760' : '#aaa895')} threshold={25} />}
    </mesh>
    </group>)}
    <lineSegments geometry={floorLines} renderOrder={2} raycast={() => null}><lineBasicMaterial ref={floorLineMaterial} color={mapColor(selected ? '#698673' : '#b3b1a4')} transparent depthWrite={false} toneMapped={false} /></lineSegments>
    {!!building.skylights?.length && <BuildingSkylights building={building} sections={info.sections} cutawayHeight={selected && floor ? floor * info.floorHeight : undefined} />}
    {(building.facade?.type === 'laboratory' || building.floorCorridors?.length || building.stairwells?.length || building.classroomWindows || gym) && <BuildingArchitecture building={building} sections={info.sections} floorHeight={info.floorHeight} cutawayHeight={cutawayHeight} gym={gym} />}
    {(stands || gym || building.id === THEATRE_ID) && <VenueDetails building={building} height={info.height} floorHeight={info.floorHeight} cutawayHeight={cutawayHeight} stands={stands} />}
    {building.id === STAND_OFFICE_ID && <StandOfficeDetails building={building} height={info.height} floorHeight={info.floorHeight} cutawayHeight={cutawayHeight} />}
    {(building.id === OFFICE_ID || building.id === LIBRARY_ID) && <CampusExteriorDetails building={building} floors={info.floors} floorHeight={info.floorHeight} cutawayHeight={cutawayHeight} annexFloors={info.sections.find(section => section.id === 'curved-annex')?.floors} />}
    {(building.classroomWindows || building.id === 'way/855459420') && <PhotoFacadeDetails building={building} sections={info.sections} floorHeight={info.floorHeight} cutawayHeight={cutawayHeight} />}
    {PHOTO_INTERIOR_IDS.includes(building.id) && <PhotoInteriorDetails building={building} height={info.height} floorHeight={info.floorHeight} cutawayHeight={cutawayHeight} />}
    {building.facade?.type === 'dormitory' && <BuildingFacade building={building} floors={info.floors} floorHeight={info.floorHeight} height={height} selected={selected} cutaway={!!(selected && floor)} />}
    </group>}
    {(selected || !!building.name || !!site.buildingOverrides[building.id]?.name) && <LocationHtml portal={labelPortal} key={info.name} position={[info.center[0], height + 3, info.center[1]]} center zIndexRange={[5, 1]}><LocationName id={building.id} name={info.name} building /></LocationHtml>}
  </group>;
});
function Roads({ feature }: { feature: Feature }) {
  const mapColor = useMapColor();
  const geometry = useMemo(() => buildingGeometry(roadFootprint(feature), .04, 3.6), [feature]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh userData={{ photoOpacityOccluder: true }} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, .075, 0]}><meshStandardMaterial color={mapColor('#e9e4d4')} roughness={1} /></mesh>;
}
function Direction({ photo, editing = false, compact = false, onHeading, labelPortal }: { photo: MapPhoto; editing?: boolean; compact?: boolean; onHeading?: (heading: number) => void; labelPortal: RefObject<HTMLDivElement> }) {
  const mapColor = useMapColor();
  const colors = photoMarkerColors(photo);
  const color = editing && !isAerialPhoto(photo) ? '#b8723d' : colors.direction;
  const { camera, gl, controls } = useThree();
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  const arrow = useMemo(() => {
    const vector = new THREE.Vector3(...directionVector(photo.heading, photo.pitch));
    return new THREE.ArrowHelper(vector, new THREE.Vector3(photo.position.x, photo.position.height + .4, photo.position.z), compact ? 5 : 22, color, compact ? 1.5 : 3, compact ? .8 : 1.5);
  }, [photo.heading, photo.pitch, photo.position.x, photo.position.z, photo.position.height, color, compact]);
  useEffect(() => () => { arrow.dispose(); }, [arrow]);
  useEffect(() => { arrow.setColor(mapColor(color)); }, [arrow, color, mapColor]);
  const view = photoFieldOfView(photo);
  const rays = useMemo(() => !compact && view ? viewSectorRays(photo.heading, photo.pitch, view.horizontal) : [], [photo.heading, photo.pitch, view?.horizontal, compact]);
  const sector = useMemo(() => {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), ...rays.map(p => new THREE.Vector3(...p))]);
    geometry.setIndex(rays.slice(1).flatMap((_, i) => [0, i + 1, i + 2]));
    return geometry;
  }, [rays]);
  useEffect(() => () => sector.dispose(), [sector]);
  const yaw = photo.heading * Math.PI / 180;
  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!onHeading) return;
    event.preventDefault(); event.stopPropagation();
    cleanup.current?.();
    const orbit = controls as OrbitControlsImpl | undefined;
    if (orbit) orbit.enabled = false;
    const ray = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -photo.position.height);
    const move = (e: PointerEvent) => {
      const bounds = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2((e.clientX - bounds.left) / bounds.width * 2 - 1, -(e.clientY - bounds.top) / bounds.height * 2 + 1), camera);
      const target = new THREE.Vector3();
      if (ray.ray.intersectPlane(plane, target)) onHeading(Math.round((Math.atan2(target.x - photo.position.x, -(target.z - photo.position.z)) * 180 / Math.PI + 360) % 360));
    };
    const end = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', end); document.removeEventListener('pointercancel', end); if (orbit) orbit.enabled = true; cleanup.current = null; };
    cleanup.current = end;
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', end); document.addEventListener('pointercancel', end);
  };
  const origin: [number, number, number] = [photo.position.x, photo.position.height + .4, photo.position.z];
  return <group><primitive object={arrow} />{editing && <Html portal={labelPortal} position={photoPointPosition(photo)} center zIndexRange={[19, 19]} style={{ pointerEvents: 'none' }}><span aria-hidden="true" className="map-photo-point selected" style={{ backgroundColor: mapColor(colors.point) }} /></Html>}
    {rays.length > 0 && <><mesh geometry={sector} position={origin} renderOrder={28} raycast={() => null}><meshBasicMaterial color={mapColor(color)} transparent opacity={.17} side={THREE.DoubleSide} depthTest={false} depthWrite={false} /></mesh><Line points={[origin, ...rays.map(p => p.map((n, i) => n + origin[i]) as [number, number, number]), origin]} color={mapColor(color)} lineWidth={1.5} depthTest={false} depthWrite={false} renderOrder={29} raycast={() => null} /></>}
    {editing && onHeading && <Html portal={labelPortal} center position={[photo.position.x + Math.sin(yaw) * 22, photo.position.height + 2, photo.position.z - Math.cos(yaw) * 22]} zIndexRange={[20, 19]}><button className="direction-handle" aria-label="拖动调整拍摄方向" title="拖动调整拍摄方向" onPointerDown={beginDrag} onKeyDown={e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); onHeading((photo.heading + (e.key === 'ArrowRight' ? 5 : 355)) % 360); } }}>↔</button></Html>}
  </group>;
}
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="map-fallback"><strong>这台设备暂时无法显示 3D 地图</strong><p>你仍可以从照片目录查看大图和下载。</p></div> : this.props.children; }
}
export default function MapView(props: Props) {
  const viewport = props.visibleViewport || FULL_MAP_VIEWPORT;
  const theme = useSystemTheme();
  const inputMode = useInputMode();
  const { campus, site, floor, placing, onPlace } = props;
  const [selectionDismissed, setSelectionDismissed] = useState(false);
  useEffect(() => setSelectionDismissed(false), [props.selectedLocation, floor, props.selectedPhoto?.id, props.editPhoto?.id]);
  const selectedLocation = selectionDismissed ? undefined : props.selectedLocation;
  const selectableIds = useMemo(() => props.selectableLocationIds ? new Set(props.selectableLocationIds) : undefined, [props.selectableLocationIds]);
  const locationCallback = useRef(props.onLocation);
  useLayoutEffect(() => { locationCallback.current = props.onLocation; }, [props.onLocation]);
  const chooseLocation = useCallback((id: string) => { if (selectableIds && !selectableIds.has(id)) return; setSelectionDismissed(false); locationCallback.current?.(id); }, [selectableIds]);
  const onLocation = props.onLocation ? chooseLocation : undefined;
  const atMapHeight = (photo: Photo): MapPhoto => {
    const height = photoMapHeight(photo, campus, site);
    const onStairs = !isAerialPhoto(photo) && campus.features.some(feature => feature.id === photoLocationId(photo, campus) && feature.type === 'tunnelEntrance' && feature.curvedStair);
    return { ...photo, locationId: photoLocationId(photo, campus), position: { ...photo.position, height }, pointHeight: onStairs ? photoMapHeight({ ...photo, cameraHeight: .1 }, campus, site) - .1 + .08 : undefined };
  };
  const photos = useMemo(() => props.photos.map(atMapHeight), [props.photos, campus, site]);
  const selectedPhoto = props.selectedPhoto ? atMapHeight(props.selectedPhoto) : null;
  const editPhoto = props.editPhoto ? atMapHeight(props.editPhoto) : null;
  const cameraHeightRange = props.editPhoto ? photoCameraHeightRange(props.editPhoto, campus, site) : null;
  const cameraHeight = props.editPhoto && cameraHeightRange ? THREE.MathUtils.clamp(props.editPhoto.cameraHeight ?? 1.6, cameraHeightRange.min, cameraHeightRange.max) : 1.6;
  const floorBase = editPhoto ? editPhoto.position.height - cameraHeight : 0;
  const photoHeightRange = editPhoto && cameraHeightRange ? isAerialPhoto(editPhoto)
    ? editPhoto.altitude?.reference === 'takeoff' ? { min: -12000, max: 100000 } : undefined
    : { min: floorBase + cameraHeightRange.min, max: floorBase + cameraHeightRange.max } : undefined;
  const adjustPhotoView = (adjustment: PhotoViewAdjustment) => {
    if (!props.editPhoto || !adjustment.position) { props.onPhotoOrientation?.(adjustment); return; }
    const { x, z, height } = adjustment.position;
    const update: PhotoViewAdjustment = { heading: adjustment.heading, pitch: adjustment.pitch, position: { ...props.editPhoto.position, x, z } };
    if (height !== undefined && cameraHeightRange) {
      if (isAerialPhoto(props.editPhoto)) update.altitude = { meters: height, reference: 'takeoff' };
      else update.cameraHeight = THREE.MathUtils.clamp(height - floorBase, cameraHeightRange.min, cameraHeightRange.max);
    }
    props.onPhotoOrientation?.(update);
  };
  // Display heights are derived; callbacks always return the original persisted record.
  const selectPhoto = (photo: Photo) => props.onSelectPhoto?.(props.photos.find(item => item.id === photo.id) || photo);
  const [command, setCommand] = useState<MapCommand>({ type: 'initial', sequence: 0 });
  const [compact, setCompact] = useState(false);
  const [azimuth, setAzimuth] = useState(0);
  const [levelMode, setLevelMode] = useState<MapLevelMode>('surface');
  const undergroundFloor = Math.min(-3.8, ...campus.features.filter(isUndergroundFeature).map(feature => feature.height ?? -3.8));
  const entranceSelected = campus.features.some(feature => feature.id === props.selectedLocation && feature.type === 'tunnelEntrance');
  useEffect(() => {
    const photo = props.editPhoto || props.selectedPhoto;
    const id = photo ? photoLocationId(photo, campus) : props.selectedLocation;
    const feature = campus.features.find(item => item.id === id);
    if (!id) return;
    if (photo ? isUndergroundPhoto(photo, campus, site) : isUndergroundFeature(feature)) setLevelMode('underground');
    else if (photo || props.selectedLocation) setLevelMode('surface');
  }, [props.editPhoto?.id, props.selectedPhoto?.id, props.selectedLocation, campus]);
  const [moving, setMoving] = useState(false);
  const [picker, setPicker] = useState<PhotoCluster | null>(null);
  const pickerTrigger = useRef<HTMLButtonElement | null>(null);
  const closePicker = useCallback(() => { setPicker(null); if (pickerTrigger.current?.isConnected) pickerTrigger.current.focus({ preventScroll: true }); }, []);
  const pickCluster = (cluster: PhotoCluster, trigger: HTMLButtonElement) => { pickerTrigger.current = trigger; setPicker(cluster); };
  const expandCluster = (focus: { target: [number, number, number]; distance: number }) => { setPicker(null); setCommand(c => ({ type: 'cluster', ...focus, sequence: c.sequence + 1 })); };
  const photoIds = props.photos.map(photo => photo.id).join(',');
  useEffect(() => setPicker(null), [photoIds, props.selectedPhoto?.id, props.editPhoto?.id, props.photoPerspective]);
  const candidate = editPhoto || selectedPhoto;
  const preview = props.photoPerspective && !placing && candidate && !photoPerspectiveIssue(candidate) ? candidate : null;
  const skyPhoto = editPhoto ? props.photoPreview || preview ? editPhoto : null : selectedPhoto;
  const environmentTime = photoSkyTime(props.time || '', skyPhoto);
  const environmentSeason = photoMapSeason(props.season || '', skyPhoto);
  // A photo temporarily overrides the whole scene appearance, without changing
  // the directory filters. Closing it restores the user's season and time.
  const mapColor = useMapColor(theme, environmentSeason, environmentTime);
  const viewingPhoto = !!preview || moving;
  const undergroundView = levelMode === 'underground' && !viewingPhoto && !props.photoPreview;
  const sceneMode: MapLevelMode = undergroundView ? 'underground' : 'surface';
  const mapPhotos = useMemo(() => photos.filter(photo => isUndergroundPhoto(photo, campus, site) === undergroundView), [photos, campus, site, undergroundView]);
  const focusPhoto = selectedPhoto && (viewingPhoto || !!props.photoPreview || isUndergroundPhoto(selectedPhoto, campus, site) === undergroundView) ? selectedPhoto : null;
  const locationSelection = useMemo(() => ({ selectedId: selectedLocation, onSelect: viewingPhoto ? undefined : onLocation, placing, featuresSelectable: props.featuresSelectable, selectableIds }), [selectedLocation, viewingPhoto, onLocation, placing, props.featuresSelectable, selectableIds]);
  // Selection cuts above its floor; preview restores the building throughout the camera transition.
  const cutawayFloor = props.photoPreview || viewingPhoto ? undefined : floor;
  const selectedObject = useMemo(() => mapLocationTarget(campus, site, selectedLocation, cutawayFloor), [campus, site, selectedLocation, cutawayFloor]);
  const focusObject = viewingPhoto || props.photoPreview || isUndergroundFeature(campus.features.find(feature => feature.id === selectedLocation)) === undergroundView ? selectedObject : null;
  const labelPortal = useRef<HTMLDivElement>(null!);
  useEffect(() => {
    if (!props.photoPerspective) return;
    if (!preview) { props.onExitPhotoPerspective?.(); return; }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) props.onExitPhotoPerspective?.(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [props.photoPerspective, !!preview, props.onExitPhotoPerspective]);
  const ground = useMemo(() => groundSurfaces(campus), [campus]);
  const run = (type: string) => { setPicker(null); setCommand(c => ({ type, sequence: c.sequence + 1 })); };
  const clearLocation = () => {
    if (placing || viewingPhoto || (!selectedLocation && !selectedPhoto)) return;
    // Dismissing the map highlight must not erase an editor photo's association or a building draft.
    setSelectionDismissed(true);
    props.onClearLocation?.();
  };
  const clickBackground = (e: ThreeEvent<MouseEvent>) => {
    if (viewingPhoto || e.delta >= 5) return;
    if (!placing) { if (selectedLocation || selectedPhoto) { e.stopPropagation(); clearLocation(); } return; }
    if (!onPlace) return;
    e.stopPropagation();
    const point = photoPlacementPoint(e.ray, props.editPhoto || null, campus, site);
    if (point) onPlace(point);
  };
  return <div ref={labelPortal} className={'map-stage' + (placing ? ' placing' : '') + (viewingPhoto ? ' photo-perspective' : '')} data-level-mode={sceneMode} data-season={environmentSeason || 'all'} data-time={environmentTime || 'all'} data-sky-time={skyTime(theme, environmentTime)} data-input={inputMode} style={{ background: mapColor('#eeeee5'), '--map-free-left': viewport.left * 100 + '%', '--map-free-right': (1 - viewport.left - viewport.width) * 100 + '%', '--map-free-top': viewport.top * 100 + '%', '--map-free-bottom': (1 - viewport.top - viewport.height) * 100 + '%' } as CSSProperties} aria-label="察哈尔路校区三维地图">
    <MapTheme.Provider value={theme}><MapSeason.Provider value={environmentSeason}><MapTime.Provider value={environmentTime}><CanvasBoundary><Canvas camera={{ position: OVERVIEW_POSITION, fov: 43, near: .5, far: 4000 }} dpr={[1, 1.75]} frameloop="demand" gl={{ antialias: true, logarithmicDepthBuffer: true }} onPointerMissed={event => { if (event.type === 'click' && event.button === 0) clearLocation(); }} fallback={<div className="map-fallback">3D 地图不可用，请使用照片目录浏览。</div>}>
      <color attach="background" args={[mapColor('#eeeee5')]} />
      <SkyEnvironment underground={undergroundView} theme={theme} season={environmentSeason} time={environmentTime} />
      <LocationSelection.Provider value={locationSelection}><Suspense fallback={null}><group onClick={clickBackground}>
        {ground.background.map((shape, i) => <Surface key={'background/' + i} data={shape} color="#eeeee5" height={(undergroundView ? undergroundFloor : 0) - .08} unlit />)}
        <MapModelLayer underground={undergroundView}>
        {ground.campus.map((shape, i) => <Surface key={'campus/' + i} data={shape} color="#cfd5bd" height={.02} />)}
        {campus.features.map(feature => feature.waterfall ? <BoundaryWaterGarden key={feature.id} feature={feature} /> : feature.type === 'basketballCourts' && feature.courts ? <BasketballCourts key={feature.id} feature={feature} labelPortal={labelPortal} /> : feature.type === 'forest' && feature.outer ? <Forest key={feature.id} feature={feature} labelPortal={labelPortal} /> : feature.type === 'trees' ? <Trees key={feature.id} trees={feature.trees} /> : feature.type === 'runningTrack' && feature.track ? <SportsGround key={feature.id} feature={feature} features={campus.features} labelPortal={labelPortal} /> : feature.type === 'path' && (feature.outer || feature.points) && !feature.representedBy ? <Roads key={feature.id} feature={feature} /> : ground.features.has(feature.id) ? ground.features.get(feature.id)!.map((shape, i) => <Surface key={feature.id + '/' + i} data={shape} color={feature.type === 'water' ? '#b5cbc7' : feature.type === 'sport' ? '#b2c29f' : feature.type === 'plaza' ? '#ddd8c9' : '#bdc9ac'} stableDepth={feature.type === 'water'} />) : null)}
        <Line points={campus.boundary.map(([x, z]) => [x, .2, z])} color={mapColor('#97a188')} lineWidth={1.5} />
        {campus.buildings.map((b, i) => <BuildingMesh key={b.id} building={b} site={site} index={i} selected={b.id === selectedLocation} floor={b.id === selectedLocation ? cutawayFloor : undefined} placing={placing} onClick={viewingPhoto ? undefined : onLocation} labelPortal={labelPortal} bridge={b.id === GYM_ID ? campus.features.find(feature => feature.id === 'local/footbridge') : undefined} />)}
        <RiverLandscape features={campus.features} buildings={campus.buildings} />
        </MapModelLayer>
        <CampusStructures features={campus.features} buildings={campus.buildings} overrides={site.buildingOverrides} underground mode={sceneMode} photoPerspective={viewingPhoto || !!props.photoPreview} labelPortal={labelPortal} />
        <MapModelLayer underground={undergroundView}><FeatureTargets campus={campus} site={site} underground={false} labelPortal={labelPortal} /></MapModelLayer>
        {undergroundView && <FeatureTargets campus={{ ...campus, features: campus.features.filter(isUndergroundFeature) }} site={site} underground labelPortal={labelPortal} />}
        {!viewingPhoto && <PhotoMarkers occlusionRevision={[selectedLocation, cutawayFloor, sceneMode].join(':')} photos={mapPhotos} photoLikes={props.photoLikes} selected={selectedPhoto} onSelect={selectPhoto} onPick={pickCluster} onExpand={expandCluster} compact={compact} labelPortal={labelPortal} onVisiblePhotos={props.onVisiblePhotos} visibleViewport={viewport} direction={photo => <Direction photo={photo} compact labelPortal={labelPortal} />} />}
        {!viewingPhoto && focusPhoto && !editPhoto && <Direction photo={focusPhoto} labelPortal={labelPortal} />}
        {!viewingPhoto && editPhoto?.placed && <Direction photo={editPhoto} editing onHeading={props.onHeading} labelPortal={labelPortal} />}
      </group><MapCameraRig groundHeight={levelMode === 'underground' ? undergroundFloor : 0} command={command} selectedObjectTarget={focusObject?.target} selectedObjectBounds={focusObject?.bounds} selected={focusPhoto} preview={preview} visibleViewport={props.visibleViewport} canAdjustPhotoView={!!editPhoto && !props.photoViewDisabled} photoHeightRange={photoHeightRange} smoothPhotoFraming={props.smoothPhotoFraming} onMoving={setMoving} onCompact={setCompact} onAzimuth={setAzimuth} onPhotoOrientation={adjustPhotoView} onSelectionOutOfView={!placing && !editPhoto && !viewingPhoto && props.onClearLocation ? clearLocation : undefined} /></Suspense></LocationSelection.Provider>
    </Canvas></CanvasBoundary></MapTime.Provider></MapSeason.Provider></MapTheme.Provider>
    {!viewingPhoto && <div className="map-tools"><button className="icon-button" onClick={() => run('in')} aria-label="沿视线前进" title="沿视线前进"><ArrowUp size={18} /></button><button className="icon-button" onClick={() => run('out')} aria-label="沿视线后退" title="沿视线后退"><ArrowDown size={18} /></button><span /><button className="icon-button" onClick={() => run('reset')} aria-label="回到校园全景" title="校园全景"><Crosshair size={18} /></button></div>}
    {!viewingPhoto && !props.photoPreview && <MapLevelSwitch mode={levelMode} onChange={mode => { setPicker(null); setLevelMode(mode); }} />}
    {!viewingPhoto && <div className="map-caption"><span className="north-mark"><svg viewBox="0 0 20 24" width="16" height="19" aria-hidden="true" style={{ transform: 'rotate(' + azimuth + 'deg)' }}><path d="M10 2 17 20 10 16 3 20Z" fill="currentColor" /></svg><b>N</b></span><span>察哈尔路校区<small>建筑高度为示意</small></span></div>}
    {/* The map is isolated below viewer cards; place the chooser alongside them so the catalog cannot cover it. */}
    {labelPortal.current && createPortal(<PhotoClusterPicker photos={!viewingPhoto && picker ? picker.photos : null} photoLikes={props.photoLikes} campus={campus} site={site} onSelect={photo => { setPicker(null); selectPhoto(photo); }} onClose={closePicker} />, labelPortal.current.closest('.viewer-main') || labelPortal.current)}
    {preview && <PhotoOverlay key={preview.id + ':' + (props.photoDepthSource || preview.depthUpdatedAt || '')} photo={preview} viewport={viewport} imageSource={props.photoImageSource} depthSource={props.photoDepthSource} theme={theme} mode={props.photoOverlayMode || 'off'} cameraReady={!moving} onEntered={props.onPhotoOverlayEntered} onExited={props.onPhotoOverlayExited} />}
    {!viewingPhoto && <div className="map-bottom"><span className="map-help">{placing && entranceSelected && editPhoto && !isAerialPhoto(editPhoto) ? '点击入口台阶，标记楼梯上的拍摄位置' : mapInteractionHelp(inputMode, placing ? 'placing' : 'map')}</span><a href={campus.source.licenseUrl} target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div>}
  </div>;
}

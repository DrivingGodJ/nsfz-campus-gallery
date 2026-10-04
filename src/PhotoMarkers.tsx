import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { asset } from './types';
import { useMapColor } from './MapTheme';
import type { MapPhoto } from './MapCameraRig';
import { cameraPhotoClusters, clusterFocus, collagePhotos, permanentPhotoSpots, photoOccluders, PHOTO_MARKER_LIFT, type PhotoCluster } from './photo-clusters';

export default function PhotoMarkers({ photos, selected, compact, labelPortal, onSelect, onPick, onExpand, direction }: {
  photos: MapPhoto[]; selected?: MapPhoto | null; compact: boolean; labelPortal: RefObject<HTMLDivElement>;
  onSelect: (photo: MapPhoto) => void; onPick: (cluster: PhotoCluster, trigger: HTMLButtonElement) => void;
  onExpand: (focus: { target: [number, number, number]; distance: number }) => void;
  direction: (photo: MapPhoto) => ReactNode;
}) {
  const { camera, size, scene } = useThree(), mapColor = useMapColor();
  const spots = useMemo(() => permanentPhotoSpots(photos), [photos]);
  const [clusters, setClusters] = useState<PhotoCluster[]>([]);
  const signature = useRef('');
  useEffect(() => { signature.current = ''; setClusters(cameraPhotoClusters(spots, camera, size, photoOccluders(scene))); }, [spots, scene]);
  useFrame(() => {
    const next = cameraPhotoClusters(spots, camera, size, photoOccluders(scene));
    const key = next.map(cluster => cluster.photos.map(photo => photo.id).join(',')).join('|');
    if (key !== signature.current) { signature.current = key; setClusters(next); }
  });
  // New photo/filter data must not briefly leave old entries clickable.
  const currentIds = new Set(photos.map(photo => photo.id));
  return <>{clusters.filter(cluster => cluster.photos.every(photo => currentIds.has(photo.id))).map(cluster => {
    const photo = cluster.photos.find(photo => photo.id === selected?.id) || cluster.photos[0];
    const active = cluster.photos.some(photo => photo.id === selected?.id), grouped = cluster.photos.length > 1;
    const position = cluster.position;
    return <group key={cluster.id}>
      {!active && !grouped && direction(photo)}
      <Line points={[[position.x, position.y, position.z], [position.x, position.y + PHOTO_MARKER_LIFT, position.z]]} color={mapColor(active ? '#42634c' : '#989b83')} lineWidth={1.5} />
      <mesh position={[position.x, position.y + .4, position.z]}><sphereGeometry args={[.9, 10, 10]} /><meshBasicMaterial color={mapColor('#46634e')} /></mesh>
      <Html portal={labelPortal} position={[position.x, position.y + PHOTO_MARKER_LIFT, position.z]} center zIndexRange={[18, 10]}>
        <button className={'map-photo ' + (grouped ? 'collage ' : '') + (active ? 'selected ' : '') + (compact && !active ? 'compact' : '')}
          data-photo-count={cluster.photos.length} data-spot-count={cluster.spots.length} data-photo-ids={cluster.photos.map(photo => photo.id).join(',')}
          aria-label={grouped ? (cluster.spots.length > 1 ? '靠近查看' : '选择同地点') + '照片，共 ' + cluster.photos.length + ' 张' : '查看照片：' + photo.title}
          aria-haspopup={grouped && cluster.spots.length === 1 ? 'dialog' : undefined}
          onClick={event => {
            event.stopPropagation();
            if (!grouped) { onSelect(photo); return; }
            if (cluster.spots.length === 1 || !(camera instanceof THREE.PerspectiveCamera) || camera.position.distanceTo(position.clone().add(new THREE.Vector3(0, PHOTO_MARKER_LIFT, 0))) < 10) onPick(cluster, event.currentTarget);
            else onExpand(clusterFocus(cluster, camera, size));
          }}>
          {grouped ? <span className={'photo-collage' + (cluster.photos.length < 4 ? ' two-up' : '')}>{collagePhotos(cluster.photos).map(photo => <img key={photo.id} src={asset(photo.files.thumbnail)} alt="" draggable={false} />)}</span> : <img src={asset(photo.files.thumbnail)} alt="" draggable={false} />}
          {grouped && <span className="cluster-count">{cluster.photos.length}</span>}
        </button>
      </Html>
    </group>;
  })}</>;
}

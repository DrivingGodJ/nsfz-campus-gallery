import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { asset } from './types';
import { useMapColor } from './MapTheme';
import type { MapPhoto } from './MapCameraRig';
import { cameraPhotoClusters, clusterFocus, collagePhotos, permanentPhotoSpots, photoOccluders, visiblePhotoPoints, PHOTO_MARKER_LIFT, PHOTO_POINT_LIFT, type PhotoCluster } from './photo-clusters';
import { useAnimatedPresence } from './useAnimatedPresence';
import { useFadingItems } from './useFadingItems';
import { PHOTO_FADE_MS } from './fading-items';

function MarkerFade({ visible, children }: { visible: boolean; children: (shown: boolean) => ReactNode }) {
  const presence = useAnimatedPresence(visible, PHOTO_FADE_MS, true);
  return children(presence.visible && visible);
}

export default function PhotoMarkers({ photos, selected, compact, labelPortal, onSelect, onPick, onExpand, direction }: {
  photos: MapPhoto[]; selected?: MapPhoto | null; compact: boolean; labelPortal: RefObject<HTMLDivElement>;
  onSelect: (photo: MapPhoto) => void; onPick: (cluster: PhotoCluster, trigger: HTMLButtonElement) => void;
  onExpand: (focus: { target: [number, number, number]; distance: number }) => void;
  direction: (photo: MapPhoto) => ReactNode;
}) {
  const { camera, size, scene } = useThree(), mapColor = useMapColor();
  const spots = useMemo(() => permanentPhotoSpots(photos), [photos]);
  const [markers, setMarkers] = useState<{ clusters: PhotoCluster[]; points: MapPhoto[] }>({ clusters: [], points: [] });
  const fadingClusters = useFadingItems(markers.clusters);
  const signature = useRef('');
  const updateMarkers = () => {
    const occluders = photoOccluders(scene);
    const clusters = cameraPhotoClusters(spots, camera, size, occluders, { compact, selectedId: selected?.id });
    const points = visiblePhotoPoints(photos, camera, size, occluders);
    const key = clusters.map(cluster => cluster.photos.map(photo => photo.id).join(',')).join('|') + '/' + points.map(photo => photo.id).join(',');
    if (key !== signature.current) { signature.current = key; setMarkers({ clusters, points }); }
  };
  useEffect(() => { signature.current = ''; updateMarkers(); }, [spots, scene, size.width, size.height, compact, selected?.id]);
  useFrame(updateMarkers);
  // New photo/filter data must not briefly leave old entries clickable.
  const currentIds = new Set(photos.map(photo => photo.id));
  return <>{markers.points.filter(photo => currentIds.has(photo.id)).map(photo => <Html key={'point/' + photo.id} portal={labelPortal}
    position={[photo.position.x, photo.position.height + PHOTO_POINT_LIFT, photo.position.z]} center zIndexRange={[19, 19]} style={{ pointerEvents: 'none' }}>
    <span aria-hidden="true" data-photo-point-id={photo.id} className={'map-photo-point' + (photo.id === selected?.id ? ' selected' : '')} style={{ backgroundColor: mapColor('#46634e') }} />
  </Html>)}{fadingClusters.map(({ item: cluster, expiresAt }) => {
    const photo = cluster.photos.find(photo => photo.id === selected?.id) || cluster.photos[0];
    const active = cluster.photos.some(photo => photo.id === selected?.id), grouped = cluster.photos.length > 1;
    const position = cluster.position;
    const visible = expiresAt === null && cluster.photos.every(photo => currentIds.has(photo.id));
    return <group key={cluster.id}>
      {!active && !grouped && direction(photo)}
      <Line points={[[position.x, position.y, position.z], [position.x, position.y + PHOTO_MARKER_LIFT, position.z]]} color={mapColor(active ? '#42634c' : '#989b83')} lineWidth={1.5} />
      <Html portal={labelPortal} position={[position.x, position.y + PHOTO_MARKER_LIFT, position.z]} center zIndexRange={[18, 10]} style={{ pointerEvents: 'none' }}>
        <MarkerFade visible={visible}>{shown => <button className={'map-photo ' + (grouped ? 'collage ' : '') + (active ? 'selected ' : '') + (compact && !active ? 'compact' : '')}
          style={{ opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none' }} disabled={!visible} aria-hidden={!visible}
          data-photo-count={cluster.photos.length} data-spot-count={cluster.spots.length} data-photo-ids={cluster.photos.map(photo => photo.id).join(',')}
          aria-pressed={active}
          aria-label={grouped ? (cluster.spots.length > 1 ? '靠近查看' : '选择同地点') + '照片，共 ' + cluster.photos.length + ' 张' : '查看照片：' + photo.title}
          aria-haspopup={grouped && cluster.spots.length === 1 ? 'dialog' : undefined}
          onClick={event => {
            event.stopPropagation();
            if (active || !grouped) { onSelect(photo); return; }
            if (cluster.spots.length === 1 || !(camera instanceof THREE.PerspectiveCamera) || camera.position.distanceTo(position.clone().add(new THREE.Vector3(0, PHOTO_MARKER_LIFT, 0))) < 10) onPick(cluster, event.currentTarget);
            else onExpand(clusterFocus(cluster, camera, size));
          }}>
          {grouped ? <span className={'photo-collage' + (cluster.photos.length < 4 ? ' two-up' : '')}>{collagePhotos(cluster.photos).map(photo => <img key={photo.id} src={asset(photo.files.thumbnail)} alt="" draggable={false} />)}</span> : <img src={asset(photo.files.thumbnail)} alt="" draggable={false} />}
          {grouped && <span className="cluster-count">{cluster.photos.length}</span>}
        </button>}</MarkerFade>
      </Html>
    </group>;
  })}</>;
}

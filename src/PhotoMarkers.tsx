import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import { Matrix4 } from 'three';
import { asset } from './types';
import { useMapColor } from './MapTheme';
import type { MapPhoto } from './MapCameraRig';
import { cameraPhotoClusters, clusterFocus, clusterReadyToPick, collagePhotos, permanentPhotoSpots, photoOccluders, visiblePhotoPoints, photoPointPosition, PHOTO_MARKER_LIFT, type PhotoCluster } from './photo-clusters';
import { useAnimatedPresence } from './useAnimatedPresence';
import { useFadingItems } from './useFadingItems';
import { PHOTO_FADE_MS } from './fading-items';
import { isAerialPhoto } from './locations';
import { photoMarkerColors } from './photo-marker-colors';
import { FULL_MAP_VIEWPORT, type MapViewport } from './map-card-viewport';
import type { PhotoLikes } from './photo-sort';
import { photoLikeFrame } from './photo-like-frame';

function MarkerFade({ visible, children }: { visible: boolean; children: (shown: boolean) => ReactNode }) {
  const presence = useAnimatedPresence(visible, PHOTO_FADE_MS, true);
  return children(presence.visible && visible);
}

export default function PhotoMarkers({ photos, selected, compact, labelPortal, onSelect, onPick, onExpand, direction, onVisiblePhotos, visibleViewport = FULL_MAP_VIEWPORT, occlusionRevision, photoLikes }: {
  photos: MapPhoto[]; selected?: MapPhoto | null; compact: boolean; labelPortal: RefObject<HTMLDivElement>;
  onSelect: (photo: MapPhoto) => void; onPick: (cluster: PhotoCluster, trigger: HTMLButtonElement) => void;
  onExpand: (focus: { target: [number, number, number]; distance: number }) => void;
  direction: (photo: MapPhoto) => ReactNode;
  onVisiblePhotos?: (ids: string[]) => void; visibleViewport?: MapViewport;
  occlusionRevision?: string;
  photoLikes?: PhotoLikes;
}) {
  const { camera, size, scene, invalidate } = useThree(), mapColor = useMapColor();
  const spots = useMemo(() => permanentPhotoSpots(photos), [photos]);
  const [markers, setMarkers] = useState<{ clusters: PhotoCluster[]; points: MapPhoto[] }>({ clusters: [], points: [] });
  const fadingClusters = useFadingItems(markers.clusters);
  const signature = useRef('');
  const visibleSignature = useRef('');
  const lastView = useRef({ checked: false, world: new Matrix4(), projection: new Matrix4() });
  const updateMarkers = () => {
    const occluders = photoOccluders(scene);
    const clusters = cameraPhotoClusters(spots, camera, size, occluders, { compact, selectedId: selected?.id });
    const points = visiblePhotoPoints(photos, camera, size, occluders);
    const key = clusters.map(cluster => cluster.photos.map(photo => photo.id).join(',')).join('|') + '/' + points.map(photo => photo.id).join(',');
    if (key !== signature.current) { signature.current = key; setMarkers({ clusters, points }); }
    if (onVisiblePhotos) {
      const visible = clusters.filter(cluster => {
        const p = cluster.position.clone(); p.y += PHOTO_MARKER_LIFT; p.project(camera);
        const x = (p.x + 1) / 2, y = (1 - p.y) / 2;
        return x >= visibleViewport.left && x <= visibleViewport.left + visibleViewport.width && y >= visibleViewport.top && y <= visibleViewport.top + visibleViewport.height;
      }).flatMap(cluster => cluster.photos.map(photo => photo.id)).sort();
      const next = visible.join(',');
      if (next !== visibleSignature.current) { visibleSignature.current = next; onVisiblePhotos(visible); }
    }
  };
  useEffect(() => {
    signature.current = ''; lastView.current.checked = false; invalidate();
  }, [spots, scene, size.width, size.height, compact, selected?.id, occlusionRevision, visibleViewport, onVisiblePhotos, invalidate]);
  useFrame(() => {
    camera.updateMatrixWorld();
    const previous = lastView.current;
    // UI fades and form changes can request a frame without moving the camera.
    // Keep the last visibility result until the view or geometry really changes.
    if (previous.checked && previous.world.equals(camera.matrixWorld) && previous.projection.equals(camera.projectionMatrix)) return;
    updateMarkers();
    previous.checked = true; previous.world.copy(camera.matrixWorld); previous.projection.copy(camera.projectionMatrix);
  });
  useEffect(() => () => onVisiblePhotos?.([]), [onVisiblePhotos]);
  // New photo/filter data must not briefly leave old entries clickable.
  const currentIds = new Set(photos.map(photo => photo.id));
  return <>{markers.points.filter(photo => currentIds.has(photo.id)).map(photo => <Html key={'point/' + photo.id} portal={labelPortal}
    position={photoPointPosition(photo)} center zIndexRange={[19, 19]} style={{ pointerEvents: 'none' }}>
    <span aria-hidden="true" data-photo-point-id={photo.id} className={'map-photo-point' + (photo.id === selected?.id ? ' selected' : '')} style={{ backgroundColor: mapColor(photoMarkerColors(photo).point) }} />
  </Html>)}{fadingClusters.map(({ item: cluster, expiresAt }) => {
    const photo = cluster.photos.find(photo => photo.id === selected?.id) || cluster.photos[0];
    const active = cluster.photos.some(photo => photo.id === selected?.id), grouped = cluster.photos.length > 1;
    const allAerial = cluster.photos.every(isAerialPhoto), mixed = !allAerial && cluster.photos.some(isAerialPhoto);
    const colors = photoMarkerColors(photo);
    const aerialColors = photoMarkerColors(cluster.photos.find(isAerialPhoto) || photo);
    const position = cluster.position;
    const visible = expiresAt === null && cluster.photos.every(photo => currentIds.has(photo.id));
    const likes = Math.max(0, ...cluster.photos.map(photo => photoLikes?.[photo.id]?.count || 0));
    return <group key={cluster.id}>
      {!active && !grouped && direction(photo)}
      <Line points={[[position.x, Math.min(position.y, ...cluster.photos.map(photo => photo.pointHeight ?? photo.position.height)), position.z], [position.x, position.y + PHOTO_MARKER_LIFT, position.z]]} color={mapColor(active ? colors.selected : allAerial ? colors.stem : '#989b83')} lineWidth={1.5} />
      <Html portal={labelPortal} position={[position.x, position.y + PHOTO_MARKER_LIFT, position.z]} center zIndexRange={[18, 10]} style={{ pointerEvents: 'none' }}>
        <MarkerFade visible={visible}>{shown => <button className={'map-photo ' + (grouped ? 'collage ' : '') + (active ? 'selected ' : '') + (allAerial ? 'aerial ' : mixed ? 'mixed ' : '') + (compact && !active ? 'compact' : '')}
          style={{ ...photoLikeFrame(likes), opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none', '--photo-accent': mapColor(aerialColors.border), '--photo-selected': mapColor(colors.selected) } as CSSProperties} disabled={!visible} aria-hidden={!visible}
          data-photo-count={cluster.photos.length} data-spot-count={cluster.spots.length} data-photo-ids={cluster.photos.map(photo => photo.id).join(',')}
          data-photo-capture={allAerial ? 'aerial' : mixed ? 'mixed' : 'ground'}
          aria-pressed={active}
          aria-label={grouped ? (cluster.spots.length > 1 ? '靠近查看' : '选择同地点') + (allAerial ? '航拍照片' : '照片') + '，共 ' + cluster.photos.length + ' 张' : '查看' + (isAerialPhoto(photo) ? '航拍' : '') + '照片：' + photo.title}
          aria-haspopup={grouped && cluster.spots.length === 1 ? 'dialog' : undefined}
          onClick={event => {
            event.stopPropagation();
            if (active || !grouped) { onSelect(photo); return; }
            if (clusterReadyToPick(cluster, camera)) onPick(cluster, event.currentTarget);
            else onExpand(clusterFocus(cluster));
          }}>
          {grouped ? <span className={'photo-collage' + (cluster.photos.length < 4 ? ' two-up' : '')}>{collagePhotos(cluster.photos).map(photo => <img key={photo.id} src={asset(photo.files.thumbnail)} alt="" draggable={false} />)}</span> : <img src={asset(photo.files.thumbnail)} alt="" draggable={false} />}
          {grouped && <span className="cluster-count">{cluster.photos.length}</span>}
        </button>}</MarkerFade>
      </Html>
    </group>;
  })}</>;
}

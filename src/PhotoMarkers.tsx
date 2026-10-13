import { useEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { Matrix4, type Object3D } from 'three';
import { asset, type Campus, type Site } from './types';
import { useMapColor } from './MapTheme';
import type { MapPhoto } from './MapCameraRig';
import { collagePhotos, regionPhotoClusters, type PhotoCluster } from './photo-clusters';
import { markerOccluders } from './photo-marker-occlusion';
import { MAP_PHOTO_FOCUS_DISTANCE, FULL_MAP_VIEWPORT, type MapViewport } from './map-card-viewport';
import { useAnimatedPresence } from './useAnimatedPresence';
import { useFadingItems } from './useFadingItems';
import { PHOTO_FADE_MS } from './fading-items';
import { isAerialPhoto } from './locations';
import { photoMarkerColors } from './photo-marker-colors';
import type { PhotoLikes } from './photo-sort';
import { photoLikeFrame } from './photo-like-frame';
import { orderPhotoMarkers } from './photo-marker-order';
import { expandedPhotoBuildings } from './map-floor-filter';

function MarkerFade({ visible, children }: { visible: boolean; children: (shown: boolean) => ReactNode }) {
  const presence = useAnimatedPresence(visible, PHOTO_FADE_MS, true);
  return children(presence.visible && visible);
}

export default function PhotoMarkers({ campus, site, photos, expansionPhotos, onExpandedBuildings, selected, minimal = false, labelPortal, onSelect, onPick, onExpand, onVisiblePhotos, visibleViewport = FULL_MAP_VIEWPORT, occlusionRevision, photoLikes }: {
  campus: Campus; site: Site; photos: MapPhoto[]; selected?: MapPhoto | null; labelPortal: RefObject<HTMLDivElement>;
  minimal?: boolean;
  expansionPhotos?: MapPhoto[]; onExpandedBuildings?: (ids: string[]) => void;
  onSelect: (photo: MapPhoto) => void; onPick: (cluster: PhotoCluster, trigger: HTMLButtonElement) => void;
  onExpand: (focus: { target: [number, number, number]; distance: number }) => void;
  onVisiblePhotos?: (ids: string[]) => void; visibleViewport?: MapViewport;
  occlusionRevision?: string; photoLikes?: PhotoLikes;
}) {
  const { camera, size, scene, invalidate } = useThree(), mapColor = useMapColor();
  const [markers, setMarkers] = useState<PhotoCluster[]>([]);
  const fadingClusters = useFadingItems(markers);
  const signature = useRef<string | null>(null), visibleSignature = useRef('');
  const expandedSignature = useRef<string | null>(null);
  const occluders = useRef<Object3D[] | null>(null);
  const lastView = useRef({ checked: false, world: new Matrix4(), projection: new Matrix4() });
  useEffect(() => {
    occluders.current = null; lastView.current.checked = false; invalidate();
  }, [campus, site.buildingOverrides, scene, occlusionRevision, invalidate]);
  useEffect(() => {
    signature.current = null; expandedSignature.current = null; lastView.current.checked = false; invalidate();
  }, [photos, expansionPhotos, onExpandedBuildings, campus, site, scene, size.width, size.height, selected?.id, occlusionRevision, visibleViewport, onVisiblePhotos, invalidate]);
  useFrame(() => {
    camera.updateMatrixWorld();
    const previous = lastView.current;
    if (previous.checked && previous.world.equals(camera.matrixWorld) && previous.projection.equals(camera.projectionMatrix)) return;
    if (onExpandedBuildings) {
      const ids = expandedPhotoBuildings(expansionPhotos || photos, campus, site, camera, size, visibleViewport, selected?.id).map(building => building.id);
      const key = ids.join(',');
      if (key !== expandedSignature.current) { expandedSignature.current = key; onExpandedBuildings(ids); }
    }
    const blockers = occluders.current ?? (occluders.current = markerOccluders(scene));
    const clusters = orderPhotoMarkers(regionPhotoClusters(photos, camera, size, blockers, { campus, site, selectedId: selected?.id }), camera);
    // Membership, real anchor, distance size and physical depth can each change independently.
    const key = clusters.map(cluster => [cluster.id, cluster.photos.map(photo => photo.id).join(','), cluster.position.toArray().join(','), cluster.markerWidth, cluster.markerHeight, cluster.opacity, cluster.collapsed, cluster.overflow].join(':')).join('|');
    if (key !== signature.current) { signature.current = key; setMarkers(clusters); }
    if (onVisiblePhotos) {
      const visible = clusters.filter(cluster => {
        const p = cluster.position.clone().project(camera);
        const x = (p.x + 1) / 2, y = (1 - p.y) / 2;
        return x >= visibleViewport.left && x <= visibleViewport.left + visibleViewport.width && y >= visibleViewport.top && y <= visibleViewport.top + visibleViewport.height;
      }).flatMap(cluster => cluster.photos.map(photo => photo.id)).sort();
      const next = visible.join(',');
      if (next !== visibleSignature.current) { visibleSignature.current = next; onVisiblePhotos(visible); }
    }
    previous.checked = true; previous.world.copy(camera.matrixWorld); previous.projection.copy(camera.projectionMatrix);
  });
  useEffect(() => () => onVisiblePhotos?.([]), [onVisiblePhotos]);
  const currentIds = new Set(photos.map(photo => photo.id));
  const ranks = new Map(orderPhotoMarkers(fadingClusters.map(({ item, expiresAt }) => ({ ...item, overflow: item.overflow || expiresAt !== null })), camera).map((cluster, index) => [cluster.id, cluster.overflow ? 0 : index + 1]));
  return <>{fadingClusters.map(({ item: cluster, expiresAt }) => {
    const photo = cluster.photos.find(photo => photo.id === selected?.id) || cluster.photos[0];
    const active = !cluster.overflow && cluster.photos.some(photo => photo.id === selected?.id), grouped = cluster.photos.length > 1;
    const allAerial = cluster.photos.every(isAerialPhoto), mixed = !allAerial && cluster.photos.some(isAerialPhoto);
    const colors = photoMarkerColors(photo), aerialColors = photoMarkerColors(cluster.photos.find(isAerialPhoto) || photo);
    const visible = expiresAt === null && cluster.photos.every(photo => currentIds.has(photo.id));
    const likes = Math.max(0, ...cluster.photos.map(photo => photoLikes?.[photo.id]?.count || 0));
    const rank = ranks.get(cluster.id) || 0;
    const label = cluster.overflow ? `查看${cluster.regionName || '此建筑'}其余 ${cluster.photos.length} 张照片` : cluster.collapsed ? `靠近查看${cluster.regionName || '此区域'}，共 ${cluster.photos.length} 张照片`
      : grouped ? `选择同地点${allAerial ? '航拍' : ''}照片，共 ${cluster.photos.length} 张` : `查看${isAerialPhoto(photo) ? '航拍' : ''}照片：${photo.title}`;
    return <Html key={cluster.id} portal={labelPortal} position={cluster.position} center zIndexRange={[rank, rank]} style={{ pointerEvents: 'none' }} ref={node => { if (node?.parentElement) node.parentElement.style.zIndex = String(rank); }}>
      <MarkerFade visible={visible}>{shown => <button className={'map-photo spatial-photo ' + (minimal ? 'mobile-photo ' : '') + (grouped ? 'collage ' : '') + (cluster.collapsed ? 'region-collection ' : '') + (cluster.overflow ? 'overflow-collection ' : '') + (active ? 'selected ' : '') + (allAerial ? 'aerial ' : mixed ? 'mixed ' : '')}
        style={{ ...photoLikeFrame(likes), width: cluster.markerWidth, height: cluster.markerHeight, opacity: shown ? cluster.overflow ? Math.min(.4, cluster.opacity ?? 1) : cluster.opacity : 0, pointerEvents: shown ? 'auto' : 'none', '--photo-accent': mapColor(aerialColors.border), '--photo-selected': mapColor(colors.selected) } as CSSProperties}
        disabled={!visible} aria-hidden={!visible} aria-pressed={active} aria-label={label} title={label} aria-haspopup={grouped && !cluster.collapsed ? 'dialog' : undefined}
        data-cluster-id={cluster.id} data-photo-count={cluster.photos.length} data-spot-count={cluster.spots.length} data-photo-ids={cluster.photos.map(photo => photo.id).join(',')}
        data-photo-capture={allAerial ? 'aerial' : mixed ? 'mixed' : 'ground'} data-region-id={cluster.regionId} data-region-collapsed={cluster.collapsed} data-photo-overflow={!!cluster.overflow} data-photo-rank={rank} data-photo-layers={cluster.occlusionLayers} data-photo-position={cluster.position.toArray().join(',')}
        onClick={event => {
          event.stopPropagation();
          if (active) { onSelect(photo); return; }
          // Keep separate physical layers on the map, while making every card
          // under a finger reachable. Keyboard activation addresses only this card.
          if (event.detail > 0 && labelPortal.current) {
            const hits = new Set(document.elementsFromPoint(event.clientX, event.clientY).map(element =>
              element.closest<HTMLButtonElement>('.spatial-photo:not(:disabled):not([aria-hidden="true"])')?.dataset.clusterId).filter(Boolean));
            const hitMarkers = markers.filter(marker => hits.has(marker.id));
            const foreground = hitMarkers.filter(marker => !marker.overflow);
            const overlapping = foreground.length ? foreground : hitMarkers;
            if (overlapping.length > 1) {
              const photos = [...new Map(overlapping.flatMap(marker => marker.photos).map(photo => [photo.id, photo])).values()];
              onPick({ ...cluster, photos, spots: overlapping.flatMap(marker => marker.spots) }, event.currentTarget); return;
            }
          }
          if (cluster.collapsed) { onExpand({ target: cluster.position.toArray() as [number, number, number], distance: MAP_PHOTO_FOCUS_DISTANCE }); return; }
          if (!grouped) onSelect(photo); else onPick(cluster, event.currentTarget);
        }}>
        {grouped ? <span className={'photo-collage' + (cluster.photos.length < 4 ? ' two-up' : '')}>{collagePhotos(cluster.photos).map(photo => <img key={photo.id} src={asset(photo.files.thumbnail)} alt="" draggable={false} />)}</span> : <img src={asset(photo.files.thumbnail)} alt="" draggable={false} />}
        {grouped && <span className="cluster-count">{cluster.photos.length}</span>}
        {cluster.collapsed && <span className="region-collection-label">{cluster.regionName}</span>}
        {cluster.overflow && <span className="overflow-collection-label">其余照片</span>}
      </button>}</MarkerFade>
    </Html>;
  })}</>;
}

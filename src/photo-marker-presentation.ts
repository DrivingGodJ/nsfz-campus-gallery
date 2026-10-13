import type { PhotoCluster } from './photo-clusters';

// Camera-dependent size, depth and opacity are updated on the existing nodes.
// React only needs to render changed membership, anchors or collection labels.
export function photoMarkerStructureKey(clusters: PhotoCluster[]) {
  return clusters.map(cluster => [cluster.id, cluster.photos.map(photo => photo.id).sort().join(','), cluster.photos.slice(0, 4).map(photo => photo.id).join(','), cluster.position.toArray().join(','), cluster.regionName, cluster.collapsed, cluster.overflow].join(':')).sort().join('|');
}

export function photoMarkerOpacity(cluster: PhotoCluster) {
  return cluster.overflow ? Math.min(.4, cluster.opacity ?? 1) : cluster.opacity ?? 1;
}

export function updatePhotoMarker(node: HTMLButtonElement, anchor: HTMLElement | null, cluster: PhotoCluster, rank: number) {
  const width = cluster.markerWidth === undefined ? '' : `${cluster.markerWidth}px`, height = cluster.markerHeight === undefined ? '' : `${cluster.markerHeight}px`;
  if (node.style.width !== width) node.style.width = width;
  if (node.style.height !== height) node.style.height = height;
  // The enter/exit animation owns visibility even while the camera is moving.
  const opacity = String(!node.disabled && node.dataset.markerShown === 'true' ? photoMarkerOpacity(cluster) : 0);
  if (node.style.opacity !== opacity) node.style.opacity = opacity;
  node.dataset.photoLayers = String(cluster.occlusionLayers ?? 0);
  node.dataset.photoRank = String(rank);
  // Html also writes z-index from its last React props. The scoped CSS variable
  // keeps the current physical ordering independent of callback registration.
  anchor?.style.setProperty('--photo-rank', String(rank));
}

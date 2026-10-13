import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { asset, photoLocation, type Campus, type Photo, type Site } from './types';
import { photoSeasonLabel } from './photo-season';
import { useAnimatedPresence } from './useAnimatedPresence';
import { sortPhotos, type PhotoLikes } from './photo-sort';
import { photoLikeFrame } from './photo-like-frame';
import { AERIAL_LOCATION_FILTER, campusLocations, isAerialPhoto, photoLocationId } from './locations';

export default function PhotoClusterPicker({ photos, campus, site, onSelect, onClose, photoLikes, filterable = false }: {
  photos: Photo[] | null; campus: Campus; site: Site; onSelect: (photo: Photo, group?: Photo[]) => void; onClose: () => void;
  photoLikes?: PhotoLikes; filterable?: boolean;
}) {
  const panel = useRef<HTMLElement>(null);
  const presence = useAnimatedPresence(!!photos, 220, true);
  const retained = useRef<Photo[]>([]);
  if (photos) retained.current = photos;
  const group = photos || retained.current;
  const groupKey = group.map(photo => photo.id).join(',');
  const [filter, setFilter] = useState({ group: '', location: '' });
  const location = filter.group === groupKey ? filter.location : '';
  const places = filterable ? campusLocations(campus, site) : [];
  const knownPlaces = new Set(places.map(place => place.id));
  const destination = (photo: Photo) => {
    if (isAerialPhoto(photo)) return AERIAL_LOCATION_FILTER;
    const id = photoLocationId(photo, campus);
    return knownPlaces.has(id) ? id : 'capture/outdoor';
  };
  const counts = new Map<string, number>();
  if (filterable) for (const photo of group) { const id = destination(photo); counts.set(id, (counts.get(id) || 0) + 1); }
  const displayed = filterable ? sortPhotos(location ? group.filter(photo => destination(photo) === location) : group, photoLikes ? 'likes' : 'captured', site.photos, photoLikes) : group;
  useEffect(() => {
    if (!photos) return;
    panel.current?.querySelector<HTMLButtonElement>('.cluster-picker-photo')?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('keydown', escape); window.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('pointerdown', outside); };
  }, [!!photos, onClose]);
  if (!photos && !presence.present) return null;
  return <section ref={panel} className={'photo-cluster-picker' + (presence.visible ? ' is-visible' : '')} role="dialog" aria-label="选择这里的照片" aria-hidden={!photos} inert={!photos}>
    <div className="cluster-picker-heading"><div><strong>这里有 {group.length} 张照片</strong><p>{filterable ? '先选地点，再选择一张照片查看。' : '选择一张，查看照片与拍摄视角。'}</p></div><button className="icon-button" aria-label="关闭照片选择" onClick={onClose}><X size={18} /></button></div>
    {filterable && <label className="cluster-picker-filter">按地点选照片<select aria-label="筛选这里的拍摄地点" value={location} onChange={event => setFilter({ group: groupKey, location: event.target.value })}>
      <option value="">全部照片（{group.length}）</option>
      {places.filter(place => counts.has(place.id)).map(place => <option key={place.id} value={place.id}>{place.name}（{counts.get(place.id)}）</option>)}
      {counts.has('capture/outdoor') && <option value="capture/outdoor">室外（{counts.get('capture/outdoor')}）</option>}
      {counts.has(AERIAL_LOCATION_FILTER) && <option value={AERIAL_LOCATION_FILTER}>航拍（{counts.get(AERIAL_LOCATION_FILTER)}）</option>}
    </select></label>}
    <div className="cluster-picker-grid">{displayed.map(photo => <button className="cluster-picker-photo" style={photoLikeFrame(photoLikes?.[photo.id]?.count)} key={photo.id} aria-label={'查看照片资料：' + photo.title} onClick={() => onSelect(photo, displayed)}>
      <img src={asset(photo.files.thumbnail)} alt="" loading={filterable ? 'lazy' : undefined} /><strong>{filterable ? photoLocation(photo, campus, site) : photo.title}</strong><span>{filterable ? photo.capturedAt.slice(0, 10).replaceAll('-', '.') || '时间未记录' : photoLocation(photo, campus, site)} · {photoSeasonLabel(photo)}</span>
    </button>)}</div>
  </section>;
}

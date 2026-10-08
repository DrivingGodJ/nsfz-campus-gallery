import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { asset, photoLocation, type Campus, type Photo, type Site } from './types';
import { photoSeasonLabel } from './photo-season';
import { useAnimatedPresence } from './useAnimatedPresence';
import type { PhotoLikes } from './photo-sort';
import { photoLikeFrame } from './photo-like-frame';

export default function PhotoClusterPicker({ photos, campus, site, onSelect, onClose, photoLikes }: {
  photos: Photo[] | null; campus: Campus; site: Site; onSelect: (photo: Photo) => void; onClose: () => void;
  photoLikes?: PhotoLikes;
}) {
  const panel = useRef<HTMLElement>(null);
  const presence = useAnimatedPresence(!!photos, 220, true);
  const retained = useRef<Photo[]>([]);
  if (photos) retained.current = photos;
  const displayed = photos || retained.current;
  useEffect(() => {
    if (!photos) return;
    panel.current?.querySelector<HTMLButtonElement>('.cluster-picker-photo')?.focus({ preventScroll: true });
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } };
    const outside = (event: PointerEvent) => { if (!panel.current?.contains(event.target as Node)) onClose(); };
    window.addEventListener('keydown', escape); window.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('pointerdown', outside); };
  }, [!!photos, onClose]);
  if (!photos && !presence.present) return null;
  return <section ref={panel} className={'photo-cluster-picker' + (presence.visible ? ' is-visible' : '')} role="dialog" aria-label="选择合并的照片" aria-hidden={!photos} inert={!photos}>
    <div className="cluster-picker-heading"><div><strong>这里有 {displayed.length} 张照片</strong><p>选择一张，查看照片与拍摄视角。</p></div><button className="icon-button" aria-label="关闭照片选择" onClick={onClose}><X size={18} /></button></div>
    <div className="cluster-picker-grid">{displayed.map(photo => <button className="cluster-picker-photo" style={photoLikeFrame(photoLikes?.[photo.id]?.count)} key={photo.id} aria-label={'查看照片资料：' + photo.title} onClick={() => onSelect(photo)}>
      <img src={asset(photo.files.thumbnail)} alt="" /><strong>{photo.title}</strong><span>{photoSeasonLabel(photo)} · {photoLocation(photo, campus, site)}</span>
    </button>)}</div>
  </section>;
}

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, Camera, Heart, Images, MapPin, X } from 'lucide-react';
import { Brand, EmptyPhotos, Lightbox, Notice, PhotoDetails } from './components';
import { asset, buildingInfo, loadContent, photoLocation, type Campus, type Photo, type Site } from './types';
import { campusFilterLocations, campusLocations, isAerialPhoto, photoLocationId, photosAtLocation, samePhotoSpot } from './locations';
import LocationOptions from './LocationOptions';
import PhotoComparison from './PhotoComparison';
import { PhotoPerspectiveButton } from './PhotoPerspective';
import { SEASONS, photosInSeason, photoSeasonLabel, type PhotoSeason } from './photo-season';
import { sortPhotos, type PhotoSort } from './photo-sort';
import { usePhotoLikes } from './usePhotoLikes';
import PhotoLikeButton from './PhotoLikeButton';
import './styles.css';

const MapView = React.lazy(() => import('./MapView'));

function App() {
  const [content, setContent] = useState<{ campus: Campus; site: Site } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(() => window.innerWidth > 760);
  const [selected, setSelected] = useState<Photo | null>(null);
  const [large, setLarge] = useState(false);
  const [location, setLocation] = useState('');
  const [floor, setFloor] = useState(0);
  const [season, setSeason] = useState<PhotoSeason | ''>('');
  const [photoPerspective, setPhotoPerspective] = useState(false);
  const [sort, setSort] = useState<PhotoSort>('uploaded');
  const photoLikes = usePhotoLikes(content?.site.photos);
  const filterLocations = useMemo(() => content ? campusFilterLocations(content.campus, content.site) : [], [content]);
  const selectableLocationIds = useMemo(() => filterLocations.map(item => item.id), [filterLocations]);
  const setPhotoSelection = useCallback((photo: Photo | null) => {
    setPhotoPerspective(false);
    setLarge(false);
    setSelected(photo);
    const buildingLocation = photo && !isAerialPhoto(photo) && photo.floor > 0
      ? filterLocations.find(item => item.building && item.id === photoLocationId(photo, content?.campus))
      : undefined;
    setLocation(buildingLocation?.id || '');
    setFloor(buildingLocation ? photo!.floor : 0);
    if (photo) setOpen(false);
  }, [content?.campus, filterLocations]);
  const exitPhotoPerspective = useCallback(() => {
    setPhotoPerspective(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.photo-perspective-action button')?.focus({ preventScroll: true }));
  }, []);
  const togglePhotoPerspective = () => {
    if (photoPerspective) { exitPhotoPerspective(); return; }
    setPhotoPerspective(true); setLarge(false);
  };
  const closeLarge = useCallback(() => setLarge(false), []);
  const load = () => { setError(''); loadContent().then(setContent).catch(e => setError(e.message)); };
  useEffect(load, []);
  useEffect(() => {
    if (!content) return;
    const readPhotoLink = () => {
      const id = new URLSearchParams(window.location.hash.slice(1)).get('photo');
      const photo = content.site.photos.find(p => p.id === id);
      setPhotoSelection(photo || null);
    };
    readPhotoLink();
    window.addEventListener('hashchange', readPhotoLink);
    window.addEventListener('popstate', readPhotoLink);
    return () => { window.removeEventListener('hashchange', readPhotoLink); window.removeEventListener('popstate', readPhotoLink); };
  }, [content, setPhotoSelection]);
  const select = (photo: Photo) => {
    setPhotoSelection(photo);
    history.replaceState(null, '', '#photo=' + photo.id);
  };
  const back = () => { setPhotoSelection(null); history.replaceState(null, '', window.location.pathname); };
  const locationPhotos = useMemo(() => content ? photosAtLocation(content.site.photos, location, floor, content.campus) : [], [content, location, floor]);
  const filteredPhotos = useMemo(() => photosInSeason(locationPhotos, season), [locationPhotos, season]);
  const photos = useMemo(() => sortPhotos(filteredPhotos, sort, content?.site.photos || [], photoLikes.likes), [filteredPhotos, sort, content?.site.photos, photoLikes.likes]);
  const chosenLocation = content ? campusLocations(content.campus, content.site).find(item => item.id === location) : undefined;
  const chosen = chosenLocation?.building;
  const nearby = content && selected ? content.site.photos.filter(p => p.id !== selected.id && samePhotoSpot(p, selected, content.campus, content.site)) : [];
  const galleryOpen = open && !selected;
  return <div className="app viewer-app">
    <header className="app-header"><Brand /><a className="button secondary submission-link" href="./submit.html">投稿照片</a><div className="header-location"><MapPin size={14} /><span>南京 · 察哈尔路</span></div><button className={'button ' + (galleryOpen ? 'secondary' : 'primary')} onClick={() => { if (selected) { back(); setOpen(true); } else setOpen(!open); }} aria-expanded={galleryOpen}><Images size={16} />照片目录<span className="count">{content?.site.photos.length || 0}</span></button></header>
    {error ? <div className="page-error"><Notice kind="error">{error}</Notice><button className="button primary" onClick={load}>重新加载</button></div> : !content ? <div className="page-loading">正在展开校园地图…</div> :
      <main className={'viewer-main' + (galleryOpen ? ' panel-open' : '')}>
        <PhotoComparison photo={selected} onOpen={() => setLarge(true)}
          navigation={<><button className="text-button" onClick={() => { back(); setOpen(true); }}><ArrowLeft size={15} />目录</button><button className="icon-button" onClick={() => { back(); setOpen(false); }} aria-label="关闭照片对照"><X size={18} /></button></>}
          actions={selected && <div className="photo-browse-actions"><PhotoPerspectiveButton photo={selected} active={photoPerspective} compact onClick={togglePhotoPerspective} /><PhotoLikeButton value={photoLikes.likes[selected.id]} pending={photoLikes.pending.has(selected.id)} disabled={!photoLikes.canLike} message={photoLikes.message} onClick={() => void photoLikes.toggle(selected.id)} />{photoLikes.message && <p className="likes-status" role="status">{photoLikes.message}{photoLikes.phase === 'error' && <button className="text-button" onClick={() => void photoLikes.refresh()}>重试</button>}</p>}</div>}
          information={selected && <><PhotoDetails photo={selected} campus={content.campus} site={content.site} showImage={false} onOpen={() => setLarge(true)} />{nearby.length > 0 && <div className="nearby"><h3>同一拍摄点的照片</h3><div className="gallery-grid">{nearby.map(p => <button key={p.id} className="gallery-card" onClick={() => select(p)}><img src={asset(p.files.thumbnail)} alt="" /><strong>{p.title}</strong></button>)}</div></div>}</>}>
          <React.Suspense fallback={<div className="map-stage map-loading">正在绘制校园地图…</div>}><MapView campus={content.campus} site={content.site} photos={filteredPhotos} selectedPhoto={selected} onSelectPhoto={select} selectedLocation={selected ? photoLocationId(selected, content.campus) : location} floor={floor} season={season} selectableLocationIds={selectableLocationIds} photoPerspective={photoPerspective} onExitPhotoPerspective={exitPhotoPerspective} onLocation={id => { back(); setLocation(id); setFloor(0); setOpen(true); }} onClearLocation={() => { if (selected) back(); else { setLocation(''); setFloor(0); } }} /></React.Suspense>
        </PhotoComparison>
        {galleryOpen && <aside className="viewer-panel" aria-label="照片目录"><div className="panel-heading"><div><p className="eyebrow">察哈尔路 · 校园影像</p><h1>照片目录</h1></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="收起照片目录"><X size={18} /></button></div>
            <div className="filters"><label>地点<select value={location} onChange={e => { setLocation(e.target.value); setFloor(0); }}><option value="">全部地点</option><LocationOptions campus={content.campus} site={content.site} /></select></label><label>{chosen ? '楼层' : '层面'}<select value={floor} disabled={!chosen} onChange={e => setFloor(Number(e.target.value))}><option value="0">{chosenLocation && !chosen ? chosenLocation.levelText : '全部楼层'}</option>{chosen && Array.from({ length: buildingInfo(chosen, content.site).floors }, (_, i) => <option key={i} value={i + 1}>{i + 1} 楼{i + 1 > buildingInfo(chosen, content.site).baseFloors ? '（局部）' : ''}</option>)}</select></label><label className="season-filter">季节<select aria-label="按季节筛选照片" title="按拍摄月份分类：春季 3–5 月，夏季 6–8 月，秋季 9–11 月，冬季 12–2 月" value={season} onChange={e => setSeason(e.target.value as PhotoSeason | '')}><option value="">全部季节</option>{SEASONS.map(item => <option key={item.id} value={item.id}>{item.label}（{photosInSeason(locationPhotos, item.id).length}）</option>)}</select></label><label className="sort-filter">排列顺序<select aria-label="照片排列顺序" value={sort} onChange={e => setSort(e.target.value as PhotoSort)}><option value="uploaded">上传顺序（最新在前）</option><option value="captured">拍摄时间（最近在前）</option><option value="likes" disabled={photoLikes.phase !== 'ready'}>点赞最多</option></select></label></div>{photoLikes.message && <p className="likes-status catalog-likes-status" role="status">{photoLikes.message}{photoLikes.phase === 'error' && <button className="text-button" onClick={() => void photoLikes.refresh()}>重试</button>}</p>}<p className="filter-results" aria-live="polite">{photos.length} 张照片{season ? ' · ' + SEASONS.find(item => item.id === season)!.label : ''}</p>
            {content.site.photos.length === 0 ? <EmptyPhotos /> : photos.length === 0 ? <div className="empty-filter"><Camera size={26} /><p>没有符合当前筛选的照片。</p><button className="text-button" onClick={() => { setLocation(''); setFloor(0); setSeason(''); }}>查看全部照片</button></div> : <div className="gallery-grid">{photos.map(photo => <button className="gallery-card" key={photo.id} onClick={() => select(photo)}><img src={asset(photo.files.thumbnail)} alt="" loading="lazy" /><strong>{photo.title}</strong><span className="gallery-likes"><Heart size={12} aria-hidden="true" fill={photoLikes.likes[photo.id]?.liked ? 'currentColor' : 'none'} />{photoLikes.likes[photo.id]?.count ?? '—'}<span className="sr-only"> 个赞</span></span><span>{photoLocation(photo, content.campus, content.site)} · {photoSeasonLabel(photo)}</span></button>)}</div>}
            <div className="archive-note"><span>{campusLocations(content.campus, content.site).length} 个拍摄地点</span><span>{content.site.photos.length} 张校园照片</span><p>照片留住片刻，地图记住位置。</p></div>
        </aside>}
      </main>}
    {large && selected && <Lightbox photo={selected} onClose={closeLarge} onPhotoPerspective={() => { setLarge(false); if (!photoPerspective) togglePhotoPerspective(); }} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

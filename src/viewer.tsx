import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, CalendarDays, Camera, ChevronLeft, ChevronRight, Download, Heart, Images, Map, MapPin, SlidersHorizontal, X } from 'lucide-react';
import { Brand, EmptyPhotos, Lightbox, Notice, PhotoDetails, PhotoDownloadLink } from './components';
import { asset, loadContent, photoLocation, type Campus, type Photo, type Site } from './types';
import { AERIAL_LOCATION_FILTER, campusFilterLocations, campusLocations, isAerialPhoto, photoLocationId, photosAtLocation, samePhotoSpot } from './locations';
import LocationOptions from './LocationOptions';
import PhotoComparison from './PhotoComparison';
import { PhotoHalfOverlayButton, PhotoPerspectiveButton } from './PhotoPerspective';
import { SEASONS, photosInSeason, photoSeasonLabel, type PhotoSeason } from './photo-season';
import { PHOTO_TIMES, photosInTime, type PhotoTime } from './photo-time';
import { sortPhotos, type PhotoSort } from './photo-sort';
import { usePhotoLikes } from './usePhotoLikes';
import PhotoLikeButton from './PhotoLikeButton';
import { useAnimatedPresence } from './useAnimatedPresence';
import CardHandle from './CardHandle';
import { useViewerCards } from './useViewerCards';
import { FULL_MAP_VIEWPORT } from './map-card-viewport';
import { photoPerspectiveIssue } from './photo-perspective';
import githubMark from './assets/github-mark.svg';
import { prioritizePhoto, usePhotoPreloading } from './usePhotoPreloading';
import { photoDisplayFile } from './photo-image';
import { photosOnThisDay } from './photo-on-this-day';
import { photoLikeFrame } from './photo-like-frame';
import './styles.css';
import './photo-on-this-day.css';
import './viewer-browse.css';
import { adjacentPhoto } from './photo-browse';
import LocalPhotoCache from './LocalPhotoCache';

const MapView = React.lazy(() => import('./MapView'));
const GITHUB_MASK = `url(${JSON.stringify(githubMark)})`;

function App() {
  const [content, setContent] = useState<{ campus: Campus; site: Site } | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(() => !window.matchMedia('(max-width: 760px)').matches);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const browsePhotos = useRef<Photo[]>([]);
  const browseFilters = useRef({ location: '' });
  const [selected, setSelected] = useState<Photo | null>(null);
  const [large, setLarge] = useState(false);
  const [location, setLocation] = useState('');
  const [season, setSeason] = useState<PhotoSeason | ''>('');
  const [time, setTime] = useState<PhotoTime | ''>('');
  const [photoPerspective, setPhotoPerspective] = useState(false);
  const [halfOverlay, setHalfOverlay] = useState(false);
  const [immersive, setImmersive] = useState<'preparing' | 'entering' | 'shown' | 'exiting' | 'restoring' | null>(null);
  const returnView = useRef({ perspective: false, half: false });
  const enterImmersive = () => {
    if (!selected || photoPerspectiveIssue(selected)) return;
    returnView.current = { perspective: photoPerspective, half: halfOverlay };
    setLarge(false); setImmersive('preparing');
  };
  const requestImmersiveExit = useCallback(() => setImmersive(phase => phase === 'preparing' ? 'restoring' : phase === 'restoring' ? phase : phase ? 'exiting' : null), []);
  useEffect(() => {
    if (immersive !== 'preparing' && immersive !== 'restoring') return;
    const handle = window.setTimeout(() => {
      if (immersive === 'preparing') { setHalfOverlay(false); setPhotoPerspective(true); setImmersive('entering'); }
      else setImmersive(null);
    }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 40 : 260);
    return () => window.clearTimeout(handle);
  }, [immersive]);
  useEffect(() => {
    if (immersive !== 'preparing') return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); requestImmersiveExit(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [immersive, requestImmersiveExit]);
  const immersiveActive = immersive === 'entering' || immersive === 'shown' || immersive === 'exiting';
  const finishImmersiveExit = useCallback(() => {
    setImmersive('restoring'); setPhotoPerspective(returnView.current.perspective); setHalfOverlay(returnView.current.half);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.comparison-overlay-actions .primary')?.focus({ preventScroll: true }));
  }, []);
  const toggleHalfOverlay = () => { setHalfOverlay(value => !value); setPhotoPerspective(true); setLarge(false); };
  const [sort, setSort] = useState<PhotoSort>('likes');
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => { if (!document.hidden) setToday(new Date()); };
    const midnight = new Date(); midnight.setHours(24, 0, 0, 50);
    const timer = window.setTimeout(refresh, midnight.getTime() - Date.now());
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [today]);
  const photoLikes = usePhotoLikes(content?.site.photos);
  const filterLocations = useMemo(() => content ? campusFilterLocations(content.campus, content.site) : [], [content]);
  const selectableLocationIds = useMemo(() => filterLocations.map(item => item.id), [filterLocations]);
  const setPhotoSelection = useCallback((photo: Photo | null) => {
    prioritizePhoto(photo);
    setPhotoPerspective(false); setHalfOverlay(false); setImmersive(null);
    setLarge(false);
    setSelected(photo);
    const buildingLocation = photo && !isAerialPhoto(photo) && photo.floor !== 0
      ? filterLocations.find(item => item.building && item.id === photoLocationId(photo, content?.campus))
      : undefined;
    setLocation(buildingLocation?.id || '');
    if (photo) setOpen(false);
  }, [content?.campus, filterLocations]);
  const exitPhotoPerspective = useCallback(() => {
    setPhotoPerspective(false); setHalfOverlay(false);
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
      browsePhotos.current = content.site.photos;
      browseFilters.current = { location: '' };
      setPhotoSelection(photo || null);
    };
    readPhotoLink();
    window.addEventListener('hashchange', readPhotoLink);
    window.addEventListener('popstate', readPhotoLink);
    return () => { window.removeEventListener('hashchange', readPhotoLink); window.removeEventListener('popstate', readPhotoLink); };
  }, [content, setPhotoSelection]);
  const select = (photo: Photo, group?: Photo[]) => {
    if (!selected) browseFilters.current = { location };
    if (group?.length) browsePhotos.current = group;
    else if (!selected || !browsePhotos.current.some(item => item.id === photo.id)) browsePhotos.current = photos.some(item => item.id === photo.id) ? photos : content?.site.photos || [];
    if (selected?.id === photo.id) { back(); return; }
    setPhotoSelection(photo);
    history.replaceState(null, '', '#photo=' + photo.id);
  };
  const back = () => {
    const filters = selected ? browseFilters.current : { location: '' };
    setPhotoSelection(null); setLocation(filters.location);
    history.replaceState(null, '', window.location.pathname);
  };
  const selectLocation = (id: string) => {
    const activeId = selected ? photoLocationId(selected, content?.campus) : location;
    back();
    if (id !== activeId) { setLocation(id); setOpen(true); }
  };
  const locationPhotos = useMemo(() => content ? photosAtLocation(content.site.photos, location, 0, content.campus) : [], [content, location]);
  const seasonPhotos = useMemo(() => photosInSeason(locationPhotos, season), [locationPhotos, season]);
  const filteredPhotos = useMemo(() => photosInTime(seasonPhotos, time), [seasonPhotos, time]);
  const photos = useMemo(() => sortPhotos(filteredPhotos, sort === 'likes' && photoLikes.phase !== 'ready' ? 'uploaded' : sort, content?.site.photos || [], photoLikes.likes), [filteredPhotos, sort, content?.site.photos, photoLikes.likes, photoLikes.phase]);
  const onThisDay = useMemo(() => photosOnThisDay(content?.site.photos || [], today), [content?.site.photos, today]);
  const catalogPhotos = useMemo(() => [...onThisDay, ...photos], [onThisDay, photos]);
  const nearby = content && selected ? content.site.photos.filter(p => p.id !== selected.id && samePhotoSpot(p, selected, content.campus, content.site)) : [];
  const galleryOpen = open && !selected;
  const galleryPresence = useAnimatedPresence(galleryOpen);
  const cards = useViewerCards(!!content, galleryOpen, !!selected);
  const mainLabelIds = useMemo(() => cards.mobile ? filterLocations.filter(item => ['主教学楼', '图书馆', '体育馆', '操场', '未名湖'].includes(item.name) || item.surfaceHeight < 0 || item.feature?.type === 'tunnelEntrance').map(item => item.id) : undefined, [cards.mobile, filterLocations]);
  const previousPhoto = selected ? adjacentPhoto(browsePhotos.current, selected.id, -1) : undefined;
  const nextPhoto = selected ? adjacentPhoto(browsePhotos.current, selected.id, 1) : undefined;
  const activeFilters = [location, season, time].filter(Boolean).length;
  const clearFilters = () => { setLocation(''); setSeason(''); setTime(''); };
  const preloading = usePhotoPreloading(content?.site.photos, selected, photoLikes.likes, photoLikes.phase === 'ready', galleryOpen, catalogPhotos);
  return <div className={'app viewer-app' + (immersiveActive ? ' photo-immersive' : '') + (immersive ? ' immersive-' + immersive : '')}>
    <header className="app-header">
      <Brand />
      <LocalPhotoCache />
      <nav className="viewer-header-links" aria-label="项目链接">
        <a className="button secondary github-link" href="https://github.com/DrivingGodJ/nsfz-campus-gallery" target="_blank" rel="noopener noreferrer" aria-label="GitHub 开源项目" title="查看 GitHub 开源项目">
          <span className="github-mark" aria-hidden="true" style={{ maskImage: GITHUB_MASK, WebkitMaskImage: GITHUB_MASK }} /><span className="github-label">GitHub</span>
        </a>
        <a className="button secondary submission-link" href="./submit.html">投稿照片</a>
      </nav>
      <div className="header-location"><MapPin size={14} /><span>南京 · 察哈尔路</span></div>
      <button className={'button ' + (galleryOpen ? 'secondary' : 'primary')} onClick={() => { if (selected) { back(); setOpen(true); } else setOpen(!open); }} aria-label="照片目录" aria-expanded={galleryOpen}><Images size={16} /><span className="catalog-label">照片目录</span><span className="count">{content?.site.photos.length || 0}</span></button>
    </header>
    {error ? <div className="page-error"><Notice kind="error">{error}</Notice><button className="button primary" onClick={load}>重新加载</button></div> : !content ? <div className="page-loading">正在展开校园地图…</div> :
      <main ref={cards.container} className={'viewer-main viewer-cards' + (galleryPresence.visible ? ' panel-open' : '')}>
        <PhotoComparison photo={selected} highQuality informationAfterImage={cards.mobile} heading={selected && cards.mobile ? <div className="photo-context"><strong>{photoLocation(selected, content.campus, content.site)}</strong><span>{selected.capturedAt ? selected.capturedAt.slice(0, 16).replace('T', ' ').replaceAll('-', '.') : '拍摄时间未记录'}</span></div> : undefined} onOpen={enterImmersive} openLabel="沉浸看照片" openHelp="沉浸式看照片中可下载原图" openDisabled={selected ? photoPerspectiveIssue(selected) : undefined} footerActions={selected && photoPerspective && <PhotoHalfOverlayButton photo={selected} active={halfOverlay} onClick={toggleHalfOverlay} />} card={cards.photo}
          navigation={<><button className="text-button" onClick={() => { back(); setOpen(true); }}><ArrowLeft size={15} />目录</button><button className="icon-button" onClick={() => { back(); setOpen(false); }} aria-label="关闭照片对照"><X size={18} /></button></>}
          actions={selected && <div className="photo-browse-actions"><div className="photo-stepper" role="group" aria-label="切换照片"><button className="icon-button" aria-label="上一张照片" disabled={!previousPhoto} onClick={() => previousPhoto && select(previousPhoto, browsePhotos.current)}><ChevronLeft size={20} /></button><span aria-live="polite">{Math.max(0, browsePhotos.current.findIndex(photo => photo.id === selected.id)) + 1} / {browsePhotos.current.length || 1}</span><button className="icon-button" aria-label="下一张照片" disabled={!nextPhoto} onClick={() => nextPhoto && select(nextPhoto, browsePhotos.current)}><ChevronRight size={20} /></button></div><PhotoPerspectiveButton photo={selected} active={photoPerspective} compact onClick={togglePhotoPerspective} /><PhotoLikeButton value={photoLikes.likes[selected.id]} pending={photoLikes.pending.has(selected.id)} disabled={!photoLikes.canLike} message={photoLikes.message} onClick={() => void photoLikes.toggle(selected.id)} />{photoLikes.message && <p className="likes-status" role="status">{photoLikes.message}{photoLikes.phase === 'error' && <button className="text-button" onClick={() => void photoLikes.refresh()}>重试</button>}</p>}</div>}
          information={selected && <><PhotoDetails photo={selected} campus={content.campus} site={content.site} showImage={false} onOpen={() => setLarge(true)} />{nearby.length > 0 && <div className="nearby"><h3>同一拍摄点的照片</h3><div className="gallery-grid">{nearby.map(p => <button key={p.id} className="gallery-card" style={photoLikeFrame(photoLikes.likes[p.id]?.count)} onClick={() => select(p, [selected, ...nearby])}><img src={asset(p.files.thumbnail)} alt="" /><strong>{p.title}</strong></button>)}</div></div>}</>}>
          <React.Suspense fallback={<div className="map-stage map-loading">正在绘制校园地图…</div>}><MapView floorBrowsing campus={content.campus} site={content.site} photos={filteredPhotos} photoLevel={location === AERIAL_LOCATION_FILTER ? 'aerial' : undefined} compactPhotoMarkers={cards.mobile} visibleLocationLabelIds={mainLabelIds} photoLikes={photoLikes.likes} selectedPhoto={selected} onSelectPhoto={select} onVisiblePhotos={preloading.reportMapVisible} selectedLocation={selected ? photoLocationId(selected, content.campus) : location === AERIAL_LOCATION_FILTER ? '' : location} floor={selected && !isAerialPhoto(selected) ? selected.floor : 0} season={season} time={time} selectableLocationIds={selectableLocationIds} visibleViewport={immersiveActive ? FULL_MAP_VIEWPORT : cards.viewport} photoPerspective={photoPerspective} smoothPhotoFraming={!!immersive} photoOverlayMode={immersiveActive ? immersive as 'entering' | 'shown' | 'exiting' : halfOverlay ? 'translucent' : 'off'} photoImageSource={selected ? asset(photoDisplayFile(selected)) : undefined} onPhotoOverlayEntered={() => setImmersive(phase => phase === 'entering' ? 'shown' : phase)} onPhotoOverlayExited={finishImmersiveExit} onExitPhotoPerspective={immersiveActive ? requestImmersiveExit : exitPhotoPerspective} onLocation={selectLocation} onClearLocation={() => { if (selected) back(); else setLocation(''); }} /></React.Suspense>
        </PhotoComparison>
        {galleryPresence.present && <aside className="viewer-panel" style={cards.gallery.style} aria-label="照片目录" aria-hidden={!galleryOpen} inert={!galleryOpen}><CardHandle label="调整照片目录卡片大小" sizing={cards.gallery.sizing} /><div ref={preloading.catalog} className="catalog-scroll"><div className="panel-heading"><div><p className="eyebrow">察哈尔路 · 校园影像</p><h1>照片目录</h1></div><button className="icon-button" onClick={() => setOpen(false)} aria-label="收起照片目录"><X size={18} /></button></div>
            <div className="catalog-browse-controls">
              <div className="catalog-filter-row"><label>地点<select aria-label="按地点筛选照片" value={location} onChange={e => setLocation(e.target.value)}><option value="">全部地点</option><option value={AERIAL_LOCATION_FILTER}>航拍</option><LocationOptions campus={content.campus} site={content.site} /></select></label><button className="button secondary catalog-filter-toggle" aria-expanded={filtersOpen} aria-controls="catalog-extra-filters" onClick={() => setFiltersOpen(value => !value)}><SlidersHorizontal size={16} />筛选{activeFilters > 0 && <span>{activeFilters}</span>}</button></div>
            </div>
            {(!cards.mobile || filtersOpen) && <div id="catalog-extra-filters" className="filters"><label className="season-filter">季节<select aria-label="按季节筛选照片" title="按拍摄月份分类：春季 3–5 月，夏季 6–8 月，秋季 9–11 月，冬季 12–2 月" value={season} onChange={e => setSeason(e.target.value as PhotoSeason | '')}><option value="">全部季节</option>{SEASONS.map(item => <option key={item.id} value={item.id}>{item.label}（{photosInSeason(locationPhotos, item.id).length}）</option>)}</select></label><label className="time-filter">拍摄时段<select aria-label="按拍摄时段筛选照片" title="按相机记录的拍摄时刻分类；选择后地图呈现对应光线" value={time} onChange={e => setTime(e.target.value as PhotoTime | '')}><option value="">全部时段（跟随系统外观）</option>{PHOTO_TIMES.map(item => <option key={item.id} value={item.id}>{item.label}{item.hours ? ' · ' + item.hours : ''}（{photosInTime(seasonPhotos, item.id).length}）</option>)}</select></label><label className="sort-filter">排列顺序<select aria-label="照片排列顺序" value={sort} onChange={e => setSort(e.target.value as PhotoSort)}><option value="likes" disabled={photoLikes.phase !== 'ready'}>点赞最多</option><option value="uploaded">上传顺序（最新在前）</option><option value="captured">拍摄时间（最近在前）</option></select></label></div>}{photoLikes.message && <p className="likes-status catalog-likes-status" role="status">{photoLikes.message}{photoLikes.phase === 'error' && <button className="text-button" onClick={() => void photoLikes.refresh()}>重试</button>}</p>}{sort === 'likes' && photoLikes.phase !== 'ready' && <p className="likes-status catalog-likes-status">点赞数暂不可用，先按上传顺序展示。</p>}<p className="filter-results" aria-live="polite">{photos.length} 张照片{location === AERIAL_LOCATION_FILTER ? ' · 航拍' : ''}{season ? ' · ' + SEASONS.find(item => item.id === season)!.label : ''}{time ? ' · ' + PHOTO_TIMES.find(item => item.id === time)!.label : ''}{activeFilters > 0 && <button className="text-button" onClick={clearFilters}>清除筛选</button>}</p>
            {onThisDay.length > 0 && activeFilters === 0 && <details open={cards.mobile ? undefined : true} className="on-this-day" aria-labelledby="on-this-day-title">
              <summary className="on-this-day-heading"><h2 id="on-this-day-title"><CalendarDays size={15} aria-hidden="true" />那年今日</h2><p>{today.getMonth() + 1} 月 {today.getDate()} 日 · {onThisDay.length} 张</p></summary>
              <div className="gallery-grid">{onThisDay.map(photo => <button className="gallery-card" style={photoLikeFrame(photoLikes.likes[photo.id]?.count)} key={photo.id} data-preload-photo-id={photo.id} onClick={() => select(photo, onThisDay)}><img src={asset(photo.files.thumbnail)} alt="" loading="lazy" /><strong>{photo.title}</strong><span>{photo.capturedAt.slice(0, 10).replaceAll('-', '.')}</span><span className="gallery-likes"><Heart size={12} aria-hidden="true" fill={photoLikes.likes[photo.id]?.liked ? 'currentColor' : 'none'} />{photoLikes.likes[photo.id]?.count ?? '—'}<span className="sr-only"> 个赞</span></span></button>)}</div>
            </details>}

            {content.site.photos.length === 0 ? <EmptyPhotos /> : photos.length === 0 ? <div className="empty-filter"><Camera size={26} /><p>没有符合当前筛选的照片。</p><button className="text-button" onClick={clearFilters}>查看全部照片</button></div> : <div className="gallery-grid">{photos.map(photo => <button className="gallery-card" style={photoLikeFrame(photoLikes.likes[photo.id]?.count)} key={photo.id} data-preload-photo-id={photo.id} onClick={() => select(photo)}><img src={asset(photo.files.thumbnail)} alt="" loading="lazy" /><strong>{cards.mobile ? photoLocation(photo, content.campus, content.site) : photo.title}</strong><span className="gallery-likes"><Heart size={12} aria-hidden="true" fill={photoLikes.likes[photo.id]?.liked ? 'currentColor' : 'none'} />{photoLikes.likes[photo.id]?.count ?? '—'}<span className="sr-only"> 个赞</span></span><span>{cards.mobile ? photo.capturedAt.slice(0, 10).replaceAll('-', '.') || '时间未记录' : photoLocation(photo, content.campus, content.site)} · {photoSeasonLabel(photo)}</span></button>)}</div>}
            <div className="archive-note"><span>{campusLocations(content.campus, content.site).length} 个拍摄地点</span><span>{content.site.photos.length} 张校园照片</span><p>照片留住片刻，地图记住位置。</p></div>
        </div></aside>}
      </main>}
    {content && <nav className="viewer-mobile-nav" aria-label="浏览方式" aria-hidden={!!immersive} inert={!!immersive}>
      <button type="button" className={!galleryOpen ? 'active' : ''} aria-pressed={!galleryOpen} onClick={() => { if (selected) back(); setOpen(false); }}><Map size={20} /><span>地图</span></button>
      <button type="button" className={galleryOpen ? 'active' : ''} aria-pressed={galleryOpen} onClick={() => { if (selected) back(); setOpen(true); }}><Images size={20} /><span>照片</span><small>{content.site.photos.length}</small></button>
    </nav>}
    {immersiveActive && selected && <footer className={'immersive-actions' + (immersive === 'shown' ? ' is-visible' : '')} aria-label="沉浸照片操作" aria-hidden={immersive !== 'shown'} inert={immersive !== 'shown'}>
      <button className="button secondary" onClick={requestImmersiveExit}><ArrowLeft size={16} />返回校园</button>
      <PhotoDownloadLink photo={selected} className="button primary"><Download size={16} />下载原图</PhotoDownloadLink>
    </footer>}
    {large && selected && <Lightbox photo={selected} onClose={closeLarge} onPhotoPerspective={() => { setLarge(false); if (!photoPerspective) togglePhotoPerspective(); }} />}
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

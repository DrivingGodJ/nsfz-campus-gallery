import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Camera, Download, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { asset, captureTimeText, headingText, photoLocation, sizeText, type Campus, type Photo, type Site } from './types';
import { photoFieldOfView, viewSourceText } from './photo-view';
import { altitudeLabel, campusLocations, isAerialPhoto } from './locations';
import { PhotoPerspectiveButton } from './PhotoPerspective';
import { photoPerspectiveIssue } from './photo-perspective';
import { photoPreviewFile } from './photo-image';
import PhotoImage from './PhotoImage';

export function Brand({ editor = false }: { editor?: boolean }) {
  return <a className="brand" href={editor ? './editor.html' : './'} aria-label={editor ? '附中影像本地编辑器' : '附中影像首页'}>
    <span className="brand-mark"><Camera size={22} strokeWidth={1.5} /></span>
    <span><strong>附中影像</strong><small>NSFZ · CAMPUS ARCHIVE</small></span>
  </a>;
}
export function EmptyPhotos({ editor = false }: { editor?: boolean }) {
  return <div className="empty-photos"><Camera size={32} strokeWidth={1} />
    <strong>{editor ? '从第一张校园照片开始' : '校园照片尚未发布'}</strong>
    <p>{editor ? '航拍照片自动读取位置和高度；普通照片标记位置后，补充楼层、方向与描述。' : '地图可以自由旋转、缩放。照片发布后，会出现在各自的拍摄位置。'}</p>
  </div>;
}
export function Notice({ children, kind = 'info', action }: { children: ReactNode; kind?: string; action?: ReactNode }) {
  return <div className={'notice ' + kind} role={kind === 'error' ? 'alert' : 'status'}>{children}{action}</div>;
}
export function PhotoMetadataView({ photo, editor = false }: { photo: Photo; editor?: boolean }) {
  const m = photo.metadata || {};
  const model = m.cameraModel || '', make = m.cameraMake || '';
  const camera = model.toLowerCase().startsWith(make.toLowerCase()) ? model || make : [make, model].filter(Boolean).join(' ');
  const seconds = m.exposureSeconds, denominator = seconds ? Math.round(1 / seconds) : 0;
  const exposure = seconds ? seconds < .5 && Math.abs(1 / denominator - seconds) / seconds < .02 ? '1/' + denominator + ' s' : Number(seconds.toPrecision(4)) + ' s' : '';
  const rows = [
    ['相机记录时间', m.recordedAt ? captureTimeText(m.recordedAt) + (m.utcOffset ? ' · UTC' + m.utcOffset : '') : '', 'wide'],
    ['相机', camera, 'wide'], ['镜头', m.lensModel || '', 'wide'],
    ['焦距', m.focalLengthMm ? m.focalLengthMm + ' mm' : '', ''],
    ['等效 35 mm 焦距', m.focalLength35Mm ? m.focalLength35Mm + ' mm' : '', ''],
    ['光圈', m.aperture ? 'f/' + m.aperture : '', ''], ['快门', exposure, ''],
    ['ISO', m.iso ? String(m.iso) : '', '']
  ].filter(([, value]) => value);
  if (!rows.length) return editor ? <p className="field-help metadata-empty">未读取到拍摄参数，可手动补充日期和时间。</p> : null;
  return <section className="metadata-section" aria-label="照片拍摄参数"><h3>拍摄参数<span>EXIF</span></h3>
    <dl className="photo-facts metadata-facts">{rows.map(([label, value, wide]) => <div key={label} className={wide ? 'metadata-wide' : ''}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {editor && <p className="field-help">从原文件读取。相机记录时间保留原值，缺少时区时不作转换。</p>}
  </section>;
}
export function PhotoDetails({ photo, campus, site, onOpen, showImage = true, photoPerspective = false, onPhotoPerspective }: { photo: Photo; campus: Campus; site: Site; onOpen: () => void; showImage?: boolean; photoPerspective?: boolean; onPhotoPerspective?: () => void }) {
  const view = photoFieldOfView(photo);
  const layer = campusLocations(campus, site).find(location => location.id === (photo.locationId ?? photo.buildingId))?.levelText || '室外';
  return <article className="photo-details">
    {showImage && <button className="detail-image" onClick={onOpen} aria-label={'查看大图：' + photo.title}><PhotoImage src={asset(photoPreviewFile(photo))} alt={photo.title} /><span>查看大图 <Plus size={14} /></span></button>}
    <div className="detail-copy"><p className="eyebrow">{photoLocation(photo, campus, site)}</p><h2>{photo.title}</h2>
      {photo.capturedAt && <time className="muted capture-time" dateTime={photo.capturedAt}>{captureTimeText(photo.capturedAt)}</time>}
      {onPhotoPerspective && <PhotoPerspectiveButton photo={photo} active={photoPerspective} onClick={onPhotoPerspective} />}
      {photo.description && <p className="description">{photo.description}</p>}
      <dl className="photo-credits" aria-label="作者与版权"><div><dt>作者</dt><dd>{photo.author || ''}</dd></div><div><dt>版权信息</dt><dd>{photo.copyright || ''}</dd></div></dl>
      <dl className="photo-facts">{isAerialPhoto(photo) && photo.altitude ? <div><dt>{altitudeLabel(photo)}</dt><dd>{photo.altitude.meters.toFixed(1)} m</dd></div> : !isAerialPhoto(photo) && <div><dt>所在楼层</dt><dd>{photo.floor > 0 ? photo.floor + ' 楼' : layer}</dd></div>}<div><dt>镜头朝向</dt><dd>{headingText(photo.heading)}</dd></div><div><dt>仰俯角</dt><dd>{photo.pitch > 0 ? '仰拍 ' : photo.pitch < 0 ? '俯拍 ' : '平拍 '}{Math.abs(photo.pitch)}°</dd></div><div><dt>图片尺寸</dt><dd>{photo.width} × {photo.height}</dd></div></dl>
      {view && <div className="photo-view-summary"><strong>水平视角约 {view.horizontal.toFixed(1)}°</strong><span>{viewSourceText(view)}</span></div>}
      <PhotoMetadataView photo={photo} />
      <a className="button secondary download-link" href={asset(photo.files.download)} download={photo.title.replace(/[\\/:*?"<>|]/g, '_') + '.jpg'}><Download size={16} />下载高清 JPEG<span>{sizeText(photo.downloadBytes)}</span></a>
    </div>
  </article>;
}
export function Lightbox({ photo, onClose, onPhotoPerspective }: { photo: Photo; onClose: () => void; onPhotoPerspective?: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const requestClose = useCallback(() => setClosing(true), []);
  const closeAction = useRef(onClose);
  closeAction.current = onClose;
  useEffect(() => {
    if (!closing) return;
    const timer = setTimeout(() => closeAction.current(), window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
    return () => clearTimeout(timer);
  }, [closing]);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastDistance = useRef(0);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestClose();
      if (event.key === 'Tab') {
        const elements = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button, a[href]') || []);
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown); before?.focus(); };
  }, [requestClose]);
  const changeZoom = (value: number) => { setZoom(Math.max(1, Math.min(5, value))); if (value <= 1) setPan({ x: 0, y: 0 }); };
  return <div className={'lightbox' + (closing ? ' is-closing' : '')} ref={dialog} role="dialog" aria-modal="true" aria-label={photo.title + ' 大图'}>
    <div className="lightbox-top"><div><strong>{photo.title}</strong><span>{photo.width} × {photo.height}</span></div><button className="icon-button inverse" onClick={requestClose} aria-label="关闭大图"><X /></button></div>
    <div className="lightbox-canvas" onWheel={e => { changeZoom(zoom - e.deltaY * 0.002); }}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastDistance.current = 0; }}
      onPointerMove={e => {
        const previous = pointers.current.get(e.pointerId); if (!previous) return;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const positions = Array.from(pointers.current.values());
        if (positions.length === 2) {
          const distance = Math.hypot(positions[0].x - positions[1].x, positions[0].y - positions[1].y);
          if (lastDistance.current) changeZoom(zoom * distance / lastDistance.current);
          lastDistance.current = distance;
        } else if (zoom > 1) setPan(p => ({ x: p.x + e.clientX - previous.x, y: p.y + e.clientY - previous.y }));
      }}
      onPointerUp={e => { pointers.current.delete(e.pointerId); lastDistance.current = 0; }}
      onPointerCancel={e => { pointers.current.delete(e.pointerId); lastDistance.current = 0; }}>
      <PhotoImage src={asset(photo.files.download)} alt={photo.title} loadingText="高清照片加载中…" style={{ transform: 'translate(' + pan.x + 'px,' + pan.y + 'px) scale(' + zoom + ')' }} />
    </div>
    <div className="lightbox-bottom"><div className="zoom-controls"><button className="icon-button inverse" onClick={() => changeZoom(zoom - .5)} disabled={zoom <= 1} aria-label="缩小照片"><Minus size={18} /></button><span>{Math.round(zoom * 100)}%</span><button className="icon-button inverse" onClick={() => changeZoom(zoom + .5)} disabled={zoom >= 5} aria-label="放大照片"><Plus size={18} /></button><button className="icon-button inverse" onClick={() => changeZoom(1)} aria-label="适应窗口"><RotateCcw size={17} /></button></div>{onPhotoPerspective && <button type="button" className="button light" onClick={onPhotoPerspective} disabled={!!photoPerspectiveIssue(photo)} title={photoPerspectiveIssue(photo) || undefined}><Camera size={16} />进入照片视角</button>}<a className="button light" href={asset(photo.files.download)} download={photo.title.replace(/[\\/:*?"<>|]/g, '_') + '.jpg'}><Download size={16} />下载高清 JPEG</a></div>
  </div>;
}

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';
import { asset, type Photo } from './types';
import { photoDisplayFile, photoPreviewFile } from './photo-image';
import { useAnimatedPresence } from './useAnimatedPresence';
import PhotoImage from './PhotoImage';
import PhotoInformation from './PhotoInformation';
import CardHandle, { type CardSizing } from './CardHandle';

export default function PhotoComparison({ children, photo, imageSource, highQuality = false, navigation, actions, information, onOpen, openLabel, openHelp, openDisabled, footerActions, sideBySide = false, card }: {
  children: ReactNode; photo?: Photo | null; imageSource?: string;
  highQuality?: boolean;
  navigation?: ReactNode; actions?: ReactNode; information?: ReactNode; onOpen?: () => void; openLabel?: string; openHelp?: string; openDisabled?: string; footerActions?: ReactNode;
  sideBySide?: boolean;
  card?: { style: CSSProperties; sizing: CardSizing };
}) {
  const presence = useAnimatedPresence(!!photo);
  const retained = useRef({ photo, imageSource, navigation, actions, information, onOpen, openLabel, openHelp, openDisabled, footerActions });
  if (photo) retained.current = { photo, imageSource, navigation, actions, information, onOpen, openLabel, openHelp, openDisabled, footerActions };
  const displayed = photo ? { photo, imageSource, navigation, actions, information, onOpen, openLabel, openHelp, openDisabled, footerActions } : retained.current;
  const displayedPhoto = photo || (presence.present ? displayed.photo : null);
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; share: number; length: number } | null>(null);
  const [wideShare, setWideShare] = useState(50);
  const [stackedShare, setStackedShare] = useState(35);
  const [stacked, setStacked] = useState(false);
  const [resizing, setResizing] = useState(false);
  const share = stacked ? stackedShare : wideShare;
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px) and (min-height: 520px)');
    const update = () => { drag.current = null; setStacked(!sideBySide && query.matches); };
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, [sideBySide]);
  const resize = (value: number) => (stacked ? setStackedShare : setWideShare)(Math.min(70, Math.max(30, value)));
  return <div ref={container} className={'photo-comparison' + (sideBySide ? ' is-side-by-side' : '') + (card ? ' is-overlay' : '') + (presence.visible ? ' is-split' : '') + (displayedPhoto && !photo ? ' is-closing' : '') + (resizing ? ' is-resizing' : '')}
    style={{ '--model-share': share + 'fr', '--photo-share': (100 - share) + 'fr' } as CSSProperties}>
    <section className="comparison-model" aria-label="校园模型">{children}</section>
    {displayedPhoto && <>{!card && <div className="comparison-divider" role="separator" tabIndex={photo ? 0 : -1} aria-hidden={!photo} inert={!photo} aria-label="调整模型与照片区域大小"
      aria-orientation={stacked ? 'horizontal' : 'vertical'} aria-valuemin={30} aria-valuemax={70} aria-valuenow={share}
      aria-valuetext={'模型 ' + Math.round(share) + '%，照片 ' + Math.round(100 - share) + '%'}
      onPointerDown={e => {
        if (e.button !== 0 || !container.current) return;
        setResizing(true);
        e.preventDefault(); e.currentTarget.blur(); e.currentTarget.setPointerCapture(e.pointerId);
        const rect = container.current.getBoundingClientRect();
        drag.current = { start: stacked ? e.clientY : e.clientX, share, length: stacked ? rect.height - 24 : rect.width - 24 };
      }}
      onPointerMove={e => { if (drag.current) resize(drag.current.share + ((stacked ? e.clientY : e.clientX) - drag.current.start) / Math.max(1, drag.current.length) * 100); }}
      onPointerUp={e => { drag.current = null; setResizing(false); if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { drag.current = null; setResizing(false); }} onLostPointerCapture={() => { drag.current = null; setResizing(false); }}
      onDoubleClick={() => resize(stacked ? 35 : 50)}
      onKeyDown={e => {
        const decrease = stacked ? 'ArrowUp' : 'ArrowLeft', increase = stacked ? 'ArrowDown' : 'ArrowRight';
        if (e.key === decrease || e.key === increase || e.key === 'Home') {
          e.preventDefault(); resize(e.key === 'Home' ? stacked ? 35 : 50 : share + (e.key === increase ? 2 : -2));
        }
      }}><span aria-hidden="true" /></div>}
      <section className="comparison-photo" style={card?.style} aria-label="原照片" aria-hidden={!photo} inert={!photo}>
        {card && <CardHandle label="调整照片预览卡片大小" sizing={card.sizing} />}
        <div className="comparison-heading"><div><span className="eyebrow">原照片</span><strong>{displayedPhoto.title}</strong></div>{displayed.navigation}</div>
        {displayed.information && <PhotoInformation photoId={displayedPhoto.id}>{displayed.information}</PhotoInformation>}
        {displayed.onOpen ? <button className="comparison-image" onClick={displayed.onOpen} disabled={!!displayed.openDisabled} aria-label={(displayed.openLabel || '全屏查看照片') + '：' + displayedPhoto.title}>
          <PhotoImage src={displayed.imageSource || asset(highQuality ? photoDisplayFile(displayedPhoto) : photoPreviewFile(displayedPhoto))} managed={highQuality && !displayed.imageSource} fallbackSrc={displayed.imageSource ? undefined : asset(displayedPhoto.files.thumbnail)} alt={displayedPhoto.title} />
          {!displayed.openLabel && <span><Maximize2 size={15} />全屏照片</span>}
        </button> : <div className="comparison-image"><PhotoImage src={displayed.imageSource || asset(highQuality ? photoDisplayFile(displayedPhoto) : photoPreviewFile(displayedPhoto))} managed={highQuality && !displayed.imageSource} fallbackSrc={displayed.imageSource ? undefined : asset(displayedPhoto.files.thumbnail)} alt={displayedPhoto.title} /></div>}
        {(displayed.openLabel || displayed.footerActions) && <div className={'comparison-overlay-actions' + (!displayed.footerActions ? ' is-single' : '')} role="group" aria-label="照片叠加与沉浸浏览">
          {displayed.openLabel && <button className="button primary" onClick={displayed.onOpen} disabled={!!displayed.openDisabled} title={displayed.openDisabled}><Maximize2 size={16} />{displayed.openLabel}</button>}
          {displayed.footerActions}
          {(displayed.openDisabled || displayed.openHelp) && <p className="field-help">{displayed.openDisabled || displayed.openHelp}</p>}
        </div>}
        {displayed.actions && <div className="comparison-actions">{displayed.actions}</div>}
      </section>
    </>}
  </div>;
}

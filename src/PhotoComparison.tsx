import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';
import { asset, type Photo } from './types';
import { photoPreviewFile } from './photo-image';
import { useAnimatedPresence } from './useAnimatedPresence';
import PhotoImage from './PhotoImage';

export default function PhotoComparison({ children, photo, imageSource, navigation, actions, information, onOpen }: {
  children: ReactNode; photo?: Photo | null; imageSource?: string;
  navigation?: ReactNode; actions?: ReactNode; information?: ReactNode; onOpen?: () => void;
}) {
  const presence = useAnimatedPresence(!!photo);
  const retained = useRef({ photo, imageSource, navigation, actions, information, onOpen });
  if (photo) retained.current = { photo, imageSource, navigation, actions, information, onOpen };
  const displayed = photo ? { photo, imageSource, navigation, actions, information, onOpen } : retained.current;
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
    const update = () => { drag.current = null; setStacked(query.matches); };
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const resize = (value: number) => (stacked ? setStackedShare : setWideShare)(Math.min(70, Math.max(30, value)));
  return <div ref={container} className={'photo-comparison' + (presence.visible ? ' is-split' : '') + (displayedPhoto && !photo ? ' is-closing' : '') + (resizing ? ' is-resizing' : '')}
    style={{ '--model-share': share + 'fr', '--photo-share': (100 - share) + 'fr' } as CSSProperties}>
    <section className="comparison-model" aria-label="校园模型">{children}</section>
    {displayedPhoto && <><div className="comparison-divider" role="separator" tabIndex={photo ? 0 : -1} aria-hidden={!photo} inert={!photo} aria-label="调整模型与照片区域大小"
      aria-orientation={stacked ? 'horizontal' : 'vertical'} aria-valuemin={30} aria-valuemax={70} aria-valuenow={share}
      aria-valuetext={'模型 ' + Math.round(share) + '%，照片 ' + Math.round(100 - share) + '%'}
      onPointerDown={e => {
        if (e.button !== 0 || !container.current) return;
        setResizing(true);
        e.preventDefault(); e.currentTarget.focus({ preventScroll: true }); e.currentTarget.setPointerCapture(e.pointerId);
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
      }}><span aria-hidden="true" /></div>
      <section className="comparison-photo" aria-label="原照片" aria-hidden={!photo} inert={!photo}>
        <div className="comparison-heading"><div><span className="eyebrow">原照片</span><strong>{displayedPhoto.title}</strong></div>{displayed.navigation}</div>
        {displayed.actions && <div className="comparison-actions">{displayed.actions}</div>}
        {displayed.information && <details className="comparison-information"><summary>照片资料与同地点照片</summary><div className="comparison-information-content">{displayed.information}</div></details>}
        {displayed.onOpen ? <button className="comparison-image" onClick={displayed.onOpen} aria-label={'全屏查看照片：' + displayedPhoto.title}>
          <PhotoImage src={displayed.imageSource || asset(photoPreviewFile(displayedPhoto))} fallbackSrc={displayed.imageSource ? undefined : asset(displayedPhoto.files.thumbnail)} alt={displayedPhoto.title} />
          <span><Maximize2 size={15} />全屏照片</span>
        </button> : <div className="comparison-image"><PhotoImage src={displayed.imageSource || asset(photoPreviewFile(displayedPhoto))} fallbackSrc={displayed.imageSource ? undefined : asset(displayedPhoto.files.thumbnail)} alt={displayedPhoto.title} /></div>}
      </section>
    </>}
  </div>;
}

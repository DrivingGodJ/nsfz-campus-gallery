import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Maximize2 } from 'lucide-react';
import { asset, type Photo } from './types';
import { photoPreviewFile } from './photo-image';

export default function PhotoComparison({ children, photo, imageSource, navigation, actions, information, onOpen }: {
  children: ReactNode; photo?: Photo | null; imageSource?: string;
  navigation?: ReactNode; actions?: ReactNode; information?: ReactNode; onOpen?: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ start: number; share: number; length: number } | null>(null);
  const [wideShare, setWideShare] = useState(50);
  const [stackedShare, setStackedShare] = useState(35);
  const [stacked, setStacked] = useState(false);
  const share = stacked ? stackedShare : wideShare;
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px) and (min-height: 520px)');
    const update = () => { drag.current = null; setStacked(query.matches); };
    update(); query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const resize = (value: number) => (stacked ? setStackedShare : setWideShare)(Math.min(70, Math.max(30, value)));
  return <div ref={container} className={'photo-comparison' + (photo ? ' is-split' : '')}
    style={{ '--model-share': share + 'fr', '--photo-share': (100 - share) + 'fr' } as CSSProperties}>
    <section className="comparison-model" aria-label="校园模型">{children}</section>
    {photo && <><div className="comparison-divider" role="separator" tabIndex={0} aria-label="调整模型与照片区域大小"
      aria-orientation={stacked ? 'horizontal' : 'vertical'} aria-valuemin={30} aria-valuemax={70} aria-valuenow={share}
      aria-valuetext={'模型 ' + Math.round(share) + '%，照片 ' + Math.round(100 - share) + '%'}
      onPointerDown={e => {
        if (e.button !== 0 || !container.current) return;
        e.preventDefault(); e.currentTarget.focus({ preventScroll: true }); e.currentTarget.setPointerCapture(e.pointerId);
        const rect = container.current.getBoundingClientRect();
        drag.current = { start: stacked ? e.clientY : e.clientX, share, length: stacked ? rect.height - 24 : rect.width - 24 };
      }}
      onPointerMove={e => { if (drag.current) resize(drag.current.share + ((stacked ? e.clientY : e.clientX) - drag.current.start) / Math.max(1, drag.current.length) * 100); }}
      onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
      onDoubleClick={() => resize(stacked ? 35 : 50)}
      onKeyDown={e => {
        const decrease = stacked ? 'ArrowUp' : 'ArrowLeft', increase = stacked ? 'ArrowDown' : 'ArrowRight';
        if (e.key === decrease || e.key === increase || e.key === 'Home') {
          e.preventDefault(); resize(e.key === 'Home' ? stacked ? 35 : 50 : share + (e.key === increase ? 2 : -2));
        }
      }}><span aria-hidden="true" /></div>
      <section className="comparison-photo" aria-label="原照片">
        <div className="comparison-heading"><div><span className="eyebrow">原照片</span><strong>{photo.title}</strong></div>{navigation}</div>
        {onOpen ? <button className="comparison-image" onClick={onOpen} aria-label={'全屏查看照片：' + photo.title}>
          <img src={imageSource || asset(photoPreviewFile(photo))} alt={photo.title} draggable={false} decoding="async" />
          <span><Maximize2 size={15} />全屏照片</span>
        </button> : <div className="comparison-image"><img src={imageSource || asset(photoPreviewFile(photo))} alt={photo.title} draggable={false} decoding="async" /></div>}
        {actions && <div className="comparison-actions">{actions}</div>}
        {information && <details className="comparison-information"><summary>照片资料与同地点照片</summary><div className="comparison-information-content">{information}</div></details>}
      </section>
    </>}
  </div>;
}

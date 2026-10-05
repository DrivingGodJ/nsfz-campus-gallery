import { useRef, type CSSProperties } from 'react';

export type CardSizing = { value: number; min: number; max: number; initial: number; length: number; onChange: (value: number) => void };

export default function CardHandle({ label, sizing }: { label: string; sizing: CardSizing }) {
  const drag = useRef<{ id: number; y: number; value: number } | null>(null);
  const resize = (value: number) => sizing.onChange(Math.max(sizing.min, Math.min(sizing.max, value)));
  return <div className="card-handle" role="separator" tabIndex={0} aria-label={label} title="上下拖动调整卡片大小"
    aria-orientation="horizontal" aria-valuemin={Math.round(sizing.min)} aria-valuemax={Math.round(sizing.max)}
    aria-valuenow={Math.round(sizing.value)} aria-valuetext={'卡片高度 ' + Math.round(sizing.value) + '%'}
    style={{ '--card-size': sizing.value } as CSSProperties}
    onPointerDown={e => {
      if (e.button !== 0 || !sizing.length) return;
      e.preventDefault(); e.stopPropagation(); e.currentTarget.blur();
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: e.pointerId, y: e.clientY, value: sizing.value };
    }}
    onPointerMove={e => { if (drag.current?.id === e.pointerId) { e.preventDefault(); resize(drag.current.value - (e.clientY - drag.current.y) / sizing.length * 100); } }}
    onPointerUp={e => { drag.current = null; if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => resize(sizing.initial)}
    onKeyDown={e => {
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault(); resize(e.key === 'Home' ? sizing.initial : e.key === 'End' ? sizing.max : sizing.value + (e.key === 'ArrowUp' ? 5 : -5));
      }
    }}><span aria-hidden="true" /></div>;
}

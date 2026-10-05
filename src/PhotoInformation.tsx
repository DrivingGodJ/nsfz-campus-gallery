import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronDown, FileText } from 'lucide-react';

export default function PhotoInformation({ photoId, children }: { photoId: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const panelId = useId();
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const updateScrollHint = () => {
    const viewport = scroll.current;
    setCanScrollDown(!!viewport && viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop > 4);
  };

  useEffect(() => {
    if (!expanded || !scroll.current || !content.current) return;
    scroll.current.scrollTop = 0;
    updateScrollHint();
    const observer = new ResizeObserver(updateScrollHint);
    observer.observe(scroll.current);
    observer.observe(content.current);
    return () => observer.disconnect();
  }, [expanded, photoId]);

  return <div className={'comparison-information' + (expanded ? ' is-open' : '')}>
    <button type="button" className="button secondary comparison-information-toggle"
      aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>
      <FileText size={17} aria-hidden="true" />
      <span>照片资料与同地点照片</span>
      <small>{expanded ? '收起' : '展开'}</small>
      <ChevronDown size={17} className="comparison-information-chevron" aria-hidden="true" />
    </button>
    <div id={panelId} className="comparison-information-body" hidden={!expanded}>
      {expanded && <>
        <div ref={scroll} className="comparison-information-scroll" role="region" tabIndex={0}
          aria-label="照片资料与同地点照片" aria-describedby={canScrollDown ? panelId + '-hint' : undefined}
          onScroll={updateScrollHint}>
          <div ref={content} className="comparison-information-content">{children}</div>
        </div>
        {canScrollDown && <div id={panelId + '-hint'} className="comparison-information-scroll-hint">
          <span><ArrowDown size={14} aria-hidden="true" />向下滑动查看更多</span>
        </div>}
      </>}
    </div>
  </div>;
}

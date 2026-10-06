import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';
import { loadCachedImageElement } from './photo-image-cache';

type PhotoImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onLoad' | 'onError'> & {
  src: string; fallbackSrc?: string; loadingText?: string; managed?: boolean;
};

function ImageWithFeedback({ src, fallbackSrc, loadingText = '照片加载中…', managed = false, decoding = 'async', draggable = false, fetchPriority = 'high', ...props }: PhotoImageProps) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [fallbackReady, setFallbackReady] = useState(false);
  const [loadedSource, setLoadedSource] = useState<string>();
  useEffect(() => {
    const controller = new AbortController();
    if (managed) {
      void loadCachedImageElement(src, '照片加载失败，请稍后刷新重试', controller.signal)
        .then(full => { if (!controller.signal.aborted) { setLoadedSource(full.src); setState('loaded'); } })
        .catch(() => { if (!controller.signal.aborted) setState('error'); });
      if (image.current?.complete && image.current.naturalWidth && fallbackSrc) setFallbackReady(true);
      return () => controller.abort();
    }
    const full = new Image();
    full.decoding = decoding;
    full.fetchPriority = fetchPriority;
    if (props.crossOrigin) full.crossOrigin = props.crossOrigin;
    if (props.referrerPolicy) full.referrerPolicy = props.referrerPolicy;
    full.onload = async () => {
      try { await full.decode(); } catch { /* onload confirms a usable image on older browsers. */ }
      if (!controller.signal.aborted) { setLoadedSource(src); setState('loaded'); }
    };
    full.onerror = () => { if (!controller.signal.aborted) setState('error'); };
    full.src = src;
    // A cached thumbnail may finish before React attaches its load listener.
    if (image.current?.complete && image.current.naturalWidth && fallbackSrc) setFallbackReady(true);
    return () => { controller.abort(); full.onload = null; full.onerror = null; if (!full.complete) full.removeAttribute('src'); };
  }, [src, fallbackSrc, managed, decoding, fetchPriority, props.crossOrigin, props.referrerPolicy]);
  const showingFallback = state !== 'loaded' && !!fallbackSrc;
  return <><img {...props} src={showingFallback ? fallbackSrc : managed ? loadedSource : src} ref={image} decoding={decoding} draggable={draggable} fetchPriority={fetchPriority}
    data-load-state={state === 'loaded' ? 'loaded' : showingFallback && fallbackReady ? 'preview' : state}
    aria-busy={state === 'loading'} onLoad={() => { if (showingFallback) setFallbackReady(true); }}
    onError={() => { if (showingFallback) setFallbackReady(false); else setState('error'); }} />
    {state !== 'loaded' && <span className={'photo-image-status' + (showingFallback && fallbackReady ? ' has-preview' : '')} role="status" aria-live="polite">
      {state === 'loading' && <LoaderCircle className="photo-image-spinner" size={22} aria-hidden="true" />}
      {state === 'loading' ? loadingText : '照片加载失败，请稍后刷新重试'}
    </span>}
  </>;
}

// Remount on source changes so a previous image's loaded state never hides feedback.
export default function PhotoImage(props: PhotoImageProps) {
  return <ImageWithFeedback key={props.src} {...props} />;
}

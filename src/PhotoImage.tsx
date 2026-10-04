import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';

type PhotoImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onLoad' | 'onError'> & {
  src: string; fallbackSrc?: string; loadingText?: string;
};

function ImageWithFeedback({ src, fallbackSrc, loadingText = '照片加载中…', decoding = 'async', draggable = false, fetchPriority = 'high', ...props }: PhotoImageProps) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [fallbackReady, setFallbackReady] = useState(false);
  useEffect(() => {
    let active = true;
    const full = new Image();
    full.decoding = decoding;
    full.fetchPriority = fetchPriority;
    if (props.crossOrigin) full.crossOrigin = props.crossOrigin;
    if (props.referrerPolicy) full.referrerPolicy = props.referrerPolicy;
    full.onload = async () => {
      try { await full.decode(); } catch { /* onload confirms a usable image on older browsers. */ }
      if (active) setState('loaded');
    };
    full.onerror = () => { if (active) setState('error'); };
    full.src = src;
    // A cached thumbnail may finish before React attaches its load listener.
    if (image.current?.complete && image.current.naturalWidth && fallbackSrc) setFallbackReady(true);
    return () => { active = false; full.onload = null; full.onerror = null; };
  }, [src, fallbackSrc, decoding, fetchPriority, props.crossOrigin, props.referrerPolicy]);
  const showingFallback = state !== 'loaded' && !!fallbackSrc;
  return <><img {...props} src={showingFallback ? fallbackSrc : src} ref={image} decoding={decoding} draggable={draggable} fetchPriority={fetchPriority}
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

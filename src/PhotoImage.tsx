import { useEffect, useRef, useState, type ImgHTMLAttributes } from 'react';
import { LoaderCircle } from 'lucide-react';

type PhotoImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onLoad' | 'onError'> & {
  src: string; loadingText?: string;
};

function ImageWithFeedback({ loadingText = '照片加载中…', decoding = 'async', draggable = false, ...props }: PhotoImageProps) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');
  // Cached images can finish before React attaches its load listener.
  useEffect(() => {
    if (image.current?.complete) setState(image.current.naturalWidth ? 'loaded' : 'error');
  }, []);
  return <><img {...props} ref={image} decoding={decoding} draggable={draggable} data-load-state={state}
    aria-busy={state === 'loading'} onLoad={() => setState('loaded')} onError={() => setState('error')} />
    {state !== 'loaded' && <span className="photo-image-status" role="status" aria-live="polite">
      {state === 'loading' && <LoaderCircle className="photo-image-spinner" size={22} aria-hidden="true" />}
      {state === 'loading' ? loadingText : '照片加载失败，请稍后刷新重试'}
    </span>}
  </>;
}

// Remount on source changes so a previous image's loaded state never hides feedback.
export default function PhotoImage(props: PhotoImageProps) {
  return <ImageWithFeedback key={props.src} {...props} />;
}

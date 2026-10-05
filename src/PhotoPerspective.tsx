import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera } from 'lucide-react';
import type { Photo } from './types';
import { photoFrameSize, photoPerspectiveIssue } from './photo-perspective';
import { FULL_MAP_VIEWPORT, type MapViewport } from './map-card-viewport';

export function PhotoPerspectiveButton({ photo, active, editor = false, compact = false, disabled = false, onClick }: { photo: Photo; active: boolean; editor?: boolean; compact?: boolean; disabled?: boolean; onClick: () => void }) {
  const issue = photoPerspectiveIssue(photo);
  return <div className="photo-perspective-action">
    <button type="button" className={'button full-width ' + (active ? 'secondary' : 'primary')} aria-pressed={active} onClick={onClick} disabled={disabled || (!active && !!issue)} title={issue || undefined}>
      {active ? <ArrowLeft size={16} /> : <Camera size={16} />}{active ? '返回地图视角' : editor ? '照片视角 · 调整角度' : '进入照片视角'}
    </button>
    {(!compact || issue) && <p className="field-help">{issue || (editor ? '进入照片视角后，对照原图拖动模型，校准方向和仰俯角；松手后角度会同步到这张照片。' : '从拍摄位置查看校园，镜头与照片保存的方向一致。')}</p>}
  </div>;
}

export function PhotoPerspectiveOverlay({ photo, viewport = FULL_MAP_VIEWPORT }: { photo: Photo; viewport?: MapViewport }) {
  const container = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(1);
  useEffect(() => {
    const node = container.current;
    if (!node) return;
    const resize = () => setAspect(node.clientWidth / Math.max(1, node.clientHeight));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const frame = photoFrameSize(photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 1.5, aspect);
  return <div ref={container} className="photo-perspective-overlay" style={{ left: viewport.left * 100 + '%', top: viewport.top * 100 + '%', width: viewport.width * 100 + '%', height: viewport.height * 100 + '%', right: 'auto', bottom: 'auto' }}>
    <div className="photo-perspective-frame" style={{ width: frame.width * 100 + '%', height: frame.height * 100 + '%' }} aria-hidden="true" />
  </div>;
}

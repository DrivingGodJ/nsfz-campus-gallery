import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera } from 'lucide-react';
import type { Photo } from './types';
import { photoFrameSize, photoPerspectiveIssue } from './photo-perspective';

export function PhotoPerspectiveButton({ photo, active, editor = false, compact = false, onClick }: { photo: Photo; active: boolean; editor?: boolean; compact?: boolean; onClick: () => void }) {
  const issue = photoPerspectiveIssue(photo);
  return <div className="photo-perspective-action">
    <button type="button" className={'button full-width ' + (active ? 'secondary' : 'primary')} aria-pressed={active} onClick={onClick} disabled={!active && !!issue} title={issue || undefined}>
      {active ? <ArrowLeft size={16} /> : <Camera size={16} />}{active ? '返回地图视角' : editor ? '体验拍摄视角' : '进入照片视角'}
    </button>
    {(!compact || issue) && <p className="field-help">{issue || (editor ? '拖动预览画面调整角度，松手后同步朝向和仰俯角；也可调整楼层与焦距。' : '从拍摄位置查看校园，镜头与照片保存的方向一致。')}</p>}
  </div>;
}

export function PhotoPerspectiveOverlay({ photo }: { photo: Photo }) {
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
  return <div ref={container} className="photo-perspective-overlay">
    <div className="photo-perspective-frame" style={{ width: frame.width * 100 + '%', height: frame.height * 100 + '%' }} aria-hidden="true" />
  </div>;
}

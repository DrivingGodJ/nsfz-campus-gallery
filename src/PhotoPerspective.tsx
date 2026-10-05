import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Camera, Layers, LoaderCircle, Mountain, Sparkles, Square, X } from 'lucide-react';
import { asset, type Photo } from './types';
import { photoPreviewFile } from './photo-image';
import PhotoImage from './PhotoImage';
import { photoAspect, photoFrameSize, photoPerspectiveIssue } from './photo-perspective';
import type { DepthSource } from './depth-source';
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

export function PhotoTransitionButton({ active, disabled = false, onClick }: { active: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={'button ' + (active ? 'secondary' : 'primary')} aria-pressed={active} disabled={disabled}
    title={active ? '撤下覆盖在校园模型上的照片' : '立刻把照片盖在校园模型上，不做扫描；想要扫描式覆盖请用下方深度图转场'} onClick={onClick}>
    {active ? <X size={16} /> : <Layers size={16} />}{active ? '关闭照片覆盖' : '开启照片覆盖'}
  </button>;
}

export function DepthMapButton({ busy, source = 'model', disabled = false, onClick }: { busy: boolean; source?: DepthSource; disabled?: boolean; onClick: () => void }) {
  const photo = source === 'photo';
  return <button type="button" className="button secondary" disabled={disabled || busy} aria-busy={busy}
    title={photo ? '载入这张照片预计算的黑白深度图（Depth Anything V2 从照片本身估计，近处为黑、远处为白，只有相对远近）' : '按当前照片视角把校园模型渲染成黑白深度图，近处为黑、300 米外与天空为白'} onClick={onClick}>
    {busy ? <LoaderCircle className="photo-image-spinner" size={16} aria-hidden="true" /> : <Mountain size={16} aria-hidden="true" />}{busy ? (photo ? '载入中…' : '渲染中…') : photo ? '载入照片深度图' : '渲染深度图'}
  </button>;
}

// Two sources, so a segmented control rather than a dropdown: it stays legible
// inside the collapsed-ish tool panel and shows at a glance which one is active.
export function DepthSourceToggle({ source, photoAvailable, disabled = false, onChange }: { source: DepthSource; photoAvailable: boolean; disabled?: boolean; onChange: (source: DepthSource) => void }) {
  return <div className="depth-source" role="group" aria-label="深度图来源">
    <span className="depth-source-label">深度图来源</span>
    <div className="depth-source-options">
      <button type="button" className="depth-source-option" aria-pressed={source === 'model'} disabled={disabled}
        title="按当前照片视角渲染校园模型：几何精确，但模型是低模，深度图只有几块平面" onClick={() => onChange('model')}>模型</button>
      <button type="button" className="depth-source-option" aria-pressed={source === 'photo'} disabled={disabled || !photoAvailable}
        title={photoAvailable ? 'Depth Anything V2 从照片本身估计深度：细节跟随真实场景，但只有相对远近、没有米数' : '这张照片还没有预计算的深度图，先在维护者机器上运行 npm run photos:depth'} onClick={() => onChange('photo')}>照片</button>
    </div>
  </div>;
}

export function DepthOverlayButton({ active, disabled = false, onClick }: { active: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={'button ' + (active ? 'secondary' : 'primary')} aria-pressed={active} disabled={disabled}
    title={disabled ? '先渲染一张深度图' : '把深度图半透明地叠在校园模型上，用来核对模型与照片是否对齐'} onClick={onClick}>
    <Mountain size={16} aria-hidden="true" />{active ? '取消叠加' : '叠加深度图'}
  </button>;
}

export function DepthTransitionButton({ playing, armed, disabled = false, onClick }: { playing: boolean; armed: boolean; disabled?: boolean; onClick: () => void }) {
  return <button type="button" className={'button ' + (armed ? 'secondary' : 'primary')} aria-pressed={playing} disabled={disabled}
    title={disabled ? '先渲染一张深度图' : '从远到近、由白到黑把深度图换成照片，交界处留下一道可自定义颜色的亮线'} onClick={onClick}>
    {playing ? <Square size={16} aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}{playing ? '停止转场' : armed ? '重播转场' : '深度图转场'}
  </button>;
}

// The frame matches the photo's field of view exactly, so the same image can be
// laid over the rendering to compare the archive picture with the campus model.
// The depth map is drawn first so a real photo always covers it.
export function PhotoPerspectiveOverlay({ photo, viewport = FULL_MAP_VIEWPORT, showPhoto = false, imageSource, depthOverlay, children }: { photo: Photo; viewport?: MapViewport; showPhoto?: boolean; imageSource?: string; depthOverlay?: string; children?: ReactNode }) {
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
  const frame = photoFrameSize(photoAspect(photo), aspect);
  const source = imageSource || asset(photoPreviewFile(photo));
  return <div ref={container} className="photo-perspective-overlay" style={{ left: viewport.left * 100 + '%', top: viewport.top * 100 + '%', width: viewport.width * 100 + '%', height: viewport.height * 100 + '%', right: 'auto', bottom: 'auto' }}>
    <div className="photo-perspective-frame" style={{ width: frame.width * 100 + '%', height: frame.height * 100 + '%' }} aria-hidden="true">
      {depthOverlay && <img className="depth-map-layer" src={depthOverlay} alt="" draggable={false} />}
      {showPhoto && <PhotoImage src={source} fallbackSrc={imageSource ? undefined : asset(photo.files.thumbnail)} alt="" loadingText="照片转场载入中…" />}
      {children}
    </div>
  </div>;
}

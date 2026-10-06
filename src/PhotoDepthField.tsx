import { useRef } from 'react';
import { ImagePlus, WandSparkles, X } from 'lucide-react';

export default function PhotoDepthField({ attached, disabled, onChoose, onRemove, onGenerate, generationError }: {
  attached?: string; disabled?: boolean; onChoose: (file: File) => void; onRemove: () => void;
  onGenerate?: () => void; generationError?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="photo-depth-field">
    <strong>配套深度图 <small>可选</small></strong>
    <div className="photo-depth-actions"><button type="button" className="button secondary" disabled={disabled} onClick={() => input.current?.click()}><ImagePlus size={16} />{attached ? '更换深度图' : '上传深度图'}</button>
      {onGenerate && <button type="button" className="button secondary" disabled={disabled} onClick={onGenerate}><WandSparkles size={16} />{attached ? '重新生成' : '生成深度图'}</button>}
      {attached && <button type="button" className="icon-button" disabled={disabled} aria-label="移除配套深度图" title="移除深度图" onClick={onRemove}><X size={16} /></button>}
    </div>
    {attached && <span className="photo-depth-filename">{attached}</span>}
    {onGenerate && <p className="field-help">导入照片后自动在本机生成，无需上传到外部服务。深度图已压缩，生成失败时可以重试或手动上传。</p>}
    {generationError && <p className="field-help" role="status">{generationError}</p>}
    <p className="field-help">近处为黑、远处为白；方向、画面范围和宽高比例与照片一致。支持 PNG、JPEG、WebP，最多 10 MB。用于进入和退出沉浸看照片时的转场；半透明叠加无需深度图。</p>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" aria-label="配套深度图" hidden disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onChoose(file); }} />
  </div>;
}

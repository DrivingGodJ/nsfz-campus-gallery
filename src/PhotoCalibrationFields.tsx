import { headingText, type Campus, type Photo, type Site } from './types';
import { campusFilterLocations, photoLocationId } from './locations';
import { photoFieldOfView, viewSourceText } from './photo-view';
import LocationOptions from './LocationOptions';
import PhotoPositionFields from './PhotoPositionFields';
import PhotoNumberInput from './PhotoNumberInput';

export default function PhotoCalibrationFields({ photo, campus, site, previewing, onChange, onLocation }: {
  photo: Photo; campus: Campus; site: Site; previewing: boolean;
  onChange: (update: Partial<Photo>) => void; onLocation: (id: string) => void;
}) {
  const locationId = photoLocationId(photo, campus);
  const locationAllowed = !locationId || campusFilterLocations(campus, site).some(item => item.id === locationId);
  const view = photoFieldOfView(photo);
  return <section className="photo-calibration-fields" aria-label="照片视角参数">
    <div className="form-divider">拍摄位置与镜头</div>
    {previewing && <p className="field-help">参数修改会立即更新当前视角，也可以直接拖动模型调整朝向和仰俯角。</p>}
    <label>拍摄地点<select aria-label="拍摄地点" value={locationAllowed ? locationId : 'legacy-location'} onChange={e => onLocation(e.target.value)}>
      {!locationAllowed && <option value="legacy-location" disabled>请重新选择地点</option>}
      <option value="">校园室外（未指定地点）</option><LocationOptions campus={campus} site={site} />
    </select></label>
    {!locationAllowed && <p className="field-help" role="status">原来标注的小地点已停止使用，请选择主要建筑、校园区域或通道后保存。</p>}
    <PhotoPositionFields photo={photo} campus={campus} site={site} onChange={onChange} />
    <div className="field-pair">
      <label>东西位置 / m<PhotoNumberInput name="positionX" step={.1} value={photo.position.x} onValue={value => {
        if (value !== undefined) onChange({ position: { ...photo.position, x: value }, placed: true });
      }} /></label>
      <label>南北位置 / m<PhotoNumberInput name="positionZ" step={.1} value={photo.position.z} onValue={value => {
        if (value !== undefined) onChange({ position: { ...photo.position, z: value }, placed: true });
      }} /></label>
    </div>
    <div className="field-pair">
      <label>水平朝向 / °<PhotoNumberInput name="heading" min={0} max={360} step={.1} value={photo.heading} onValue={value => {
        if (value !== undefined) onChange({ heading: value % 360 });
      }} /></label>
      <label>仰俯角 / °<PhotoNumberInput name="pitch" min={-90} max={90} step={.1} value={photo.pitch} onValue={value => {
        if (value !== undefined) onChange({ pitch: value });
      }} /></label>
    </div>
    <label>调整水平朝向<span className="range-value">{headingText(photo.heading)}</span><input type="range" aria-label="调整水平朝向" min={0} max={360} step={.1} value={photo.heading} onChange={e => onChange({ heading: Number(e.target.value) % 360 })} /></label>
    <label>调整仰俯角<span className="range-value">{photo.pitch > 0 ? '仰拍' : photo.pitch < 0 ? '俯拍' : '平拍'} · {Number(Math.abs(photo.pitch).toFixed(1))}°</span><input type="range" aria-label="调整仰俯角" min={-90} max={90} step={.1} value={photo.pitch} onChange={e => onChange({ pitch: Number(e.target.value) })} /></label>
    {!previewing && <p className="field-help">也可拖动地图上的方向手柄调整朝向。</p>}
    {!photo.metadata?.focalLength35Mm && photo.metadata?.focalLengthMm && <label>相机画幅<select value={photo.view?.cropFactor ?? ''} onChange={e => onChange({ view: { ...photo.view, cropFactor: e.target.value ? Number(e.target.value) : undefined } })}>
      <option value="">待确认（先按全画幅估算）</option><option value="1">全画幅 · 1×</option><option value="1.5">APS-C · 1.5×</option><option value="1.6">佳能 APS-C · 1.6×</option><option value="2">M4/3 · 2×</option>
    </select></label>}
    <label>等效 35 mm 焦距 / mm<PhotoNumberInput name="focalLength35Mm" allowEmpty min={1} max={10000} step={.1} placeholder={photo.metadata?.focalLength35Mm ? String(photo.metadata.focalLength35Mm) : '留空自动使用照片参数'} value={photo.view?.focalLength35Mm} onValue={value => onChange({ view: { ...photo.view, focalLength35Mm: value } })} /></label>
    {view ? <div className="photo-view-summary" role="status"><strong>水平视角约 {view.horizontal.toFixed(1)}°</strong><span>{viewSourceText(view)}</span></div> : <p className="field-help">未读取到焦距。补充等效焦距后，可以进入照片视角。</p>}
    <p className="field-help">焦距越短，画面越宽。留空恢复原片的镜头参数。</p>
  </section>;
}

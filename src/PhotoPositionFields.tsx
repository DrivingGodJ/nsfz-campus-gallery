import { buildingInfo, type Campus, type Photo, type Site } from './types';
import { buildingFloorText } from './building-model';
import PhotoNumberInput from './PhotoNumberInput';
import { aerialImportText, altitudeLabel, campusLocations, isAerialPhoto, photoCameraHeightRange, photoLocationId } from './locations';

export default function PhotoPositionFields({ photo, campus, site, onChange }: { photo: Photo; campus: Campus; site: Site; onChange: (update: Partial<Photo>) => void }) {
  const aerial = isAerialPhoto(photo);
  const location = campusLocations(campus, site).find(item => item.id === photoLocationId(photo, campus));
  const info = location?.building ? buildingInfo(location.building, site) : null;
  const source = photo.metadata?.aerial;
  const cameraRange = photoCameraHeightRange(photo, campus, site);
  return <>
    <label>拍摄方式<select value={aerial ? 'aerial' : 'ground'} onChange={e => {
      const captureType = e.target.value as 'ground' | 'aerial';
      const altitude = captureType === 'aerial' ? photo.altitude ?? (source?.relativeAltitude !== undefined
        ? { meters: source.relativeAltitude, reference: 'takeoff' as const }
        : source?.absoluteAltitude !== undefined ? { meters: source.absoluteAltitude, reference: 'seaLevel' as const } : undefined) : undefined;
      onChange({ captureType, cameraHeight: undefined, floor: captureType === 'aerial' ? 0 : info ? Math.max(1, photo.floor) : 0,
        altitude, position: { x: photo.position.x, z: photo.position.z } });
    }}><option value="ground">普通照片</option><option value="aerial">航拍照片</option></select></label>
    {aerial ? <>
      <p className="field-help" role="status">{aerialImportText(photo)}</p>
      {Number.isFinite(source?.latitude) && Number.isFinite(source?.longitude) && <p className="field-help">照片经纬度：{source!.latitude!.toFixed(6)}，{source!.longitude!.toFixed(6)}</p>}
      <div className="field-pair"><label>{altitudeLabel(photo)} / m<PhotoNumberInput name="altitude" min={-12000} max={100000} step={.1} placeholder="补充航拍高度" value={photo.altitude?.meters} onValue={value => { if (value !== undefined) onChange({ altitude: { meters: value, reference: photo.altitude?.reference || 'takeoff' } }); }} /></label>
        <label>高度基准<select value={photo.altitude?.reference || 'takeoff'} disabled={!photo.altitude} onChange={e => {
          const reference = e.target.value as 'takeoff' | 'seaLevel';
          const recorded = reference === 'takeoff' ? source?.relativeAltitude : source?.absoluteAltitude;
          onChange({ altitude: { meters: recorded ?? photo.altitude?.meters ?? 0, reference } });
        }}><option value="takeoff">相对起飞点</option><option value="seaLevel">海拔</option></select></label></div>
    </> : <>
      <label>{info ? '所在楼层' : '所在层面'}<select value={photo.floor} disabled={!info} onChange={e => onChange({ floor: Number(e.target.value), cameraHeight: undefined, position: { x: photo.position.x, z: photo.position.z } })}>
        {!info ? <option value={0}>{location?.levelText || '室外'}</option> : Array.from({ length: Math.max(info.floors, photo.floor) }, (_, i) => <option key={i} value={i + 1}>{i + 1} 楼{i + 1 > info.baseFloors ? '（局部）' : ''}</option>)}
      </select></label>
      <p className="field-help">{location?.feature?.type === 'tunnelEntrance' ? '点击入口的台阶标记拍摄位置，高度会随台阶自动确定，无需填写楼层。' : <>地图位置随楼层显示。{info && info.sections.length > 1 && <> 此楼分为{buildingFloorText(info)}。</>}</>}</p>
      <label>镜头离{info ? '楼面' : '地面'}高度 / m<PhotoNumberInput name="cameraHeight" min={cameraRange.min} max={cameraRange.max} step={.1} value={Math.min(cameraRange.max, Math.max(cameraRange.min, photo.cameraHeight ?? 1.6))} onValue={value => {
        if (value !== undefined) onChange({ cameraHeight: Math.min(cameraRange.max, Math.max(cameraRange.min, value)) });
      }} /></label>
      <p className="field-help">↑/↓ 微调高度，范围 {cameraRange.min}–{Number(cameraRange.max.toFixed(2))} 米；不会跨越当前楼层。</p>
    </>}
    <p className="field-help">可从列表选择地点，也可点击地图上的名称。</p>
  </>;
}

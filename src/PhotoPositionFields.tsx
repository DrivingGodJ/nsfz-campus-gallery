import { buildingInfo, type Campus, type Photo, type Site } from './types';
import { buildingFloorText } from './building-model';
import PhotoNumberInput from './PhotoNumberInput';
import { aerialImportText, altitudeLabel, campusLocations, isAerialPhoto, photoLocationId } from './locations';

export default function PhotoPositionFields({ photo, campus, site, onChange }: { photo: Photo; campus: Campus; site: Site; onChange: (update: Partial<Photo>) => void }) {
  const aerial = isAerialPhoto(photo);
  const location = campusLocations(campus, site).find(item => item.id === photoLocationId(photo, campus));
  const info = location?.building ? buildingInfo(location.building, site) : null;
  const source = photo.metadata?.aerial;
  return <>
    <label>拍摄方式<select value={aerial ? 'aerial' : 'ground'} onChange={e => {
      const captureType = e.target.value as 'ground' | 'aerial';
      const altitude = captureType === 'aerial' ? photo.altitude ?? (source?.relativeAltitude !== undefined
        ? { meters: source.relativeAltitude, reference: 'takeoff' as const }
        : source?.absoluteAltitude !== undefined ? { meters: source.absoluteAltitude, reference: 'seaLevel' as const } : undefined) : undefined;
      onChange({ captureType, floor: captureType === 'aerial' ? 0 : info ? Math.max(1, photo.floor) : 0,
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
      <label>{info ? '所在楼层' : '所在层面'}<select value={photo.floor} disabled={!info} onChange={e => onChange({ floor: Number(e.target.value), position: { x: photo.position.x, z: photo.position.z } })}>
        {!info ? <option value={0}>{location?.levelText || '室外'}</option> : Array.from({ length: Math.max(info.floors, photo.floor) }, (_, i) => <option key={i} value={i + 1}>{i + 1} 楼{i + 1 > info.baseFloors ? '（局部）' : ''}</option>)}
      </select></label>
      <p className="field-help">普通照片只记录楼层，地图位置随楼层显示。{info && info.sections.length > 1 && <> 此楼分为{buildingFloorText(info)}。</>}</p>
    </>}
    <p className="field-help">可从列表选择地点，也可点击地图上的名称。</p>
  </>;
}

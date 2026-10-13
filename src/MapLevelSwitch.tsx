import type { MapLevelMode } from './map-level-mode';

export type { MapLevelMode } from './map-level-mode';

export default function MapLevelSwitch({ mode, onChange }: { mode: MapLevelMode; onChange: (mode: MapLevelMode) => void }) {
  return <div className="map-level-switch" role="group" aria-label="地图显示模式">
    <button type="button" aria-label="天上" aria-pressed={mode === 'aerial'} title="只显示航拍照片；建筑与地图和地上模式一致" onClick={() => onChange('aerial')}><span className="level-label-full">天上</span><span className="level-label-short" aria-hidden="true">天上</span></button>
    <button type="button" aria-label="地上" aria-pressed={mode === 'surface'} title="查看地上校园照片；地下设施按真实墙体和入口遮挡显示" onClick={() => onChange('surface')}><span className="level-label-full">地上</span><span className="level-label-short" aria-hidden="true">地上</span></button>
    <button type="button" aria-label="地下" aria-pressed={mode === 'underground'} title="查看地下照片与空间；视野移到地下，地上建筑淡化" onClick={() => onChange('underground')}><span className="level-label-full">地下</span><span className="level-label-short" aria-hidden="true">地下</span></button>
  </div>;
}

export type MapLevelMode = 'surface' | 'underground';

export default function MapLevelSwitch({ mode, onChange }: { mode: MapLevelMode; onChange: (mode: MapLevelMode) => void }) {
  return <div className="map-level-switch" role="group" aria-label="地图显示模式">
    <button type="button" aria-label="只看地上" aria-pressed={mode === 'surface'} title="查看地上校园；地下设施淡化，被遮挡时隐藏" onClick={() => onChange('surface')}><span className="level-label-full">只看地上</span><span className="level-label-short" aria-hidden="true">地上</span></button>
    <button type="button" aria-label="只看地下" aria-pressed={mode === 'underground'} title="查看地下空间；视野移到地下，地上建筑淡化" onClick={() => onChange('underground')}><span className="level-label-full">只看地下</span><span className="level-label-short" aria-hidden="true">地下</span></button>
  </div>;
}

import { useRef, type SyntheticEvent } from 'react';
import { useAnimatedPresence } from './useAnimatedPresence';
import './map-floor-slider.css';

export default function MapFloorSlider({ visible, buildingName, floors, floor, onChange }: {
  visible: boolean; buildingName: string; floors: number; floor: number; onChange: (floor: number) => void;
}) {
  const presence = useAnimatedPresence(visible, 220, true);
  const retained = useRef({ buildingName, floors, floor, onChange });
  if (visible) retained.current = { buildingName, floors, floor, onChange };
  if (!presence.present) return null;
  const displayed = retained.current;
  const maximum = Math.max(1, Math.floor(displayed.floors));
  const value = Math.min(maximum, Math.max(1, Math.round(displayed.floor)));
  const stop = (event: SyntheticEvent) => event.stopPropagation();
  return <aside className={'map-floor-slider' + (visible && presence.visible ? ' is-visible' : '')}
    aria-label={displayed.buildingName + '楼层展示'} aria-hidden={!visible} inert={!visible}
    onPointerDown={stop} onPointerMove={stop} onPointerUp={stop} onPointerCancel={stop}
    onTouchStart={stop} onTouchMove={stop} onTouchEnd={stop} onTouchCancel={stop}
    onClick={stop} onKeyDown={stop} onWheel={stop}>
    <div className="map-floor-slider-heading"><strong title={displayed.buildingName}>{displayed.buildingName}</strong><span>{value} 楼及以下</span></div>
    <div className="map-floor-slider-rail">
      <span className="map-floor-slider-maximum" aria-hidden="true">{maximum} 楼</span>
      <input type="range" min={1} max={maximum} step={1} value={value} disabled={!visible || maximum === 1}
        aria-label="显示到哪一层" aria-valuetext={value + ' 楼及以下'}
        onChange={event => displayed.onChange(Number(event.target.value))} />
      <span className="map-floor-slider-minimum" aria-hidden="true">1 楼</span>
    </div>
  </aside>;
}

import { campusFilterLocations } from './locations';
import type { Campus, Site } from './types';

export default function LocationOptions({ campus, site }: { campus: Campus; site: Site }) {
  const locations = campusFilterLocations(campus, site);
  return <>{(['building', 'feature'] as const).map(kind => <optgroup key={kind} label={kind === 'building' ? '建筑' : '校园区域与通道'}>
    {locations.filter(location => location.kind === kind).map(location => <option key={location.id} value={location.id}>{location.name}</option>)}
  </optgroup>)}</>;
}

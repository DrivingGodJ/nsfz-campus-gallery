import type { Building, BuildingOverride } from './types';

export function buildingLevels(building: Building, override?: BuildingOverride) {
  const baseFloors = override?.floors ?? building.floors ?? 3;
  const floorHeight = override?.floorHeight ?? building.floorHeight ?? 3.6;
  const baseHeight = baseFloors * floorHeight;
  const sections = (building.parts?.length ? building.parts : [{ id: 'main', name: building.name, outer: building.outer, holes: building.holes }]).map(part => {
    const floors = part.id === 'main' ? baseFloors : override?.partFloors?.[part.id] ?? part.floors ?? baseFloors;
    // A walkable roof meets the next storey's floor slab, including its thickness.
    return { ...part, floors, height: floors * floorHeight + (part.roofTerrace ? Math.min(.25, floorHeight * .1) : 0) };
  });
  const observatoryFloor = building.facade?.type === 'dormitory' ? building.facade.observatory?.floor : undefined;
  return { baseFloors, floorHeight, baseHeight, baseElevation: building.baseElevation ?? 0, sections, observatoryFloor, basement: building.basement,
    floors: Math.max(...sections.map(part => part.floors), observatoryFloor ?? 0),
    height: Math.max(...sections.map(part => part.height), (observatoryFloor ?? 0) * floorHeight) };
}

export function buildingFloorLabel(info: { baseFloors: number; observatoryFloor?: number; basement?: Building['basement'] }, floor: number) {
  if (floor === -1 && info.basement) return info.basement.name;
  return floor + ' 楼' + (floor === info.observatoryFloor ? '（天文台）' : floor > info.baseFloors ? '（局部）' : '');
}

export function buildingFloorText(info: { baseFloors: number; floors: number; observatoryFloor?: number; basement?: Building['basement']; sections?: { name: string; floors: number }[] }) {
  const text = info.observatoryFloor ? info.baseFloors + ' 层 · ' + info.observatoryFloor + ' 层天文台'
    : info.sections && info.sections.length > 1 ? info.sections.map(part => part.name + ' ' + part.floors + ' 层').join(' · ')
    : info.baseFloors === info.floors ? info.floors + ' 层' : info.baseFloors + ' 层 · 局部 ' + info.floors + ' 层';
  return text + (info.basement ? ' · ' + info.basement.name : '');
}

export function buildingFloorOptions(info: { floors: number; basement?: Building['basement'] }, existingFloor = 0) {
  return [...(info.basement ? [-1] : []), ...Array.from({ length: Math.max(info.floors, existingFloor) }, (_, i) => i + 1)];
}

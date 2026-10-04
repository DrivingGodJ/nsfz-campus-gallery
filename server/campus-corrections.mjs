// Keep locally calibrated geometry separate from the downloaded OSM snapshot.
export function resolveLocationId(id, map) {
  const seen = new Set();
  while (map?.buildingAliases?.[id] && !seen.has(id)) {
    seen.add(id);
    id = map.buildingAliases[id];
  }
  return id;
}

export function applyCampusCorrections(map, corrections) {
  if (!corrections) return map;
  const replacements = new Map((corrections.buildings || []).map(b => [b.id, b]));
  const removed = new Set(corrections.removeBuildings || []);
  const buildings = map.buildings.filter(b => !removed.has(b.id)).map(b => {
    const next = replacements.get(b.id); replacements.delete(b.id);
    return next ? { ...b, ...next } : b;
  });
  buildings.push(...replacements.values());
  const featureIds = new Set((corrections.features || []).map(f => f.id));
  return { ...map, buildings, features: [...map.features.filter(f => !featureIds.has(f.id)), ...(corrections.features || [])],
    buildingAliases: corrections.buildingAliases || {},
    calibration: { updatedAt: corrections.updatedAt, note: corrections.note } };
}

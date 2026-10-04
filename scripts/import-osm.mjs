import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyCampusCorrections } from '../server/campus-corrections.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = { lat: 32.0797155, lon: 118.7515366 };
const radius = 6378137;
const project = p => [(p.lon - origin.lon) * Math.PI / 180 * radius * Math.cos(origin.lat * Math.PI / 180), -(p.lat - origin.lat) * Math.PI / 180 * radius];
function inside([x, z], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [a, b] = ring[i], [c, d] = ring[j];
    if ((b > z) !== (d > z) && x < (c - a) * (z - b) / (d - b) + a) hit = !hit;
  }
  return hit;
}
function stitch(segments) {
  const pending = segments.map(s => [...s]).filter(s => s.length > 1);
  const rings = [];
  const same = (a, b) => a.lat === b.lat && a.lon === b.lon;
  while (pending.length) {
    const ring = pending.shift();
    let changed = true;
    while (changed && !same(ring[0], ring.at(-1))) {
      changed = false;
      for (let i = 0; i < pending.length; i++) {
        const s = pending[i];
        if (same(ring.at(-1), s[0])) ring.push(...s.slice(1));
        else if (same(ring.at(-1), s.at(-1))) ring.push(...s.slice(0, -1).reverse());
        else if (same(ring[0], s.at(-1))) ring.unshift(...s.slice(0, -1));
        else if (same(ring[0], s[0])) ring.unshift(...s.slice(1).reverse());
        else continue;
        pending.splice(i, 1); changed = true; break;
      }
    }
    if (same(ring[0], ring.at(-1))) rings.push(ring.map(project));
  }
  return rings;
}
function polygons(e) {
  if (e.geometry?.length > 3) return [{ outer: e.geometry.map(project), holes: [] }];
  if (!e.members) return [];
  const outer = stitch(e.members.filter(m => m.role === 'outer').map(m => m.geometry || []));
  const inner = stitch(e.members.filter(m => m.role === 'inner').map(m => m.geometry || []));
  return outer.map(ring => ({ outer: ring, holes: inner.filter(h => inside(h[0], ring)) }));
}
let data;
const from = process.argv.indexOf('--from');
if (from >= 0) data = JSON.parse(await fs.readFile(process.argv[from + 1], 'utf8'));
else {
  const box = '(32.077,118.749,32.082,118.754)';
  const query = '[out:json][timeout:25];(way(855459406);nwr["building"]' + box + ';way["highway"]' + box + ';way["natural"="water"]' + box + ';way["landuse"~"grass|forest"]' + box + ';way["leisure"~"pitch|track|garden"]' + box + ';);out geom;';
  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'NSFZ-Campus-Gallery/0.1 (local map extraction)' },
    body: new URLSearchParams({ data: query }), signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw new Error('地图提取失败：HTTP ' + response.status + '。现有地图不会被覆盖。');
  data = await response.json();
}
if (data.remark) throw new Error(data.remark);
const boundaryElement = data.elements.find(e => e.type === 'way' && e.id === 855459406);
if (!boundaryElement?.geometry) throw new Error('没有找到校园边界，保留现有地图。');
const boundary = boundaryElement.geometry.map(project);
const buildings = [];
const features = [];
for (const e of data.elements) {
  if (e.id === 855459406) continue;
  const tags = e.tags || {};
  const shapes = polygons(e);
  if (tags.building && tags.building !== 'no') {
    for (let i = 0; i < shapes.length; i++) {
      const points = shapes[i].outer.slice(0, -1);
      const center = points.reduce((p, q) => [p[0] + q[0] / points.length, p[1] + q[1] / points.length], [0, 0]);
      if (!inside(center, boundary)) continue;
      buildings.push({
        id: e.type + '/' + e.id + (i ? '/' + i : ''), osmId: e.id, osmType: e.type,
        name: tags.name || '', category: tags.building, center, ...shapes[i],
        floors: Number(tags['building:levels']) || null
      });
    }
  } else if (tags.highway && e.geometry?.some(p => inside(project(p), boundary))) {
    features.push({ id: 'way/' + e.id, type: 'path', subtype: tags.highway, points: e.geometry.map(project), width: Number(tags.width) || (tags.highway === 'footway' ? 2 : 4) });
  } else if (tags.natural === 'water' || tags.landuse || tags.leisure) {
    for (const shape of shapes) {
      if (shape.outer.some(p => inside(p, boundary))) features.push({
        id: e.type + '/' + e.id, type: tags.natural === 'water' ? 'water' : tags.leisure === 'pitch' || tags.leisure === 'track' ? 'sport' : 'green', ...shape
      });
    }
  }
}
if (!buildings.length) throw new Error('未获取建筑轮廓，保留现有地图。');
const rawMap = { schemaVersion: 1, name: '南师附中 · 察哈尔路校区', origin, boundary, buildings, features,
  source: { name: 'OpenStreetMap contributors', url: 'https://www.openstreetmap.org/way/855459406', license: 'ODbL-1.0', licenseUrl: 'https://www.openstreetmap.org/copyright', extractedAt: new Date().toISOString(), osmTimestamp: data.osm3s?.timestamp_osm_base } };
let corrections;
try { corrections = JSON.parse(await fs.readFile(path.join(root, 'data/campus-corrections.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const map = applyCampusCorrections(rawMap, corrections);
await fs.mkdir(path.join(root, 'data'), { recursive: true });
await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
await fs.writeFile(path.join(root, 'data/osm-source.json'), JSON.stringify(data, null, 2) + '\n');
await fs.writeFile(path.join(root, 'public/data/campus.json'), JSON.stringify(map, null, 2) + '\n');
console.log('已生成校园地图：' + map.buildings.length + ' 个建筑，' + map.features.length + ' 个道路、景观及通道要素。');

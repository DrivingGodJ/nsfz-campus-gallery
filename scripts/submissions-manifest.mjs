import fs from 'node:fs/promises';
const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url), 'utf8'));
const types = new Set(['water','forest','sport','runningTrack','basketballCourts','undergroundRoom','tunnel','undergroundCorridor','undergroundTrack']);
const ids = campus.buildings.filter(b => !['way/1277841229','local/stand-office'].includes(b.id)).map(b => b.id);
ids.push(...campus.features.filter(f => f.name?.trim() && types.has(f.type)).map(f => f.id));
const xs = campus.boundary.map(p => p[0]), zs = campus.boundary.map(p => p[1]);
await fs.writeFile(new URL('../worker/src/submission-campus.json', import.meta.url), JSON.stringify({ locationIds: ids, buildingIds: campus.buildings.map(b => b.id), bounds: [Math.min(...xs)-80,Math.max(...xs)+80,Math.min(...zs)-80,Math.max(...zs)+80] }) + '\n');
console.log('已生成投稿地点验证名单。');

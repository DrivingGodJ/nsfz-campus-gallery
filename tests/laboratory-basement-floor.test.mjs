import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createServer } from 'vite';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { fileURLToPath } from 'node:url';
import { buildingLevels, buildingFloorLabel, buildingFloorOptions, buildingFloorText } from '../src/building-model.ts';
import { photoCameraHeightRange, photoMapHeight, photoLocationText, photosAtLocation } from '../src/locations.ts';
import { isUndergroundPhoto, isUndergroundLocation } from '../src/map-level-mode.ts';
import { mapLocationTarget } from '../src/location-geometry.ts';
import { createStore, exportStaticContent, validatePhoto } from '../server/storage.mjs';
import { createPhotoPackage, readPhotoPackage } from '../server/photo-package.mjs';
import { importPhotoPackage } from '../server/package-import.mjs';
import { validateAnnotation } from '../worker/src/submissions.mjs';

const sourceCampus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const labId = 'way/855459411', garageId = 'local/laboratory-underground-garage';
const originalLab = sourceCampus.buildings.find(building => building.id === labId);
const basement = { featureId: garageId, name: '地下车库', floorElevation: -3, clearHeight: 2.7 };
const laboratory = { ...originalLab, basement };
const garage = { id: garageId, type: 'undergroundRoom', roomUse: 'garage', height: -3, wallHeight: 2.7,
  outer: [[122,-60],[134,-60],[134,-51],[122,-51],[122,-60]], holes: [], representedBy: labId, levelAnchor: { buildingId: labId, floor: -1 } };
const campus = { ...sourceCampus, buildings: sourceCampus.buildings.map(building => building.id === labId ? laboratory : { ...building, basement: undefined }),
  features: [...sourceCampus.features.filter(feature => feature.id !== garageId), garage] };
const site = { schemaVersion: 1, revision: 0, photos: [], buildingOverrides: {} };
const photo = { id: '15ce2084-cd0d-4410-8f6d-112dae3e127a', title: '_DSC8910', description: '', capturedAt: '2024-04-12T16:25:15',
  buildingId: labId, locationId: labId, floor: -1, captureType: 'ground', cameraHeight: .1,
  position: { x: 126.91265111860213, z: -54.457221363386246 }, heading: 324.58, pitch: -12.72, placed: true,
  width: 40, height: 80, downloadBytes: 0, files: { thumbnail: '', display: '', download: '' } };

test('the garage is an additional named underground floor without changing the laboratory six-storey body', () => {
  const info = buildingLevels(laboratory), before = buildingLevels(originalLab);
  assert.equal(info.baseFloors, 6);
  assert.equal(info.floors, before.floors);
  assert.equal(info.height, before.height);
  assert.deepEqual(info.sections, before.sections);
  assert.deepEqual(buildingFloorOptions(info), [-1,1,2,3,4,5,6]);
  assert.equal(buildingFloorLabel(info,-1), '地下车库');
  assert.equal(buildingFloorText(info), '6 层 · 地下车库');
  assert.equal(photoLocationText(photo,campus,site), '实验楼 · 地下车库');
  assert.deepEqual(photosAtLocation([photo,{...photo,id:'above',floor:1}],labId,-1,campus),[photo]);
  assert.equal(photosAtLocation([photo,{...photo,id:'above',floor:1}],labId,0,campus).length,2);
});

test('garage camera heights, scene mode and location focus use the actual basement instead of an extra surface storey', () => {
  const before = JSON.stringify({campus,photo});
  assert.deepEqual(photoCameraHeightRange(photo,campus,site),{min:.1,max:2.6});
  for(const [height,expected] of [[.1,-2.9],[1.6,-1.4],[20,-.4]]) {
    assert.ok(Math.abs(photoMapHeight({...photo,cameraHeight:height},campus,site)-expected)<1e-9);
  }
  assert.equal(isUndergroundPhoto(photo,campus,site),true);
  assert.equal(isUndergroundPhoto({...photo,floor:1},campus,site),false);
  assert.equal(isUndergroundPhoto({...photo,captureType:'aerial',altitude:{reference:'takeoff',meters:30}},campus,site),false);
  assert.equal(isUndergroundLocation(campus,labId,-1),true);
  assert.equal(isUndergroundLocation(campus,labId,1),false);
  assert.deepEqual(mapLocationTarget(campus,site,labId,-1),mapLocationTarget(campus,site,garageId));
  assert.equal(mapLocationTarget(campus,site,labId,-1).target[1],-3);
  assert.equal(mapLocationTarget(campus,site,labId,1).bounds.max[1],3.72);
  assert.ok(Math.abs(mapLocationTarget(campus,site,labId).bounds.max[1]-21.72)<1e-9);
  assert.equal(JSON.stringify({campus,photo}),before);
});

test('the actual annotation floor selector exposes the garage while retaining all six surface floors', async () => {
  const cacheDir=await fs.mkdtemp(path.join(os.tmpdir(),'nsfz-garage-controls-'));
  const server=await createServer({root:fileURLToPath(new URL('../',import.meta.url)),cacheDir,configFile:false,appType:'custom',optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,hmr:false,watch:null}});
  try {
    const {default:Fields}=await server.ssrLoadModule('/src/PhotoPositionFields.tsx');
    const html=renderToStaticMarkup(React.createElement(Fields,{photo,campus,site,onChange:()=>{}}));
    assert.match(html,/<option value="-1" selected="">地下车库<\/option>/);
    for(let floor=1;floor<=6;floor++) assert.ok(html.includes(`<option value="${floor}">${floor} 楼</option>`));
    assert.ok(!html.includes('<option value="7">'));
    const other=campus.buildings.find(building=>building.id!==labId);
    const above=renderToStaticMarkup(React.createElement(Fields,{photo:{...photo,buildingId:other.id,locationId:other.id,floor:1},campus,site,onChange:()=>{}}));
    assert.ok(!above.includes('<option value="-1">'));
  } finally {await server.close();await fs.rm(cacheDir,{recursive:true,force:true});}
});

test('local and online validation accept only the declared basement floor and reject unsupported negative layers', () => {
  const manifest={locationIds:campus.buildings.map(building=>building.id),buildingIds:campus.buildings.map(building=>building.id),basementBuildingIds:[labId],bounds:[-1000,1000,-1000,1000]};
  assert.equal(validatePhoto(photo,photo,campus).floor,-1);
  assert.equal(validateAnnotation(photo,manifest).floor,-1);
  const other=campus.buildings.find(building=>building.id!==labId);
  for(const invalid of [{...photo,floor:-2},{...photo,buildingId:other.id,locationId:other.id},{...photo,captureType:'aerial',altitude:{reference:'takeoff',meters:30}}]) {
    assert.throws(()=>validatePhoto(invalid,invalid,campus),/楼层/);
    assert.throws(()=>validateAnnotation(invalid,manifest),/楼层/);
  }
  assert.throws(()=>validateAnnotation(photo,{...manifest,basementBuildingIds:[]}),/楼层/);
});

test('the basement floor survives photo packages, local publish and static export with its camera pose retained', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nsfz-garage-storage-'));
  try {
    await fs.mkdir(path.join(root,'public/data'),{recursive:true});
    await fs.writeFile(path.join(root,'public/data/campus.json'),JSON.stringify(campus));
    await fs.copyFile(new URL('../public/favicon.svg',import.meta.url),path.join(root,'public/favicon.svg'));
    const bytes=await sharp({create:{width:40,height:80,channels:3,background:'#778877'}}).jpeg().toBuffer();
    const file=new File([bytes],'车库.jpg',{type:'image/jpeg'}),pack=await createPhotoPackage(file,photo,campus);
    assert.equal((await readPhotoPackage(pack.bytes)).annotation.floor,-1);
    const other=campus.buildings.find(building=>building.id!==labId);
    await assert.rejects(createPhotoPackage(file,{...photo,buildingId:other.id,locationId:other.id},campus),/楼层/);
    const store=createStore(root),imported=await importPhotoPackage(store,pack.bytes);
    assert.equal(imported.photo.floor,-1);
    assert.deepEqual(imported.photo.position,photo.position);
    assert.equal(imported.photo.cameraHeight,photo.cameraHeight);
    const draftBefore=JSON.stringify((await store.state()).drafts);
    await assert.rejects(store.updateDraft(imported.photo.id,{...imported.photo,buildingId:other.id,locationId:other.id,floor:-1}),/楼层/);
    await assert.rejects(store.updateDraft(imported.photo.id,{...imported.photo,floor:-2}),/楼层/);
    assert.equal(JSON.stringify((await store.state()).drafts),draftBefore,'Rejected basement edits do not mutate the stored draft');
    const saved=await store.publish(imported.photo.id,0);
    assert.equal(saved.floor,-1);
    await exportStaticContent(root,path.join(root,'export'));
    const exported=JSON.parse(await fs.readFile(path.join(root,'export/data/site.json')));
    assert.equal(exported.photos[0].floor,-1);
    assert.deepEqual(exported.photos[0].position,photo.position);
    assert.equal(exported.photos[0].heading,photo.heading);
    assert.equal(exported.photos[0].pitch,photo.pitch);
  } finally {await fs.rm(root,{recursive:true,force:true});}
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createStore, exportStaticContent, validatePhoto, ASSET_PATTERN, UserError } from '../server/storage.mjs';
import { isLocalRequest } from '../server/local-editor.mjs';
import { buildingLevels, buildingFloorText } from '../src/building-model.ts';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-test-'));
  await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
  const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
  await fs.writeFile(path.join(root, 'public/data/campus.json'), JSON.stringify(campus));
  await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
  const bytes = await sharp({ create: { width: 80, height: 40, channels: 3, background: '#47694e' } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  return { root, store: createStore(root), bytes, campus, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}
test('import preserves local source, corrects orientation, and keeps draft out of public content', async () => {
  const f = await fixture();
  try {
    const draft = await f.store.importPhoto(f.bytes);
    assert.equal(draft.width, 40); assert.equal(draft.height, 80);
    const state = await f.store.state();
    assert.equal(state.drafts.length, 1); assert.equal(state.site.photos.length, 0);
    const original = await fs.readFile(path.join(f.root, '.local/originals', draft.id, 'source.jpeg'));
    assert.deepEqual(original, f.bytes);
    const metadata = await sharp(path.join(f.root, '.local/draft-media', draft.id, 'download.jpg')).metadata();
    assert.equal(metadata.orientation, undefined); assert.equal(metadata.exif, undefined);
    await assert.rejects(fs.access(path.join(f.root, 'public/media', draft.id)));
  } finally { await f.cleanup(); }
});
test('large images get a distinct high-quality preview, which publishes and exports without altering the download', async () => {
  const f = await fixture();
  try {
    const bytes = await sharp({ create: { width: 6000, height: 4000, channels: 3, background: '#47694e' } }).jpeg().toBuffer();
    const draft = await f.store.importPhoto(bytes);
    const directory = path.join(f.root, '.local/draft-media', draft.id);
    for (const [name, size] of [['thumbnail.webp',[420,280]],['preview.webp',[1440,960]],['display.webp',[2400,1600]],['download.jpg',[6000,4000]]]) {
      const metadata = await sharp(path.join(directory,name)).metadata();
      assert.deepEqual([metadata.width,metadata.height],size); assert.equal(metadata.exif,undefined);
    }
    const download = await fs.readFile(path.join(directory,'download.jpg'));
    await f.store.updateDraft(draft.id,{ ...draft,placed:true });
    const published = await f.store.publish(draft.id,0);
    assert.equal(ASSET_PATTERN.test(published.files.preview),true);
    const output = path.join(f.root,'export'); await exportStaticContent(f.root,output);
    assert.deepEqual(await fs.readFile(path.join(output,published.files.download)),download);
    assert.deepEqual(await fs.readFile(path.join(output,published.files.preview)),await fs.readFile(path.join(directory,'preview.webp')));
    const site = (await f.store.state()).site;
    delete site.photos[0].files.preview;
    await fs.rm(path.join(f.root,'public/media',draft.id,'preview.webp'));
    await fs.writeFile(path.join(f.root,'public/data/site.json'),JSON.stringify(site));
    const filled = await f.store.backfillPhotoPreviews();
    assert.equal(filled.generated,1); assert.equal((await f.store.state()).site.revision,2);
    assert.deepEqual(await fs.readFile(path.join(f.root,'public',published.files.download)),download);
    assert.deepEqual(await fs.readFile(path.join(f.root,'.local/originals',draft.id,'source.jpeg')),bytes);
    assert.equal((await f.store.backfillPhotoPreviews()).generated,0);
    assert.equal((await f.store.state()).site.revision,2,'Repeating migration does not rewrite the content library');
  } finally { await f.cleanup(); }
});
test('unplaced and out-of-range photos cannot publish; saved assets cannot be redirected', async () => {
  const f = await fixture();
  try {
    const draft = await f.store.importPhoto(f.bytes);
    await assert.rejects(f.store.publish(draft.id, 0), /标记拍摄位置/);
    assert.throws(() => validatePhoto({ ...draft, placed: true, position: { ...draft.position, x: Infinity } }, draft, f.campus), /位置/);
    const edited = await f.store.updateDraft(draft.id, { ...draft, placed: true, title: '三楼窗边', files: { thumbnail: '../../secret' } });
    assert.deepEqual(edited.files, draft.files);
    assert.equal(ASSET_PATTERN.test('media/../../secret'), false);
    assert.equal(ASSET_PATTERN.test('/etc/passwd'), false);
  } finally { await f.cleanup(); }
});
test('publish, revision conflict, removal and restoration preserve newest independent changes', async () => {
  const f = await fixture();
  try {
    const draft = await f.store.importPhoto(f.bytes);
    await f.store.updateDraft(draft.id, { ...draft, title: '测试照片', placed: true, position: { x: 0, z: 0, height: 8.8 }, buildingId: f.campus.buildings.find(b => b.floors >= 3).id, floor: 3, heading: 90, pitch: -15 });
    const published = await f.store.publish(draft.id, 0);
    assert.equal((await f.store.state()).site.revision, 1);
    await assert.rejects(f.store.updatePhoto(published.id, { ...published, title: '过期修改' }, 0), e => e instanceof UserError && e.status === 409);
    await f.store.removePhoto(published.id, 1);
    const building = f.campus.buildings[0];
    await f.store.updateBuildings({ [building.id]: { name: '独立校准', floors: 4, floorHeight: 3.8, height: null } }, 2);
    await f.store.restorePhoto(published.id, 3);
    const state = await f.store.state();
    assert.equal(state.site.photos[0].position.height, undefined);
    assert.equal(state.site.photos[0].floor, 3);
    assert.equal(state.site.buildingOverrides[building.id].name, '独立校准');
    assert.equal(state.site.revision, 4);
    assert.equal((await fs.readdir(path.join(f.root, '.local/backups'))).length, 4);
  } finally { await f.cleanup(); }
});
test('static export includes only published referenced photos, and rejects poisoned paths', async () => {
  const f = await fixture();
  try {
    const first = await f.store.importPhoto(f.bytes);
    await f.store.updateDraft(first.id, { ...first, placed: true });
    await f.store.publish(first.id, 0);
    const second = await f.store.importPhoto(f.bytes);
    await fs.mkdir(path.join(f.root, 'public/media/orphan'), { recursive: true });
    await fs.writeFile(path.join(f.root, 'public/media/orphan/private.txt'), 'not public');
    const out = path.join(f.root, 'export');
    await exportStaticContent(f.root, out);
    const exported = JSON.parse(await fs.readFile(path.join(out, 'data/site.json')));
    assert.equal(exported.photos.length, 1);
    assert.deepEqual(await fs.readdir(path.join(out, 'media')), [first.id]);
    await assert.rejects(fs.access(path.join(out, '.local')));
    await assert.rejects(fs.access(path.join(out, 'editor.html')));
    await assert.rejects(fs.access(path.join(out, 'media', second.id)));
    exported.photos[0].files.thumbnail = '../../secret';
    await fs.writeFile(path.join(f.root, 'public/data/site.json'), JSON.stringify(exported));
    await assert.rejects(exportStaticContent(f.root, path.join(f.root, 'unsafe')), /路径/);
  } finally { await f.cleanup(); }
});

test('building settings save and export floors and floor height without a legacy total height', async () => {
  const f = await fixture();
  try {
    const building = f.campus.buildings[0];
    await f.store.updateBuildings({ [building.id]: { name: '按层高校准', floors: 4, floorHeight: 3.8, height: 200 } }, 0);
    const saved = (await f.store.state()).site;
    assert.deepEqual(saved.buildingOverrides[building.id], { name: '按层高校准', floors: 4, floorHeight: 3.8 });
    // Older content files also lose the obsolete setting in their public export.
    saved.buildingOverrides[building.id].height = 300;
    await fs.writeFile(path.join(f.root, 'public/data/site.json'), JSON.stringify(saved));
    const out = path.join(f.root, 'export');
    await exportStaticContent(f.root, out);
    const exported = JSON.parse(await fs.readFile(path.join(out, 'data/site.json')));
    assert.deepEqual(exported.buildingOverrides[building.id], { name: '按层高校准', floors: 4, floorHeight: 3.8 });
    assert.equal(exported.revision, saved.revision);
  } finally { await f.cleanup(); }
});

test('main and secondary floor counts save, export, and calculate separate heights', async () => {
  const f = await fixture();
  try {
    const building = f.campus.buildings.find(b => b.id === 'way/855459420');
    const settings = { name: '主教学楼', floors: 7, floorHeight: 3.9, partFloors: { 'sixth-floor-wing': 4 } };
    await f.store.updateBuildings({ [building.id]: settings }, 0);
    const saved = (await f.store.state()).site.buildingOverrides[building.id];
    assert.deepEqual(saved, settings);
    const info = buildingLevels(building, saved);
    assert.deepEqual(info.sections.map(p => p.floors), [7, 4]);
    assert.equal(info.sections[0].height, 7 * 3.9);
    assert.equal(info.sections[1].height, 4 * 3.9);
    assert.equal(info.floors, 7);
    assert.equal(buildingFloorText(info), '主楼 7 层 · 副楼 4 层');
    const out = path.join(f.root, 'export');
    await exportStaticContent(f.root, out);
    const exported = JSON.parse(await fs.readFile(path.join(out, 'data/site.json')));
    assert.deepEqual(exported.buildingOverrides[building.id], settings);
    await assert.rejects(f.store.updateBuildings({ [building.id]: { ...settings, partFloors: { 'sixth-floor-wing': 3.5 } } }, 1), /整数/);
    await assert.rejects(f.store.updateBuildings({ [building.id]: { ...settings, partFloors: { missing: 3 } } }, 1), /分区/);
    await assert.rejects(f.store.updateBuildings({ [building.id]: { ...settings, partFloors: { 'sixth-floor-wing': 0 } } }, 1), /副楼楼层/);
    assert.equal((await f.store.state()).site.revision, 1);
  } finally { await f.cleanup(); }
});
test('invalid image and cross-origin local requests are rejected', async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.store.importPhoto(Buffer.from('not an image')), /无法读取/);
    assert.equal(isLocalRequest({ headers: { host: '127.0.0.1:5178', origin: 'http://127.0.0.1:5178' } }), true);
    assert.equal(isLocalRequest({ headers: { host: '127.0.0.1:5178', origin: 'https://example.com' } }), false);
    assert.equal(isLocalRequest({ headers: { host: 'attacker.example:5178' } }), false);
    assert.equal(isLocalRequest({ headers: { host: 'localhost:5178', 'sec-fetch-site': 'cross-site' } }), false);
  } finally { await f.cleanup(); }
});

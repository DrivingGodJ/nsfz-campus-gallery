import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createStore, exportStaticContent } from '../server/storage.mjs';
import { extractPhotoMetadata } from '../server/photo-metadata.mjs';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-credits-'));
  await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
  await fs.copyFile(new URL('../public/data/campus.json', import.meta.url), path.join(root, 'public/data/campus.json'));
  await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
  const image = () => sharp({ create: { width: 60, height: 40, channels: 3, background: '#fff' } }).jpeg();
  const bytes = await image().withExif({ IFD0: { Artist: 'EXIF Photographer', Copyright: '(C) Original rights' } }).toBuffer();
  return { root, bytes, image, store: createStore(root), close: () => fs.rm(root, { force: true, recursive: true }) };
}

test('EXIF and XMP credits read original author/rights without inventing missing fields', async () => {
  const f = await fixture();
  try {
    const exif = await extractPhotoMetadata(f.bytes);
    assert.equal(exif.author, 'EXIF Photographer'); assert.equal(exif.copyright, '(C) Original rights');
    const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>甲</rdf:li><rdf:li>乙</rdf:li></rdf:Seq></dc:creator><dc:rights><rdf:Alt><rdf:li xml:lang="x-default">保留所有权利</rdf:li></rdf:Alt></dc:rights></rdf:Description></rdf:RDF></x:xmpmeta>';
    const metadata = await extractPhotoMetadata(await f.image().withXmp(xmp).toBuffer());
    assert.equal(metadata.author, '甲、乙'); assert.equal(metadata.copyright, '保留所有权利');
    const bare = await f.store.importPhoto(await f.image().toBuffer());
    assert.equal(bare.author, ''); assert.equal(bare.copyright, '');
    assert.equal(bare.metadata.author, undefined); assert.ok(!Number.isNaN(Date.parse(bare.uploadedAt)));
  } finally { await f.close(); }
});

test('credits and immutable upload time survive edit, export, removal and restore; oversized fields reject', async () => {
  const f = await fixture();
  try {
    const draft = await f.store.importPhoto(f.bytes);
    assert.equal(draft.author, 'EXIF Photographer'); assert.equal(draft.copyright, '(C) Original rights');
    await f.store.updateDraft(draft.id, { ...draft, placed: true, author: '作者新署名', copyright: '按约定使用', uploadedAt: '1900-01-01' });
    const saved = await f.store.publish(draft.id, 0);
    assert.equal(saved.uploadedAt, draft.uploadedAt); assert.equal(saved.metadata.author, draft.author);
    await assert.rejects(f.store.updatePhoto(saved.id, { ...saved, author: 'x'.repeat(201) }, 1), /作者/);
    await assert.rejects(f.store.updatePhoto(saved.id, { ...saved, copyright: 'x'.repeat(3001) }, 1), /版权/);
    await exportStaticContent(f.root, path.join(f.root, 'dist'));
    const exported = JSON.parse(await fs.readFile(path.join(f.root, 'dist/data/site.json'))).photos[0];
    assert.equal(exported.author, '作者新署名'); assert.equal(exported.copyright, '按约定使用');
    await f.store.removePhoto(saved.id, 1); await f.store.restorePhoto(saved.id, 2);
    const restored = (await f.store.state()).site.photos[0];
    assert.equal(restored.author, saved.author); assert.equal(restored.uploadedAt, draft.uploadedAt);
    const edited = await f.store.updatePhoto(saved.id, { ...restored, author: '', copyright: '' }, 3);
    assert.equal(edited.author, ''); assert.equal(edited.copyright, '');
    await f.store.backfillPhotoCredits();
    const filled = (await f.store.state()).site.photos[0];
    assert.equal(filled.author, '', 'Backfill respects manually cleared credits');
  } finally { await f.close(); }
});

test('backfill reads retained originals and changes only credits in legacy records', async () => {
  const f = await fixture();
  try {
    const draft = await f.store.importPhoto(f.bytes);
    await f.store.updateDraft(draft.id, { ...draft, placed: true, title: '原有描述与定位', description: '保留文字' });
    await f.store.publish(draft.id, 0);
    const file = path.join(f.root, 'public/data/site.json'), before = JSON.parse(await fs.readFile(file));
    for (const field of ['author', 'copyright', 'uploadedAt']) delete before.photos[0][field];
    delete before.photos[0].metadata.author; delete before.photos[0].metadata.copyright;
    await fs.writeFile(file, JSON.stringify(before));
    assert.deepEqual(await f.store.backfillPhotoCredits(), { found: 1, missing: 0 });
    const after = await f.store.state(), photo = after.site.photos[0];
    assert.equal(photo.author, 'EXIF Photographer'); assert.equal(photo.copyright, '(C) Original rights');
    assert.equal(photo.uploadedAt, undefined, 'Never invent a legacy upload timestamp');
    const strip = p => { const { author, copyright, metadata, ...rest } = p; const { author: a, copyright: c, ...m } = metadata; return { ...rest, metadata: m }; };
    assert.deepEqual(strip(photo), strip(before.photos[0]));
    assert.deepEqual(after.site.buildingOverrides, before.buildingOverrides);
    const revision = after.site.revision; await f.store.backfillPhotoCredits();
    assert.equal((await f.store.state()).site.revision, revision, 'Repeated backfill is harmless');
  } finally { await f.close(); }
});

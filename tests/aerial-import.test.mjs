import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { extractPhotoMetadata } from '../server/photo-metadata.mjs';
import { automaticPhotoPlacement, projectPhotoGPS } from '../server/photo-geolocation.mjs';
import { createStore, exportStaticContent, validatePhoto } from '../server/storage.mjs';
import { aerialImportText, assignPhotoLocation, photoMapHeight, photoLocationText, samePhotoSpot } from '../src/locations.ts';

const campus = JSON.parse(await fs.readFile(new URL('../public/data/campus.json', import.meta.url)));
const site = { photos: [], buildingOverrides: {} };
function withXMP(jpeg, attributes = '', elements = '') {
  const xml = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:drone-dji="http://www.dji.com/drone-dji/1.0/" ' + attributes + '>' + elements + '</rdf:Description></rdf:RDF></x:xmpmeta>';
  const data = Buffer.concat([Buffer.from('http://ns.adobe.com/xap/1.0/\0'), Buffer.from(xml)]);
  const header = Buffer.alloc(4); header.writeUInt16BE(0xffe1); header.writeUInt16BE(data.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, data, jpeg.subarray(2)]);
}
const gps = { GPSLatitude: '32/1 4/1 4713/100', GPSLatitudeRef: 'N', GPSLongitude: '118/1 45/1 553176/100000', GPSLongitudeRef: 'E', GPSAltitude: '1068/10', GPSAltitudeRef: '0' };
async function image(make = 'DJI', model = 'FC3582', location = gps) {
  const bytes = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#526a56' } }).jpeg().withExif({ IFD0: { Make: make, Model: model }, IFD3: location }).toBuffer();
  // libvips forces GPSAltitudeRef to zero. Set the real EXIF BYTE field in this fixture.
  if (location.GPSAltitudeRef === '1') {
    const base = bytes.indexOf(Buffer.from('Exif\0\0')) + 6;
    const read16 = offset => bytes.readUInt16LE(base + offset), read32 = offset => bytes.readUInt32LE(base + offset);
    assert.equal(bytes.toString('ascii', base, base + 2), 'II');
    const ifd0 = read32(4);
    for (let i = 0; i < read16(ifd0); i++) {
      const entry = ifd0 + 2 + i * 12;
      if (read16(entry) !== 0x8825) continue;
      const gpsIFD = read32(entry + 8);
      for (let j = 0; j < read16(gpsIFD); j++) {
        const gpsEntry = gpsIFD + 2 + j * 12;
        if (read16(gpsEntry) === 5) bytes[base + gpsEntry + 8] = 1;
      }
    }
  }
  return bytes;
}

test('DJI GPS and XMP height automatically place an aerial photo using relative altitude', async () => {
  const bytes = withXMP(await image(), 'drone-dji:RelativeAltitude="+80.200" drone-dji:AbsoluteAltitude="+106.800"');
  const m = await extractPhotoMetadata(bytes);
  assert.ok(Math.abs(m.aerial.latitude - 32.07975833333334) < 1e-9);
  assert.equal(m.aerial.longitude, campus.origin.lon);
  assert.equal(m.aerial.relativeAltitude, 80.2);
  const placement = automaticPhotoPlacement(m, campus);
  assert.equal(placement.captureType, 'aerial'); assert.equal(placement.placed, true);
  assert.ok(Math.abs(placement.position.x) < 1e-7);
  assert.ok(Math.abs(placement.position.z + 4.7681) < .001, 'North is negative z in the existing campus projection');
  assert.deepEqual(placement.altitude, { meters: 80.2, reference: 'takeoff' });
  assert.equal(Object.hasOwn(placement.position, 'height'), false);
  assert.equal(photoMapHeight({ ...placement, floor: 0, buildingId: '' }, campus, site), 80.2);
});

test('XMP-only coordinates, including the DJI longitude spelling, and zero height are retained', async () => {
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).jpeg().toBuffer();
  const m = await extractPhotoMetadata(withXMP(jpeg, 'drone-dji:GpsLatitude="32.0797155" drone-dji:GpsLongtitude="118.7515366"', '<drone-dji:RelativeAltitude>+0.00</drone-dji:RelativeAltitude>'));
  assert.deepEqual(m.aerial, { latitude: campus.origin.lat, longitude: campus.origin.lon, relativeAltitude: 0 });
  assert.deepEqual(automaticPhotoPlacement(m, campus).altitude, { meters: 0, reference: 'takeoff' });
});

test('standard EXIF altitude honors below-sea-level reference; does not invent ground-relative height', async () => {
  const m = await extractPhotoMetadata(await image('DJI', 'FC3582', { ...gps, GPSAltitudeRef: '1' }));
  assert.equal(m.aerial.absoluteAltitude, -106.8);
  const p = { ...automaticPhotoPlacement(m, campus), floor: 0, buildingId: '', metadata: m };
  assert.deepEqual(p.altitude, { meters: -106.8, reference: 'seaLevel' });
  assert.equal(photoMapHeight(p, campus, site), 1.6);
  assert.match(aerialImportText(p), /海拔.*只标水平位置/);
  const west = await extractPhotoMetadata(await image('DJI', 'FC3582', { ...gps, GPSLatitudeRef: 'S', GPSLongitudeRef: 'W' }));
  assert.ok(west.aerial.latitude < 0 && west.aerial.longitude < 0);
});

test('phone and handheld cameras with GPS remain ordinary photos without recorded altitude', async () => {
  for (const [make, model] of [['Apple', 'iPhone 16 Pro'], ['Canon', 'EOS R6'], ['DJI', 'Osmo Action 4']]) {
    const m = await extractPhotoMetadata(await image(make, model));
    assert.equal(m.aerial, undefined);
    assert.deepEqual(automaticPhotoPlacement(m, campus), { captureType: 'ground', position: { x: 0, z: 0 }, placed: false });
  }
});

test('missing, invalid, and outside-campus coordinates or altitudes retain a recoverable draft', async () => {
  assert.equal(projectPhotoGPS(NaN, campus.origin.lon, campus), undefined);
  const outside = automaticPhotoPlacement({ aerial: { latitude: 40, longitude: 116, relativeAltitude: 350 } }, campus);
  assert.equal(outside.placed, false); assert.deepEqual(outside.position, { x: 0, z: 0 });
  assert.equal(outside.altitude.meters, 350, 'Altitude metadata is not silently capped at the former 250 m limit');
  assert.match(aerialImportText({ ...outside, metadata: { aerial: { latitude: 40, longitude: 116 } } }), /超出校园地图/);
  const missing = await extractPhotoMetadata(withXMP(await image(), 'drone-dji:RelativeAltitude="NaN" drone-dji:AbsoluteAltitude="Infinity"'));
  // Invalid XMP can fall back to valid EXIF altitude.
  assert.equal(missing.aerial.relativeAltitude, undefined); assert.equal(missing.aerial.absoluteAltitude, 106.8);
  const noHeight = await extractPhotoMetadata(await image('DJI', 'FC3582', { GPSLatitude: gps.GPSLatitude, GPSLatitudeRef: 'N' }));
  const p = automaticPhotoPlacement(noHeight, campus);
  assert.equal(p.placed, false); assert.equal(p.altitude, undefined);
  const invalid = await extractPhotoMetadata(withXMP(await image('DJI', 'FC3582', { ...gps, GPSLatitude: '32/1 99/1 0/1' }), 'drone-dji:RelativeAltitude="+5"'));
  assert.equal(automaticPhotoPlacement(invalid, campus).placed, false, 'Invalid GPS minutes must not become a plausible campus location');
});

test('aerial import, association, edits, restore and static export preserve location and height', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'nsfz-aerial-'));
  try {
    await fs.mkdir(path.join(root, 'public/data'), { recursive: true });
    await fs.writeFile(path.join(root, 'public/data/campus.json'), JSON.stringify(campus));
    await fs.copyFile(new URL('../public/favicon.svg', import.meta.url), path.join(root, 'public/favicon.svg'));
    const store = createStore(root), bytes = withXMP(await image(), 'drone-dji:RelativeAltitude="+80.20"');
    const draft = await store.importPhoto(bytes);
    assert.equal(draft.placed, true); assert.equal(draft.captureType, 'aerial');
    const associated = assignPhotoLocation(draft, campus.buildings[0].id, campus, site);
    assert.equal(associated.floor, 0); assert.deepEqual(associated.altitude, draft.altitude); assert.deepEqual(associated.position, draft.position);
    assert.match(photoLocationText(associated, campus, site), /航拍$/);
    await store.updateDraft(draft.id, { ...associated, metadata: {} });
    const published = await store.publish(draft.id, 0);
    assert.equal(published.metadata.aerial.relativeAltitude, 80.2, 'Source metadata is immutable');
    await store.updatePhoto(draft.id, { ...published, altitude: { meters: 85, reference: 'takeoff' } }, 1);
    await store.removePhoto(draft.id, 2); await store.restorePhoto(draft.id, 3);
    const restored = (await store.state()).site.photos[0];
    assert.deepEqual(restored.altitude, { meters: 85, reference: 'takeoff' }); assert.deepEqual(restored.position, draft.position);
    await exportStaticContent(root, path.join(root, 'out'));
    const exported = JSON.parse(await fs.readFile(path.join(root, 'out/data/site.json')));
    assert.deepEqual(exported.photos[0], restored);
    assert.equal((await sharp(path.join(root, 'out', restored.files.download)).metadata()).exif, undefined);
    assert.throws(() => validatePhoto({ ...restored, altitude: { meters: Infinity, reference: 'takeoff' } }, restored, campus), /高度/);
    assert.throws(() => validatePhoto({ ...restored, altitude: undefined }, restored, campus), /没有读取到/);
    const ground = validatePhoto({ ...restored, captureType: 'ground', floor: 3, position: { ...restored.position, height: 99 } }, restored, campus);
    assert.equal(ground.altitude, undefined); assert.equal(ground.position.height, undefined); assert.equal(ground.floor, 3);
    assert.equal(photoMapHeight(ground, campus, site), 12.4, 'Ground photos include the gym\'s raised base');
    const changed = { ...site, buildingOverrides: { [ground.buildingId]: { floors: 4, floorHeight: 4.2 } } };
    assert.equal(photoMapHeight(ground, campus, changed), 13.6);
    assert.equal(samePhotoSpot(ground, restored, campus, site), false);
    assert.equal(samePhotoSpot(restored, { ...restored, altitude: { meters: 86, reference: 'takeoff' } }, campus, site), true);
    assert.equal(samePhotoSpot(restored, { ...restored, altitude: { meters: 85, reference: 'seaLevel' } }, campus, site), false);
    assert.equal(samePhotoSpot({ ...restored, altitude: { meters: 90, reference: 'seaLevel' } }, { ...restored, altitude: { meters: 110, reference: 'seaLevel' } }, campus, site), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

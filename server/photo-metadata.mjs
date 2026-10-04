import { validCaptureTime } from './capture-time.mjs';
export { validCaptureTime } from './capture-time.mjs';
import exifr from 'exifr';

const tags = ['DateTimeOriginal', 'CreateDate', 'OffsetTimeOriginal', 'OffsetTimeDigitized', 'Make', 'Model', 'LensModel',
  'FocalLength', 'FocalLengthIn35mmFormat', 'FNumber', 'ExposureTime', 'ISO',
  'GPSLatitude', 'GPSLatitudeRef', 'GPSLongitude', 'GPSLongitudeRef', 'GPSAltitude', 'GPSAltitudeRef', 'Artist', 'Copyright'];
function clean(value) { return typeof value === 'string' ? value.replaceAll('\0', '').trim().slice(0, 160) : undefined; }
function credit(value, limit) {
  if (Array.isArray(value)) value = value.map(item => credit(item, limit)).filter(Boolean).join('、');
  if (value && typeof value === 'object') value = value.value ?? value['x-default'];
  return typeof value === 'string' ? value.replaceAll('\0', ' ').trim().slice(0, limit) || undefined : undefined;
}
function positive(value, max) { return typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max ? value : undefined; }
function finite(value, min, max) {
  if (typeof value === 'string' && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value.trim())) value = Number(value);
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : undefined;
}
function coordinate(value, ref, max) {
  if (Array.isArray(value)) {
    if (value.length !== 3 || !value.every(Number.isFinite) || value[1] < 0 || value[1] >= 60 || value[2] < 0 || value[2] >= 60) return undefined;
    value = (Math.abs(value[0]) + value[1] / 60 + value[2] / 3600) * (value[0] < 0 ? -1 : 1);
  }
  // XMP also permits degrees and decimal minutes, with the hemisphere appended.
  if (typeof value === 'string') {
    const match = /^([+-]?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?))?(?:,(\d+(?:\.\d+)?))?([NSEW])?$/i.exec(value.trim());
    if (match) {
      const degrees = Number(match[1]), minutes = Number(match[2] || 0), seconds = Number(match[3] || 0);
      if (minutes >= 60 || seconds >= 60) return undefined;
      value = (Math.abs(degrees) + minutes / 60 + seconds / 3600) * (degrees < 0 ? -1 : 1);
      ref = match[4] || ref;
    }
  }
  value = finite(value, -max, max);
  return value !== undefined && /^(S|W)$/i.test(ref || '') ? -Math.abs(value) : value;
}
function aerialMetadata(exif, xmp) {
  const make = clean(exif.Make) || clean(xmp.Make) || '', model = clean(exif.Model) || clean(xmp.Model) || '';
  const relativeAltitude = finite(xmp.RelativeAltitude, -12000, 100000);
  const absoluteXMP = finite(xmp.AbsoluteAltitude, -12000, 100000);
  const flightTags = ['RelativeAltitude', 'AbsoluteAltitude', 'FlightYawDegree', 'FlightPitchDegree', 'FlightRollDegree'].some(key => xmp[key] !== undefined);
  const droneCamera = (/DJI/i.test(make) && !/osmo|action|pocket|^(?:AC|OT|HG)\d/i.test(model))
    || /autel|parrot|skydio|yuneec/i.test(make) || /^(?:L[123]D|FC\d)|mavic|phantom|inspire|anafi|bebop|typhoon/i.test(model);
  if (!flightTags && !droneCamera) return undefined;
  const gpsAltitude = finite(exif.GPSAltitude, 0, 100000);
  const absoluteAltitude = absoluteXMP ?? (gpsAltitude !== undefined ? (Number(exif.GPSAltitudeRef) === 1 ? -gpsAltitude : gpsAltitude) : undefined);
  const latitude = coordinate(exif.GPSLatitude ?? exif.latitude, exif.GPSLatitudeRef, 90)
    ?? coordinate(xmp.GpsLatitude ?? xmp.GPSLatitude, xmp.GPSLatitudeRef, 90);
  const longitude = coordinate(exif.GPSLongitude ?? exif.longitude, exif.GPSLongitudeRef, 180)
    ?? coordinate(xmp.GpsLongitude ?? xmp.GpsLongtitude ?? xmp.GPSLongitude, xmp.GPSLongitudeRef, 180);
  return Object.fromEntries(Object.entries({ latitude, longitude, relativeAltitude, absoluteAltitude }).filter(([, value]) => value !== undefined));
}

function timestamp(value) {
  // EXIF wall-clock time often has no time zone. Preserve it without a browser/OS conversion.
  const match = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(clean(value) || '');
  if (!match) return undefined;
  const formatted = match[1] + '-' + match[2] + '-' + match[3] + 'T' + match[4] + ':' + match[5] + ':' + match[6];
  return validCaptureTime(formatted) ? formatted : undefined;
}
export async function extractPhotoMetadata(bytes) {
  try {
    // Parse independently: a damaged optional XMP packet must not discard camera/GPS tags.
    const parsed = await Promise.allSettled([
      exifr.parse(bytes, { pick: tags, ifd0: true, exif: true, gps: true, xmp: false, iptc: false, icc: false,
        makerNote: false, userComment: false, reviveValues: false }),
      exifr.parse(bytes, { ifd0: false, exif: false, gps: false, xmp: true, iptc: false, icc: false,
        makerNote: false, userComment: false, reviveValues: false }),
      exifr.parse(bytes, { pick: ['Byline', 'CopyrightNotice'], ifd0: false, exif: false, gps: false, xmp: false, iptc: true, icc: false,
        makerNote: false, userComment: false, reviveValues: false })
    ]);
    const exif = parsed[0].status === 'fulfilled' ? parsed[0].value || {} : {};
    const xmp = parsed[1].status === 'fulfilled' ? parsed[1].value || {} : {};
    const iptc = parsed[2].status === 'fulfilled' ? parsed[2].value || {} : {};
    const originalDate = timestamp(exif.DateTimeOriginal), recordedAt = originalDate || timestamp(exif.CreateDate);
    const offset = clean(originalDate ? exif.OffsetTimeOriginal : exif.OffsetTimeDigitized);
    const metadata = { recordedAt, utcOffset: /^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset || '') ? offset : undefined,
      cameraMake: clean(exif.Make), cameraModel: clean(exif.Model), lensModel: clean(exif.LensModel),
      focalLengthMm: positive(exif.FocalLength, 10000), focalLength35Mm: positive(exif.FocalLengthIn35mmFormat, 10000),
      aperture: positive(exif.FNumber, 256), exposureSeconds: positive(exif.ExposureTime, 86400), iso: positive(exif.ISO, 10000000),
      aerial: aerialMetadata(exif, xmp),
      author: credit(xmp.creator, 200) || credit(iptc.Byline, 200) || credit(exif.Artist, 200),
      copyright: credit(xmp.rights, 3000) || credit(iptc.CopyrightNotice, 3000) || credit(exif.Copyright, 3000) };
    return Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined && value !== ''));
  } catch {
    // An unreadable optional EXIF segment must not block importing an otherwise valid photo.
    return {};
  }
}

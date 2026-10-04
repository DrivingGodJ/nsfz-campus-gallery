/** @param {string} value */
export function validCaptureTime(value) {
  if (!value) return true;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value);
  if (!match) return false;
  const [, y, m, d, h = '0', min = '0', s = '0'] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return date.getUTCFullYear() === Number(y) && date.getUTCMonth() + 1 === Number(m) && date.getUTCDate() === Number(d)
    && Number(h) < 24 && Number(min) < 60 && Number(s) < 60;
}

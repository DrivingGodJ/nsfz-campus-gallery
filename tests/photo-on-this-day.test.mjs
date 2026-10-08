import test from 'node:test';
import assert from 'node:assert/strict';
import { photosOnThisDay } from '../src/photo-on-this-day.ts';

test('on this day uses valid past shooting dates, newest years first, without timezone shifts or mutations', () => {
  const photos = [
    { id: 'older', capturedAt: '2023-10-09' },
    { id: 'recent', capturedAt: '2025-10-09T23:59:59-12:00' },
    { id: 'this-year', capturedAt: '2026-10-09T12:00' },
    { id: 'future', capturedAt: '2027-10-09' },
    { id: 'other-day', capturedAt: '2025-10-08' },
    ...['', undefined, 'bad', '2025-10-09Tbad', '2025-10-09T24:00', '0000-10-09'].map(capturedAt => ({ id: 'invalid', capturedAt }))
  ];
  const before = JSON.stringify(photos);
  assert.deepEqual(photosOnThisDay(photos, new Date(2026, 9, 9)).map(p => p.id), ['recent', 'older']);
  assert.equal(JSON.stringify(photos), before);
  assert.deepEqual(photosOnThisDay(photos, new Date(2026, 9, 10)), []);
  assert.deepEqual(photosOnThisDay([
    { capturedAt: '2024-02-29' }, { capturedAt: '2023-02-29' }, { capturedAt: '2028-02-29' }, { capturedAt: '2032-02-29' }
  ], new Date(2028, 1, 29)), [{ capturedAt: '2024-02-29' }]);
});

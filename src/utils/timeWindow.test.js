import { windowCutoff, parseLooseDate, applyWindow } from './timeWindow';

const utc = (y, m, d) => Date.UTC(y, m - 1, d);

describe('windowCutoff', () => {
  test('goes back the requested number of calendar months from the reference day', () => {
    expect(windowCutoff(new Date('2026-11-20T17:00:00Z'), 6)).toBe(utc(2026, 5, 20));
    expect(windowCutoff(new Date('2026-03-10T00:00:00Z'), 6)).toBe(utc(2025, 9, 10));
    expect(windowCutoff(new Date('2026-11-20T17:00:00Z'), 1)).toBe(utc(2026, 10, 20));
  });

  test('clamps the day instead of overflowing into the next month', () => {
    expect(windowCutoff(new Date('2026-08-31T12:00:00Z'), 6)).toBe(utc(2026, 2, 28));
    expect(windowCutoff(new Date('2024-08-31T12:00:00Z'), 6)).toBe(utc(2024, 2, 29)); // leap year
  });

  test.each([0, null, undefined, NaN, Infinity, -3])('disables the window for %p', (months) => {
    expect(windowCutoff(new Date('2026-11-20T00:00:00Z'), months)).toBe(-Infinity);
  });
});

describe('parseLooseDate', () => {
  test.each([
    ['2025-01-03', utc(2025, 1, 3)],
    ['2025-01-03T10:11:12Z', utc(2025, 1, 3)],
    ['Jan 3, 2025', utc(2025, 1, 3)],
    ['January 3, 2025', utc(2025, 1, 3)],
    ['October 16, 2015 at 07:13:22 AM UTC', utc(2015, 10, 16)],
    ['Sept 9, 2024', utc(2024, 9, 9)],
  ])('reads %p', (input, expected) => {
    expect(parseLooseDate(input)).toBe(expected);
  });

  test.each(['', 'not a date', 'Foo 3, 2025', null, undefined, 42])('returns null for %p', (input) => {
    expect(parseLooseDate(input)).toBeNull();
  });
});

describe('applyWindow', () => {
  const cutoff = utc(2026, 5, 20);
  const rows = [
    { ts: utc(2026, 5, 19) }, // 1 day too old
    { ts: utc(2026, 5, 20) }, // exactly on the boundary: kept
    { ts: utc(2026, 11, 1) },
    { ts: null }, // undated: kept, never silently dropped
    { ts: NaN },
  ];

  test('keeps in-window and undated rows and counts the rest', () => {
    const { kept, dropped, undated } = applyWindow(rows, (r) => r.ts, cutoff);
    expect(dropped).toBe(1);
    expect(undated).toBe(2);
    expect(kept).toHaveLength(4);
  });

  test('does not mutate its input', () => {
    const copy = rows.map((r) => ({ ...r }));
    applyWindow(rows, (r) => r.ts, cutoff);
    expect(rows).toEqual(copy);
  });

  test('keeps everything when the window is disabled', () => {
    const { kept, dropped } = applyWindow(rows, (r) => r.ts, -Infinity);
    expect(dropped).toBe(0);
    expect(kept).toHaveLength(rows.length);
  });
});

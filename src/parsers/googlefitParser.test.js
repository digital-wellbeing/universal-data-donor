import JSZip from 'jszip';
import parseGoogleFitFile from './googlefitParser';
import validateGoogleFitData from '../validators/googlefitValidator';
import { createPointScanner, selectStreamFiles } from './googlefitRawStreams';

// Upload "today"; the 6-month window therefore starts 2026-01-01T00:00:00Z.
const NOW = Date.parse('2026-07-01T00:00:00Z');
const ns = (iso) => Date.parse(iso) * 1e6;

const point = (typeName, startIso, endIso, value, kind = 'fpVal') => ({
  fitValue: [{ value: { [kind]: value } }],
  startTimeNanos: ns(startIso),
  endTimeNanos: ns(endIso),
  dataTypeName: typeName,
});
const stream = (source, points) => JSON.stringify({ 'Data Source': source, 'Data Points': points }, null, 2);

const buildZip = async (files) => {
  const zip = new JSZip();
  Object.entries(files).forEach(([name, text]) => zip.file(name, text));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new Blob([bytes]);
};

const DAILY = 'Date,Step count,Calories (kcal)\n2026-03-01,1000,2000\n';
const HR = 'com.google.heart_rate.bpm';

const FILES = {
  'Takeout/Fit/Daily activity metrics/Daily activity metrics.csv': DAILY,
  // Merged heart rate: one sample before the window, two inside (out of order).
  [`Takeout/Fit/All Data/derived_${HR}_com.google.android.gms_merge_heart_rate_bpm.json`]: stream(
    `derived:${HR}:com.google.android.gms:merge_heart_rate_bpm`,
    [
      point(HR, '2025-12-31T23:59:59Z', '2025-12-31T23:59:59Z', 70),
      point(HR, '2026-03-01T10:00:05Z', '2026-03-01T10:00:05Z', 81.5),
      point(HR, '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z', 72),
    ],
  ),
  // Raw feeder for the same type: must be ignored because a merged stream exists.
  [`Takeout/Fit/All Data/raw_${HR}_Fitbit_Charge 4.json`]: stream(
    `raw:${HR}:Fitbit:Charge 4`,
    [point(HR, '2026-03-01T10:00:00Z', '2026-03-01T10:00:00Z', 99)],
  ),
  'Takeout/Fit/All Data/derived_com.google.step_count.delta_com.google.android.gms_estimated_steps.json': stream(
    'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
    [point('com.google.step_count.delta', '2026-03-01T10:00:00Z', '2026-03-01T10:15:00Z', 120, 'intVal')],
  ),
  'Takeout/Fit/All Data/derived_com.google.activity.segment_com.google.android.gms_merge_activity_segments.json': stream(
    'derived:com.google.activity.segment:com.google.android.gms:merge_activity_segments',
    [
      point('com.google.activity.segment', '2026-03-01T09:00:00Z', '2026-03-01T09:30:00Z', 8, 'intVal'),
      point('com.google.activity.segment', '2026-03-01T09:30:00Z', '2026-03-01T09:40:00Z', 9999, 'intVal'),
    ],
  ),
  // No merged stream for distance: every source is kept and labelled.
  'Takeout/Fit/All Data/raw_com.google.distance.delta_com.app.one_x.json': stream(
    'raw:com.google.distance.delta:com.app.one:x',
    [point('com.google.distance.delta', '2026-03-01T10:00:00Z', '2026-03-01T10:05:00Z', 400.123)],
  ),
  'Takeout/Fit/All Data/raw_com.google.distance.delta_com.app.two_y.json': stream(
    'raw:com.google.distance.delta:com.app.two:y',
    [point('com.google.distance.delta', '2026-03-01T11:00:00Z', '2026-03-01T11:05:00Z', 100)],
  ),
  // Location must never be read, even though it is under All Data.
  'Takeout/Fit/All Data/derived_com.google.location.sample_com.google.android.gms_merge_location_samples.json': stream(
    'derived:com.google.location.sample:com.google.android.gms:merge_location_samples',
    [{ fitValue: [{ value: { fpVal: 51.5 } }], startTimeNanos: ns('2026-03-01T10:00:00Z'), endTimeNanos: ns('2026-03-01T10:00:00Z') }],
  ),
};

describe('createPointScanner', () => {
  const body = JSON.stringify({
    'Data Source': 'x',
    'Data Points': [
      { a: 'has } and { and ] braces', b: 'quote \\" inside' },
      { nested: { deep: [1, 2, { z: 3 }] } },
    ],
    trailer: [{ ignored: true }],
  });

  test.each([1, 7, body.length])('yields each point exactly once with %i-char chunks', (size) => {
    const out = [];
    const scanner = createPointScanner((p) => out.push(p));
    for (let i = 0; i < body.length; i += size) scanner.push(body.slice(i, i + size));
    expect(out).toEqual([
      { a: 'has } and { and ] braces', b: 'quote \\" inside' },
      { nested: { deep: [1, 2, { z: 3 }] } },
    ]);
    expect(scanner.malformed).toBe(0);
  });
});

describe('selectStreamFiles', () => {
  test('prefers merged streams and ignores non-whitelisted types', () => {
    const entries = Object.keys(FILES).map((name) => ({ name }));
    const selected = [...selectStreamFiles(entries).entries()]
      .map(([s, files]) => [s.table, files.map((f) => f.entry.name.split('/').pop())]);
    const byTable = Object.fromEntries(selected);
    expect(byTable['Raw Heart Rate']).toHaveLength(1);
    expect(byTable['Raw Heart Rate'][0]).toMatch(/merge_heart_rate_bpm/);
    expect(byTable['Raw Distance']).toHaveLength(2);
    expect(JSON.stringify(byTable)).not.toMatch(/location/);
  });
});

describe('parseGoogleFitFile raw streams', () => {
  let result;
  beforeAll(async () => {
    result = await parseGoogleFitFile(await buildZip(FILES), undefined, { now: NOW });
  });

  test('keeps existing tables and adds raw tables, and validates', () => {
    expect(Object.keys(result.data)).toEqual([
      'Daily Activity', 'Raw Heart Rate', 'Raw Steps', 'Raw Distance', 'Raw Activity Segments',
    ]);
    expect(validateGoogleFitData(result).valid).toBe(true);
    expect(result.data['Daily Activity']).toHaveLength(1);
  });

  test('heart rate: window applied, sorted, merged stream only, compact columns', () => {
    const rows = result.data['Raw Heart Rate'];
    expect(rows.map((r) => r['Heart Rate (bpm)'])).toEqual(['72', '81.5']);
    expect(rows[0]['Start (UTC)']).toBe('2026-03-01 10:00:00');
    expect(Object.keys(rows[0]).filter((k) => !k.startsWith('_'))).toEqual(['Start (UTC)', 'Heart Rate (bpm)']);
    expect(rows[0]._timestamp).toBe(Date.parse('2026-03-01T10:00:00Z'));
    expect(rows[0]._app).toBe('Raw Heart Rate');
  });

  test('interval streams carry an end time; units are formatted', () => {
    const [steps] = result.data['Raw Steps'];
    expect(steps).toMatchObject({ 'Start (UTC)': '2026-03-01 10:00:00', 'End (UTC)': '2026-03-01 10:15:00', Steps: '120' });
  });

  test('activity codes are named; unknown codes are not guessed', () => {
    const rows = result.data['Raw Activity Segments'];
    expect(rows[0].Activity).toBe('Running');
    expect(rows[1].Activity).toBe('Activity code 9999');
  });

  test('without a merged stream all sources are kept with an app label only', () => {
    const rows = result.data['Raw Distance'];
    expect(rows.map((r) => r.Source)).toEqual(['com.app.one', 'com.app.two']);
    expect(rows[0]['Distance (m)']).toBe('400.12');
  });

  test('location is never emitted', () => {
    expect(JSON.stringify(result.data)).not.toMatch(/51\.5|location/i);
  });

  test('reports the absence of All Data and of samples in the window', async () => {
    const noAll = await parseGoogleFitFile(await buildZip({ 'Takeout/Fit/Daily activity metrics/Daily activity metrics.csv': DAILY }), undefined, { now: NOW });
    expect(noAll.parsingErrors.sheetsNotFound).toContain('All Data');

    const old = await parseGoogleFitFile(await buildZip({
      'Takeout/Fit/Daily activity metrics/Daily activity metrics.csv': DAILY,
      [`Takeout/Fit/All Data/derived_${HR}_com.google.android.gms_merge_heart_rate_bpm.json`]: stream('s', [
        point(HR, '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', 70),
      ]),
    }), undefined, { now: NOW });
    expect(old.data['Raw Heart Rate']).toBeUndefined();
    expect(old.parsingErrors.tablesNotParsed.some((t) => t.sheetName === 'Raw Heart Rate')).toBe(true);
  });

  test('reports progress up to 1', async () => {
    const seen = [];
    await parseGoogleFitFile(await buildZip(FILES), (f) => seen.push(f), { now: NOW });
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    expect(seen[seen.length - 1]).toBeGreaterThan(0.9);
  });
});

import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import parseHealthConnectFile, { uuidToString, recordKey } from './healthConnectParser';
import validateHealthConnectData from '../validators/healthConnectValidator';

// Synthetic export built by scripts/fixtures/make_health_connect_fixture.py
// with the AOSP HealthFitness schema (no real Health Connect data committed).
const fixture = () => new Blob([new Uint8Array(fs.readFileSync(path.join(__dirname, '__fixtures__', 'health_connect_export.zip')))]);

describe('parseHealthConnectFile', () => {
  let result;
  beforeAll(async () => {
    result = await parseHealthConnectFile(fixture());
  });

  test('produces ordered tables and validates', () => {
    expect(Object.keys(result.data)).toEqual(['Daily Activity', 'Sleep', 'Exercise']);
    expect(validateHealthConnectData(result).valid).toBe(true);
  });

  test('daily totals: largest single app, calories → kcal, local days', () => {
    const [jan1, jan2] = result.data['Daily Activity'];
    expect(jan1.Date).toBe('2026-01-01');
    expect(jan1.Steps).toBe('5500');
    expect(jan1['Steps Source']).toBe('Samsung Health');
    expect(jan1['Distance (km)']).toBe('4.2');
    expect(jan1['Active Energy (kcal)']).toBe('250');
    expect(jan1['Total Energy (kcal)']).toBe('2100');
    expect(jan1['Floors Climbed']).toBe('4');
    expect(jan1['Avg HR (bpm)']).toBe('108');
    expect(jan1['Min HR (bpm)']).toBe('60');
    expect(jan1['Max HR (bpm)']).toBe('160');
    expect(jan1['Resting HR (bpm)']).toBe('55');
    expect(jan1['HRV RMSSD (ms)']).toBe('42.5');
    expect(jan1['SpO2 (%)']).toBe('96.5');
    expect(jan1['Respiratory Rate (brpm)']).toBe('14.2');
    expect(jan2.Date).toBe('2026-01-02');
    expect(jan2.Steps).toBe('300');
  });

  test('sleep prefers the staged session and maps stage codes', () => {
    const [night] = result.data.Sleep;
    expect(night.Date).toBe('2026-01-01');
    expect(night.Source).toBe('Samsung Health');
    expect(night['Sleep Start']).toBe('2025-12-31 23:30');
    expect(night['Sleep End']).toBe('2026-01-01 07:30');
    expect(night['In Bed (min)']).toBe('480');
    expect(night['Asleep (min)']).toBe('470');
    expect(night['Light (min)']).toBe('320');
    expect(night['Deep (min)']).toBe('60');
    expect(night['REM (min)']).toBe('90');
    expect(night['Awake (min)']).toBe('10');
    expect(night['Sources Recorded']).toBe('2');
  });

  test('exercise sessions carry type, HR and a salted record key (not the UUID)', () => {
    const [run, unknown] = result.data.Exercise;
    expect(run.Activity).toBe('Running');
    expect(run['Start Time']).toBe('2026-01-01 19:00');
    expect(run['Duration (min)']).toBe('30');
    expect(run['Avg HR (bpm)']).toBe('150');
    expect(run['Max HR (bpm)']).toBe('160');
    expect(run.Source).toBe('Fit');
    expect(run['Record Key']).toMatch(/^[0-9a-f]{20}$/);
    expect(unknown['Record Key']).not.toBe(run['Record Key']);
    expect(JSON.stringify(result.data)).not.toMatch(/12345678-9abc/);
    expect(run._app).toBe('Running');
    expect(unknown.Activity).toBe('Type 999');
  });

  test('never emits free text, GPS or excluded record types', () => {
    const json = JSON.stringify(result.data);
    for (const leak of ['argument', 'Sleep at home', 'Elm Street', 'felt great', '51.24', '-0.58', '70123', '70.1', 'SM-R960']) {
      expect(json).not.toContain(leak);
    }
  });

  test('accepts the bare .db file', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, '__fixtures__', 'health_connect_export.zip')));
    const db = await zip.file('health_connect_export.db').async('uint8array');
    const res = await parseHealthConnectFile(new Blob([db]));
    expect(res.data).toEqual(result.data);
  });

  test('a corrupt b-tree page is reported per table instead of throwing', async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(__dirname, '__fixtures__', 'health_connect_export.zip')));
    const db = await zip.file('health_connect_export.db').async('uint8array');
    const pageSize = (db[16] << 8) | db[17];
    db[pageSize * 2] = 0x07; // page 3: invalid page type
    const res = await parseHealthConnectFile(new Blob([db]));
    expect(res.parsingErrors.tablesNotParsed.length).toBeGreaterThan(0);
    expect(res.parsingErrors.tablesNotParsed[0].reason).toMatch(/b-tree page type 7/);
  });

  test('rejects other files', async () => {
    const zip = new JSZip();
    zip.file('notes.txt', 'hello');
    const res = await parseHealthConnectFile(new Blob([await zip.generateAsync({ type: 'uint8array' })]));
    expect(res.data).toEqual({});
    expect(res.parsingErrors.sheetsNotFound).toContain('health_connect_export.db');
    expect(validateHealthConnectData(res).valid).toBe(false);
    const res2 = await parseHealthConnectFile(new Blob(['not sqlite at all, just some text padding'.repeat(5)]));
    expect(res2.parsingErrors.tablesNotParsed[0].reason).toMatch(/Not a SQLite database/);
  });
});

test('recordKey is a deterministic salted hash', () => {
  const uuid = '12345678-9abc-4def-8000-000000000001';
  expect(recordKey(uuid)).toBe(recordKey(uuid));
  expect(recordKey(uuid)).toMatch(/^[0-9a-f]{20}$/);
  expect(recordKey(uuid)).not.toBe(recordKey('12345678-9abc-4def-8000-000000000002'));
  expect(recordKey('')).toBe('');
});

test('uuidToString', () => {
  expect(uuidToString(new Uint8Array(16).fill(255))).toBe('ffffffff-ffff-ffff-ffff-ffffffffffff');
  expect(uuidToString(null)).toBe('');
});

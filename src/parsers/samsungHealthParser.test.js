import JSZip from 'jszip';
import parseSamsungHealthFile, { parseDayTime } from './samsungHealthParser';
import validateSamsungHealthData from '../validators/samsungHealthValidator';

// Synthetic Samsung Health download mirroring the real CSV quirks: BOM +
// metadata first line, prefixed column names, trailing commas on data rows,
// UTC times with per-row offsets. Real downloads hold personal data.
const DIR = 'Samsung Health/samsunghealth_jane.doe_20260110120000/';
const STAMP = '20260110120000';
const file = (type, header, rows) => [
  `﻿${type},6305105,7`,
  header.join(','),
  ...rows.map((r) => `${r.join(',')},`), // Samsung's trailing comma
].join('\n') + '\n';

const P = (type, cols) => cols.map((c) => (c.startsWith('=') ? c.slice(1) : `com.samsung.health.${type}.${c}`));
const jan9 = Date.UTC(2026, 0, 9);
const jan10 = Date.UTC(2026, 0, 10);

const entries = {
  [`${DIR}com.samsung.shealth.tracker.pedometer_day_summary.${STAMP}.csv`]: file(
    'com.samsung.shealth.tracker.pedometer_day_summary',
    ['day_time', 'step_count', 'distance', 'calorie', 'active_time', 'deviceuuid', 'pkg_name', 'datauuid'],
    [
      [jan10, 6000, 4500, 210.5, 3600000, 'VfS0qUERdZ', 'com.sec.android.app.shealth', 'a1'], // Combined
      [jan10, 5000, 3800, 180, 3000000, 'watchUUID01', 'com.sec.android.app.shealth', 'a2'],
      [jan10, 1500, 1000, 50, 600000, 'phoneUUID01', 'com.sec.android.app.shealth', 'a3'],
      ['2026-01-11 00:00:00.000', 800, 600, 30, 300000, 'phoneUUID01', 'com.sec.android.app.shealth', 'a4'],
      ['2026-01-11 00:00:00.000', 900, 650, 32, 320000, 'watchUUID01', 'com.sec.android.app.shealth', 'a5'],
    ],
  ),
  [`${DIR}com.samsung.shealth.calories_burned.details.${STAMP}.csv`]: file(
    'com.samsung.shealth.calories_burned.details',
    ['active_calories_goal', 'com.samsung.shealth.calories_burned.day_time', 'com.samsung.shealth.calories_burned.rest_calorie', 'com.samsung.shealth.calories_burned.active_calorie'],
    [[500, jan10, 1500.2, 320.7], [500, Date.UTC(2026, 0, 20), 1500, 0]], // Jan 20: BMR only → dropped
  ),
  [`${DIR}com.samsung.shealth.tracker.heart_rate.${STAMP}.csv`]: file(
    'com.samsung.shealth.tracker.heart_rate',
    ['source', 'tag_id', ...P('heart_rate', ['heart_rate', 'min', 'max', 'start_time', 'end_time', 'time_offset', 'deviceuuid'])],
    [
      [0, 21313, 70, 55, 120, '2026-01-10 09:00:00.000', '2026-01-10 09:59:59.999', 'UTC+0100', 'watchUUID01'],
      [0, 21312, 90, '', '', '2026-01-10 22:30:00.000', '2026-01-10 22:30:00.000', 'UTC+0100', 'watchUUID01'],
      [0, 21312, 60, '', '', '2026-01-10 23:30:00.000', '2026-01-10 23:30:00.000', 'UTC+0100', 'watchUUID01'], // Jan 11 local
    ],
  ),
  [`${DIR}com.samsung.shealth.stress.${STAMP}.csv`]: file(
    'com.samsung.shealth.stress',
    ['start_time', 'end_time', 'score', 'min', 'max', 'time_offset', 'deviceuuid'],
    [['2026-01-10 10:00:00.000', '2026-01-10 10:59:59.999', 40, 20, 60, 'UTC+0100', 'watchUUID01']],
  ),
  [`${DIR}com.samsung.shealth.sleep.${STAMP}.csv`]: file(
    'com.samsung.shealth.sleep',
    ['efficiency', 'sleep_score', 'sleep_duration', ...P('sleep', ['start_time', 'end_time', 'time_offset', 'deviceuuid', 'comment', 'datauuid'])],
    [
      [92, 81, '', '2026-01-09 22:00:00.000', '2026-01-10 05:30:00.000', 'UTC+0100', 'watchUUID01', 'bad night', 'sleep-1'],
      [80, 60, '', '2026-01-10 06:00:00.000', '2026-01-10 06:30:00.000', 'UTC+0100', 'watchUUID01', '', 'sleep-2'],
    ],
  ),
  [`${DIR}com.samsung.health.sleep_stage.${STAMP}.csv`]: file(
    'com.samsung.health.sleep_stage',
    ['start_time', 'end_time', 'stage', 'sleep_id', 'time_offset', 'deviceuuid', 'datauuid'],
    [
      ['2026-01-09 22:00:00.000', '2026-01-10 00:00:00.000', 40002, 'sleep-1', 'UTC+0100', 'watchUUID01', 's1'],
      ['2026-01-10 00:00:00.000', '2026-01-10 01:00:00.000', 40003, 'sleep-1', 'UTC+0100', 'watchUUID01', 's2'],
      ['2026-01-10 01:00:00.000', '2026-01-10 01:15:00.000', 40001, 'sleep-1', 'UTC+0100', 'watchUUID01', 's3'],
      ['2026-01-10 01:15:00.000', '2026-01-10 02:45:00.000', 40004, 'sleep-1', 'UTC+0100', 'watchUUID01', 's4'],
      ['2026-01-10 02:45:00.000', '2026-01-10 05:30:00.000', 40002, 'sleep-1', 'UTC+0100', 'watchUUID01', 's5'],
    ],
  ),
  [`${DIR}com.samsung.shealth.exercise.${STAMP}.csv`]: file(
    'com.samsung.shealth.exercise',
    ['title', 'start_latitude', 'start_longitude', 'total_calorie',
      ...P('exercise', ['exercise_type', 'start_time', 'end_time', 'duration', 'distance', 'calorie', 'count', 'count_type', 'mean_heart_rate', 'max_heart_rate', 'time_offset', 'location_data', 'deviceuuid', 'datauuid'])],
    [['"Run, past Jane\'s house"', 51.2432, -0.5876, 330, 1002, '2026-01-10 17:00:00.000', '2026-01-10 17:30:00.000', 1800000, 5100, 320.4, 4800, 30001, 150, 172, 'UTC+0100', 'loc-1.json', 'watchUUID01', 'ex-1']],
  ),
  [`${DIR}com.samsung.health.user_profile.${STAMP}.csv`]: file('com.samsung.health.user_profile', ['key', 'value'], [['birth_date', '19900101']]),
  [`${DIR}jsons/com.samsung.shealth.exercise/e/ex-1.com.samsung.health.exercise.location_data.json`]: JSON.stringify([{ latitude: 51.2432, longitude: -0.5876 }]),
};

const upload = async (files = entries) => {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content);
  return new Blob([await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })]);
};

test('parseDayTime handles epoch and string forms', () => {
  expect(parseDayTime(String(jan10))).toBe('2026-01-10');
  expect(parseDayTime('2026-01-11 00:00:00.000')).toBe('2026-01-11');
  expect(parseDayTime('')).toBe('');
});

describe('parseSamsungHealthFile', () => {
  let result;
  beforeAll(async () => {
    result = await parseSamsungHealthFile(await upload());
  });

  test('builds the three tables and validates', () => {
    expect(Object.keys(result.data)).toEqual(['Daily Activity', 'Sleep', 'Exercise']);
    expect(validateSamsungHealthData(result).valid).toBe(true);
  });

  test('daily steps use the Combined row, else the largest device; never a sum', () => {
    const byDate = Object.fromEntries(result.data['Daily Activity'].map((r) => [r.Date, r]));
    expect(byDate['2026-01-10'].Steps).toBe('6000');
    expect(byDate['2026-01-10']['Distance (km)']).toBe('4.5');
    expect(byDate['2026-01-10']['Active Time (min)']).toBe('60');
    expect(byDate['2026-01-10']['Active Energy (kcal)']).toBe('321');
    expect(byDate['2026-01-10']['Resting Energy (kcal)']).toBe('1500');
    expect(byDate['2026-01-11'].Steps).toBe('900');
    expect(byDate['2026-01-20']).toBeUndefined(); // BMR-only day
  });

  test('UTC samples land on the local day; hourly min/max are kept', () => {
    const byDate = Object.fromEntries(result.data['Daily Activity'].map((r) => [r.Date, r]));
    expect(byDate['2026-01-10']['Avg HR (bpm)']).toBe('80');
    expect(byDate['2026-01-10']['Min HR (bpm)']).toBe('55');
    expect(byDate['2026-01-10']['Max HR (bpm)']).toBe('120');
    expect(byDate['2026-01-11']['Avg HR (bpm)']).toBe('60');
    expect(byDate['2026-01-10']['Avg Stress']).toBe('40');
  });

  test('sleep merges a night\'s sessions and maps stage codes 40001-40004', () => {
    const [night] = result.data.Sleep;
    expect(result.data.Sleep).toHaveLength(1);
    expect(night).toMatchObject({
      Date: '2026-01-10',
      'Sleep Start': '2026-01-09 23:00',
      'Sleep End': '2026-01-10 07:30',
      'Light (min)': '285',
      'Deep (min)': '60',
      'REM (min)': '90',
      'Awake (min)': '15',
      'Asleep (min)': '435',
      'Recorded (min)': '480',
      'Efficiency (%)': '92',
      'Sleep Score': '81',
      Sessions: '2',
    });
  });

  test('exercise maps the type code and units', () => {
    const [run] = result.data.Exercise;
    expect(run).toMatchObject({
      Activity: 'Running', 'Start Time': '2026-01-10 18:00', 'Duration (min)': '30',
      'Distance (km)': '5.1', 'Calories (kcal)': '320', Steps: '4800', 'Avg HR (bpm)': '150', 'Max HR (bpm)': '172',
    });
  });

  test('never emits names, device IDs, comments, titles or locations', () => {
    const json = JSON.stringify(result.data);
    for (const leak of ['jane', 'Jane', 'UUID', 'VfS0', 'bad night', 'house', '51.24', '-0.58', '1990', 'loc-1', 'sleep-1']) {
      expect(json).not.toContain(leak);
    }
  });

  test('an empty energy cell does not overwrite a value from another row', async () => {
    const res = await parseSamsungHealthFile(await upload({
      [`x/com.samsung.shealth.calories_burned.details.${STAMP}.csv`]:
        'com.samsung.shealth.calories_burned.details,1,1\nday_time,active_calorie,rest_calorie\n2026-01-12 00:00:00.000,650,1500,\n2026-01-12 00:00:00.000,,1400,\n',
      [`x/com.samsung.shealth.tracker.pedometer_day_summary.${STAMP}.csv`]:
        'day_time,step_count,calorie,deviceuuid\n2026-01-12 00:00:00.000,100,300,VfS0qUERdZ\n',
    }));
    expect(res.data['Daily Activity'][0]['Active Energy (kcal)']).toBe('650');
  });

  test('tolerates a stripped metadata line and semicolon re-saves', async () => {
    const res = await parseSamsungHealthFile(await upload({
      [`x/com.samsung.shealth.tracker.pedometer_day_summary.${STAMP}.csv`]:
        'day_time;step_count;deviceuuid\n2026-01-12 00:00:00.000;1234;VfS0qUERdZ\n',
    }));
    expect(res.data['Daily Activity'][0]).toMatchObject({ Date: '2026-01-12', Steps: '1234' });
  });

  test('rejects zips without Samsung Health CSVs', async () => {
    const res = await parseSamsungHealthFile(await upload({ 'readme.txt': 'hi' }));
    expect(res.data).toEqual({});
    expect(validateSamsungHealthData(res).valid).toBe(false);
  });
});

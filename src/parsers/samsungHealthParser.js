import { openZip } from '../utils/zipReader';
import { forEachCsvRecord } from '../utils/csv';
import {
  fmtNum, formatDuration, dayTimestamp, formatLocal, localDay, sleepDay, Stat, getOrCreate,
} from '../utils/wearableFormat';
import { parseIso, parseOffset } from './fitbitTime';

/**
 * Parser for a Samsung Health personal-data download (Samsung Health app →
 * Settings → Download personal data). The app writes a folder
 * (`Samsung Health/samsunghealth_<account>_<stamp>/`) which participants
 * compress into a .zip before uploading.
 *
 * CSV quirks handled: a metadata first line (`<type>,<app version>,<schema>`)
 * before the header, optional UTF-8 BOM, a trailing comma on data rows,
 * column names with or without a `com.samsung.health.<type>.` prefix, start
 * times in UTC with a per-row `time_offset` ("UTC+0200"), and `day_time`
 * either as epoch ms (UTC midnight of the local date) or a date string.
 *
 * Review tables:
 *   1. "Daily Activity" — steps, distance, active time, energy, floors, heart
 *      rate, stress, SpO2 and respiratory rate per local day.
 *   2. "Sleep"          — per night: window, stage minutes, efficiency, score.
 *   3. "Exercise"       — per session: type, start, duration, distance,
 *      calories, steps, heart rate.
 *
 * The daily step summary has one row per device plus a "Combined" virtual
 * device; the combined row is used (else the largest), never a sum.
 *
 * Never read: the `jsons/` sidecars (GPS traces, live data) and `files/`
 * (profile photo, ECG reports), user / device profiles, exercise titles,
 * comments and start coordinates, weight, food, water, cycle tracking, and
 * the account name in the folder path. Device IDs are used only internally.
 *
 * @param {File} file - zipped Samsung Health folder
 * @param {(fraction: number) => void} [onProgress]
 */

// Constant deviceuuid of Samsung's "Combined" virtual device (2021–2026).
const COMBINED_DEVICE = 'VfS0qUERdZ';

// Samsung HealthConstants.SleepStage
const STAGES = { 40001: 'awake', 40002: 'light', 40003: 'deep', 40004: 'rem' };

// Samsung HealthConstants.Exercise EXERCISE_TYPE (common codes).
const EXERCISE_TYPES = {
  0: 'Custom', 1001: 'Walking', 1002: 'Running', 2001: 'Baseball', 2002: 'Softball', 2003: 'Cricket',
  3001: 'Golf', 3002: 'Billiards', 3003: 'Bowling', 4001: 'Hockey', 4002: 'Rugby', 4003: 'Basketball',
  4004: 'Football (soccer)', 4005: 'Handball', 4006: 'American football', 5001: 'Volleyball',
  5002: 'Beach volleyball', 6001: 'Squash', 6002: 'Tennis', 6003: 'Badminton', 6004: 'Table tennis',
  6005: 'Racquetball', 7001: "T'ai chi", 7002: 'Boxing', 7003: 'Martial arts', 8001: 'Ballet',
  8002: 'Dancing', 8003: 'Ballroom dancing', 9001: 'Pilates', 9002: 'Yoga', 10001: 'Stretching',
  10002: 'Jump rope', 10003: 'Hula-hooping', 10004: 'Push-ups', 10005: 'Pull-ups', 10006: 'Sit-ups',
  10007: 'Circuit training', 10008: 'Mountain climbers', 10009: 'Jumping jacks', 10010: 'Burpee',
  10011: 'Bench press', 10012: 'Squats', 10013: 'Lunges', 10014: 'Leg presses', 10015: 'Leg extensions',
  10016: 'Leg curls', 10017: 'Back extensions', 10018: 'Lat pull-downs', 10019: 'Deadlifts',
  10020: 'Shoulder presses', 10021: 'Front raises', 10022: 'Lateral raises', 10023: 'Crunches',
  10024: 'Leg raises', 10025: 'Plank', 10026: 'Arm curls', 10027: 'Arm extensions',
  11001: 'Inline skating', 11002: 'Hang gliding', 11003: 'Pistol shooting', 11004: 'Archery',
  11005: 'Horseback riding', 11007: 'Cycling', 11008: 'Flying disc', 11009: 'Roller skating',
  12001: 'Aerobics', 13001: 'Hiking', 13002: 'Rock climbing', 13003: 'Backpacking',
  13004: 'Mountain biking', 13005: 'Orienteering', 14001: 'Swimming', 14002: 'Aquarobics',
  14003: 'Canoeing', 14004: 'Sailing', 14005: 'Scuba diving', 14006: 'Snorkeling', 14007: 'Kayaking',
  14008: 'Kitesurfing', 14009: 'Rafting', 14010: 'Rowing machine (general)', 14011: 'Windsurfing',
  14012: 'Yachting', 14013: 'Water skiing', 15001: 'Step machine', 15002: 'Weight machine',
  15003: 'Exercise bike', 15004: 'Rowing machine', 15005: 'Treadmill', 15006: 'Elliptical',
  16001: 'Cross-country skiing', 16002: 'Downhill skiing', 16003: 'Ice dancing', 16004: 'Ice skating',
  16006: 'Ice hockey', 16007: 'Snowboarding', 16008: 'Alpine skiing', 16009: 'Snowshoeing',
};

const TYPES = {
  daySummary: 'com.samsung.shealth.tracker.pedometer_day_summary',
  stepTrend: 'com.samsung.shealth.step_daily_trend',
  activity: 'com.samsung.shealth.activity.day_summary',
  calories: 'com.samsung.shealth.calories_burned.details',
  floors: 'com.samsung.shealth.tracker.floors_day_summary',
  hr: 'com.samsung.shealth.tracker.heart_rate',
  stress: 'com.samsung.shealth.stress',
  spo2: 'com.samsung.shealth.tracker.oxygen_saturation',
  resp: 'com.samsung.health.respiratory_rate',
  sleep: 'com.samsung.shealth.sleep',
  stages: 'com.samsung.health.sleep_stage',
  exercise: 'com.samsung.shealth.exercise',
};

const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

/** Look a column up by bare name, tolerating Samsung's namespace prefixes. */
const makeGetter = (header) => {
  const cache = new Map();
  return (rec, name) => {
    let key = cache.get(name);
    if (key === undefined) {
      key = header.find((h) => h === name) || header.find((h) => h.endsWith(`.${name}`)) || null;
      cache.set(name, key);
    }
    return key === null ? '' : rec[key];
  };
};

/** `day_time` → YYYY-MM-DD (epoch ms at UTC midnight of the local date, or a string). */
export const parseDayTime = (v) => {
  if (typeof v !== 'string' || v === '') return '';
  if (/^\d+$/.test(v)) return new Date(Number(v)).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '';
};

/** UTC start string + "UTC+0200" → {ms, offset}. */
const instant = (get, rec, field = 'start_time') => {
  const ms = parseIso(get(rec, field));
  const off = parseOffset(get(rec, 'time_offset'));
  return { ms, offset: Number.isFinite(off) ? off : 0 };
};

const newDay = () => ({
  steps: null, distance: NaN, activeTime: NaN, stepEnergy: NaN, stepsFromCombined: false,
  activeEnergy: NaN, restEnergy: NaN, exerciseTime: NaN, floors: NaN,
  hr: new Stat(), stress: new Stat(), spo2: new Stat(), resp: new Stat(),
});

export default async function parseSamsungHealthFile(file, onProgress) {
  const data = {};
  const parsingErrors = { sheetsNotFound: [], tablesNotParsed: [] };

  let zip;
  try {
    zip = await openZip(file);
  } catch (error) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Samsung Health Export', reason: `Failed to open the ZIP file: ${error.message}`, expectedFormat: 'ZIP',
    });
    return { data, parsingErrors };
  }

  // `<type>.<12-14 digit stamp>.csv`, outside the jsons/ and files/ folders.
  const byType = new Map();
  for (const e of zip.entries) {
    if (/(?:^|\/)(?:jsons|files)\//.test(e.name)) continue;
    const m = e.name.slice(e.name.lastIndexOf('/') + 1).match(/^(.+)\.(\d{12,14})\.csv$/);
    if (m) (byType.get(m[1]) || byType.set(m[1], []).get(m[1])).push(e);
  }
  const wanted = Object.values(TYPES).flatMap((t) => byType.get(t) || []);
  if (wanted.length === 0) {
    parsingErrors.sheetsNotFound.push('Samsung Health CSV files');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Samsung Health Export',
      reason: 'No Samsung Health CSV files were found in the ZIP file.',
      expectedPath: 'samsunghealth_<name>_<date>/com.samsung.shealth.*.csv',
    });
    return { data, parsingErrors };
  }

  const totalBytes = wanted.reduce((a, e) => a + e.compressedSize, 0) || 1;
  let doneBytes = 0;
  const read = async (type, onRec) => {
    for (const e of byType.get(type) || []) {
      try {
        const text = await zip.readText(e);
        const firstLine = text.slice(0, Math.max(0, text.search(/\r\n|\n|\r/))).replace(/^﻿/, '');
        // Metadata line "<type>,<n1>,<n2>" (users sometimes strip it), and
        // Excel re-saves with ';' as the delimiter.
        const first = firstLine.split(/[;,]/);
        const skipLines = first[0].startsWith('com.samsung') && first.length <= 3 ? 1 : 0;
        const headerLine = skipLines ? text.split(/\r\n|\n|\r/, 2)[1] || '' : firstLine;
        const delimiter = (headerLine.match(/;/g) || []).length > (headerLine.match(/,/g) || []).length ? ';' : ',';
        let get = null;
        forEachCsvRecord(text, (rec, header) => {
          if (!get) get = makeGetter(header);
          onRec(rec, get);
        }, { skipLines, delimiter });
      } catch (err) {
        parsingErrors.tablesNotParsed.push({ sheetName: type, reason: err.message, expectedFormat: 'CSV' });
      }
      doneBytes += e.compressedSize;
      if (onProgress) onProgress(doneBytes / totalBytes);
    }
  };

  const days = new Map();
  const dayOf = (d) => getOrCreate(days, d, newDay);

  // ---- Daily step summary: Combined row, else the largest device row ----
  await read(TYPES.daySummary, (r, get) => {
    const date = parseDayTime(get(r, 'day_time'));
    const steps = num(get(r, 'step_count'));
    if (!date || !Number.isFinite(steps)) return;
    const d = dayOf(date);
    const combined = get(r, 'deviceuuid') === COMBINED_DEVICE;
    if (d.stepsFromCombined && !combined) return;
    if (!combined && d.steps !== null && steps <= d.steps) return;
    d.steps = steps;
    d.stepsFromCombined = combined;
    d.distance = num(get(r, 'distance')) / 1000;
    d.activeTime = num(get(r, 'active_time')) / 60000;
    d.stepEnergy = num(get(r, 'calorie'));
  });
  // Older exports: step_daily_trend, where source_type -2 is the combined row.
  await read(TYPES.stepTrend, (r, get) => {
    const date = parseDayTime(get(r, 'day_time'));
    const steps = num(get(r, 'count'));
    if (!date || !Number.isFinite(steps) || get(r, 'source_type') !== '-2') return;
    const d = dayOf(date);
    if (d.steps !== null) return;
    d.steps = steps;
    d.distance = num(get(r, 'distance')) / 1000;
    d.stepEnergy = num(get(r, 'calorie'));
  });
  await read(TYPES.calories, (r, get) => {
    const date = parseDayTime(get(r, 'day_time'));
    if (!date) return;
    const d = dayOf(date);
    const active = num(get(r, 'active_calorie'));
    const rest = num(get(r, 'rest_calorie'));
    if (!(active <= d.activeEnergy)) d.activeEnergy = active;
    if (!(rest <= d.restEnergy)) d.restEnergy = rest;
  });
  await read(TYPES.activity, (r, get) => {
    const date = parseDayTime(get(r, 'day_time'));
    const ex = num(get(r, 'exercise_time')) / 60000;
    if (date && Number.isFinite(ex)) {
      const d = dayOf(date);
      if (!(ex <= d.exerciseTime)) d.exerciseTime = ex;
    }
  });
  await read(TYPES.floors, (r, get) => {
    const date = parseDayTime(get(r, 'day_time'));
    const f = num(get(r, 'floor_count'));
    if (date && Number.isFinite(f)) {
      const d = dayOf(date);
      if (!(f <= d.floors)) d.floors = f;
    }
  });

  // ---- Sampled metrics, bucketed by local day of each row ---------------
  const sample = (type, field, metric, accept = (v) => v > 0) => read(type, (r, get) => {
    const { ms, offset } = instant(get, r);
    const v = num(get(r, field));
    if (!Number.isFinite(ms) || !Number.isFinite(v) || !accept(v)) return;
    dayOf(localDay(ms, offset))[metric].add(v);
  });
  await read(TYPES.hr, (r, get) => {
    const { ms, offset } = instant(get, r);
    const bpm = num(get(r, 'heart_rate'));
    if (!Number.isFinite(ms) || !(bpm > 0)) return;
    const d = dayOf(localDay(ms, offset));
    d.hr.add(bpm);
    // Hourly summary rows also carry that hour's min / max.
    const lo = num(get(r, 'min'));
    const hi = num(get(r, 'max'));
    if (lo > 0) d.hr.min = Math.min(d.hr.min, lo);
    if (hi > 0) d.hr.max = Math.max(d.hr.max, hi);
  });
  await sample(TYPES.stress, 'score', 'stress', (v) => v >= 0 && v <= 100);
  await sample(TYPES.spo2, 'spo2', 'spo2', (v) => v > 50 && v <= 100);
  await sample(TYPES.resp, 'average', 'resp');

  // ---- Sleep ----------------------------------------------------------------
  const sessions = new Map();
  await read(TYPES.sleep, (r, get) => {
    const { ms: start, offset } = instant(get, r);
    const end = parseIso(get(r, 'end_time'));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
    sessions.set(get(r, 'datauuid'), {
      start, end, offset, device: get(r, 'deviceuuid'),
      efficiency: num(get(r, 'efficiency')), score: num(get(r, 'sleep_score')),
      awake: 0, light: 0, deep: 0, rem: 0, staged: false,
    });
  });
  await read(TYPES.stages, (r, get) => {
    const s = sessions.get(get(r, 'sleep_id'));
    const key = STAGES[get(r, 'stage')];
    const minutes = (parseIso(get(r, 'end_time')) - parseIso(get(r, 'start_time'))) / 60000;
    if (!s || !key || !(minutes > 0)) return;
    s[key] += minutes;
    s.staged = true;
  });
  const nights = new Map();
  for (const s of sessions.values()) {
    const night = getOrCreate(nights, sleepDay(s.start, s.offset), () => new Map());
    getOrCreate(night, s.device || '', () => []).push(s);
  }
  const sleepRows = [];
  for (const [date, byDevice] of nights) {
    // Prefer the device with stage data, then the most time recorded.
    let best = null;
    let bestScore = -1;
    for (const list of byDevice.values()) {
      const total = list.reduce((a, s) => a + (s.end - s.start), 0) / 60000;
      const score = (list.some((s) => s.staged) ? 1e6 : 0) + total;
      if (score > bestScore) { best = list; bestScore = score; }
    }
    best.sort((a, b) => a.start - b.start);
    const sum = (k) => best.reduce((a, s) => a + s[k], 0);
    const inBed = best.reduce((a, s) => a + (s.end - s.start), 0) / 60000;
    const staged = best.some((s) => s.staged);
    const asleep = staged ? sum('light') + sum('deep') + sum('rem') : inBed;
    const main = best.reduce((a, s) => (s.end - s.start > a.end - a.start ? s : a));
    const first = best[0];
    const last = best[best.length - 1];
    sleepRows.push({
      Date: date,
      'Sleep Start': formatLocal(first.start, first.offset),
      'Sleep End': formatLocal(last.end, last.offset),
      'Total Asleep': formatDuration(asleep * 60),
      'Asleep (min)': fmtNum(asleep, 0),
      'Recorded (min)': fmtNum(inBed, 0),
      'Light (min)': staged ? fmtNum(sum('light'), 0) : '',
      'Deep (min)': staged ? fmtNum(sum('deep'), 0) : '',
      'REM (min)': staged ? fmtNum(sum('rem'), 0) : '',
      'Awake (min)': staged ? fmtNum(sum('awake'), 0) : '',
      'Efficiency (%)': fmtNum(main.efficiency, 0),
      'Sleep Score': fmtNum(main.score, 0),
      Sessions: String(best.length),
      _timestamp: dayTimestamp(date),
    });
  }
  sleepRows.sort((a, b) => a.Date.localeCompare(b.Date));
  const sleepDays = new Set(sleepRows.map((r) => r.Date));

  // ---- Exercise -------------------------------------------------------------
  const exerciseRows = [];
  await read(TYPES.exercise, (r, get) => {
    const { ms: start, offset } = instant(get, r);
    if (!Number.isFinite(start)) return;
    const code = num(get(r, 'exercise_type'));
    const activity = EXERCISE_TYPES[code] || (Number.isFinite(code) ? `Type ${code}` : 'Unknown');
    const durMs = num(get(r, 'duration'));
    const calories = num(get(r, 'calorie'));
    const pos = (v) => (v > 0 ? v : NaN);
    exerciseRows.push({
      Activity: activity,
      'Start Time': formatLocal(start, offset),
      Duration: Number.isFinite(durMs) ? formatDuration(durMs / 1000) : '',
      'Duration (min)': fmtNum(durMs / 60000, 1),
      'Distance (km)': fmtNum(pos(num(get(r, 'distance'))) / 1000, 2),
      'Calories (kcal)': fmtNum(Number.isFinite(calories) ? calories : num(get(r, 'total_calorie')), 0),
      Steps: get(r, 'count_type') === '30001' ? fmtNum(get(r, 'count'), 0) : '',
      'Avg HR (bpm)': fmtNum(pos(num(get(r, 'mean_heart_rate'))), 0),
      'Max HR (bpm)': fmtNum(pos(num(get(r, 'max_heart_rate'))), 0),
      _timestamp: start,
      _app: activity,
    });
  });
  exerciseRows.sort((a, b) => a._timestamp - b._timestamp);

  // ---- Daily Activity ---------------------------------------------------------
  const dailyRows = [];
  for (const [date, d] of days) {
    const row = {
      Date: date,
      Steps: fmtNum(d.steps, 0),
      'Distance (km)': fmtNum(d.distance, 2),
      'Active Time (min)': fmtNum(d.activeTime, 0),
      'Exercise Time (min)': fmtNum(d.exerciseTime, 0),
      'Active Energy (kcal)': fmtNum(Number.isFinite(d.activeEnergy) ? d.activeEnergy : d.stepEnergy, 0),
      'Resting Energy (kcal)': fmtNum(d.restEnergy, 0),
      'Floors Climbed': fmtNum(d.floors, 0),
      'Avg HR (bpm)': fmtNum(d.hr.mean, 0),
      'Min HR (bpm)': fmtNum(d.hr.lo, 0),
      'Max HR (bpm)': fmtNum(d.hr.hi, 0),
      'Avg Stress': fmtNum(d.stress.mean, 0),
      'SpO2 (%)': fmtNum(d.spo2.mean, 1),
      'Respiratory Rate (brpm)': fmtNum(d.resp.mean, 1),
      _timestamp: dayTimestamp(date),
    };
    // Samsung computes resting (BMR) calories for every day, worn or not, so
    // a day needs a real measurement (or a sleep) to become a row.
    const signal = ['Steps', 'Active Time (min)', 'Exercise Time (min)', 'Floors Climbed', 'Avg HR (bpm)',
      'Avg Stress', 'SpO2 (%)', 'Respiratory Rate (brpm)'].some((k) => row[k] !== '' && Number(row[k]) > 0);
    if (!signal && !sleepDays.has(date)) continue;
    dailyRows.push(row);
  }
  dailyRows.sort((a, b) => a.Date.localeCompare(b.Date));

  if (dailyRows.length > 0) data['Daily Activity'] = dailyRows;
  else parsingErrors.sheetsNotFound.push('Daily activity');
  if (sleepRows.length > 0) data['Sleep'] = sleepRows;
  else parsingErrors.sheetsNotFound.push('Sleep');
  if (exerciseRows.length > 0) data['Exercise'] = exerciseRows;
  else parsingErrors.sheetsNotFound.push('Exercise');

  return { data, parsingErrors };
}

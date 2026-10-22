import { openZip } from '../utils/zipReader';
import { forEachCsvRecord } from '../utils/csv';
import {
  fmtNum, formatDuration, dayTimestamp, Stat, SourceTotals, getOrCreate,
} from '../utils/wearableFormat';
import {
  parseMdy, parseIso, parseOffset, formatOffset, Localizer, formatWall, wallDay,
} from './fitbitTime';

/**
 * Parser for Fitbit data from Google Takeout (takeout.google.com → "Fitbit",
 * or "Google Health" after the 2026 rename) and the older fitbit.com account
 * archive. Every known layout is read:
 *
 *   - Legacy JSON, `Global Export Data/` (or `Physical Activity/` + `Sleep/`):
 *     `steps-*.json`, `distance-*.json`, `calories-*.json`, `heart_rate-*.json`,
 *     `resting_heart_rate-*.json`, `*_active_minutes-*.json`,
 *     `sedentary_minutes-*.json`, `sleep-*.json`, `exercise-N.json`.
 *   - Google-data CSVs, `Physical Activity_GoogleData/` (flat or one
 *     subfolder per family) + `Health Fitness Data_GoogleData/`
 *     (`UserSleeps`, `UserSleepStages`, `UserExercises`).
 *   - Legacy daily CSVs: sleep score, HRV, SpO2, respiratory rate summaries.
 *
 * Review tables: "Daily Activity", "Sleep", "Exercise".
 *
 * The same metric appears in several places, and the CSVs once per source
 * (phone, band, Health Connect mirror), so nothing is summed across sources:
 * the Global Export JSON is Fitbit's reconciled stream and wins; otherwise
 * the best native CSV source for the day is used, Health Connect only as a
 * last resort. Timezones follow ./fitbitTime.js (steps/HR UTC, sleep and
 * exercise JSON local). Placeholder days Fitbit pads into the future are
 * dropped.
 *
 * Never read: profile / account / security folders, paired devices, GPS and
 * location, weather, nutrition, weight, menstrual and ECG data, messages.
 *
 * @param {File} file - Takeout .zip
 * @param {(fraction: number) => void} [onProgress]
 */

const FOLDER_HINT = /(?:^|\/)(?:Global Export Data|Physical Activity(?:_GoogleData)?|Health Fitness Data_GoogleData|Sleep|Sleep Score|Heart Rate Variability|Oxygen Saturation \(SpO2\))\//i;

const JSON_FILES = {
  steps: /^steps-\d{4}-\d{2}-\d{2}\.json$/i,
  distance: /^distance-\d{4}-\d{2}-\d{2}\.json$/i,
  calories: /^calories-\d{4}-\d{2}-\d{2}\.json$/i,
  hr: /^heart_rate-\d{4}-\d{2}-\d{2}\.json$/i,
  restingHr: /^resting_heart_rate-\d{4}-\d{2}-\d{2}\.json$/i,
  light: /^lightly_active_minutes-\d{4}-\d{2}-\d{2}\.json$/i,
  moderate: /^moderately_active_minutes-\d{4}-\d{2}-\d{2}\.json$/i,
  very: /^very_active_minutes-\d{4}-\d{2}-\d{2}\.json$/i,
  sedentary: /^sedentary_minutes-\d{4}-\d{2}-\d{2}\.json$/i,
  sleep: /^sleep-\d{4}-\d{2}-\d{2}\.json$/i,
  exercise: /^exercise-\d+\.json$/i,
};

const dated = (name) => new RegExp(`^${name}(?:_(?:\\d{4}-\\d{2}-\\d{2}|all))?\\.csv$`, 'i');
const CSV_FILES = {
  steps: dated('steps'),
  distance: dated('distance'),
  calories: dated('calories'),
  hr: dated('heart_rate'),
  activeMinutes: dated('active_minutes'),
  azm: dated('active_zone_minutes'),
  restingHr: dated('daily_resting_heart_rate'),
  hrv: dated('daily_heart_rate_variability'),
  spo2: dated('daily_oxygen_saturation'),
  resp: dated('daily_respiratory_rate'),
  sleeps: /^UserSleeps(?:_.*)?\.csv$/i,
  stages: /^UserSleepStages(?:_.*)?\.csv$/i,
  exercises: /^UserExercises(?:_.*)?\.csv$/i,
  sleepScore: /^sleep_score\.csv$/i,
  legacyHrv: /^Daily Heart Rate Variability Summary - .*\.csv$/i,
  legacySpo2: /^Daily SpO2 - .*\.csv$/i,
  legacyResp: /^Daily Respiratory Rate Summary - .*\.csv$/i,
};

const JSON_SOURCE = 'Fitbit';
const isHealthConnect = (s) => /health\s*connect/i.test(s);
const num = (v) => (v === '' || v === null || v === undefined ? NaN : Number(v));

const newDay = () => ({
  steps: new SourceTotals(), distance: new SourceTotals(), calories: new SourceTotals(),
  light: new SourceTotals(), moderate: new SourceTotals(), very: new SourceTotals(),
  sedentary: new SourceTotals(), azm: new SourceTotals(),
  hr: new Map(), restingHr: new Stat(), hrv: new Stat(), spo2: new Stat(), resp: new Stat(),
  offset: NaN,
});

/**
 * One value for the day: the reconciled JSON stream when present, otherwise
 * the largest native CSV source, Health Connect only when nothing else exists.
 */
const pick = (totals) => {
  const m = totals.bySource;
  if (m.has(JSON_SOURCE)) return m.get(JSON_SOURCE);
  let best = NaN;
  let bestHc = NaN;
  for (const [src, v] of m) {
    if (isHealthConnect(src)) { if (!(v <= bestHc)) bestHc = v; } else if (!(v <= best)) best = v;
  }
  return Number.isFinite(best) ? best : bestHc;
};

export default async function parseFitbitFile(file, onProgress) {
  const data = {};
  const parsingErrors = { sheetsNotFound: [], tablesNotParsed: [] };

  let zip;
  try {
    zip = await openZip(file);
  } catch (error) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Fitbit Export', reason: `Failed to open the ZIP file: ${error.message}`, expectedFormat: 'ZIP',
    });
    return { data, parsingErrors };
  }

  // Classify entries by base name, only inside the health folders.
  const files = {};
  for (const e of zip.entries) {
    if (!FOLDER_HINT.test(e.name)) continue;
    const base = e.name.slice(e.name.lastIndexOf('/') + 1);
    const group = /\.json$/i.test(base) ? JSON_FILES : CSV_FILES;
    for (const [key, re] of Object.entries(group)) {
      if (re.test(base)) {
        const k = group === JSON_FILES ? `json:${key}` : `csv:${key}`;
        (files[k] = files[k] || []).push(e);
        break;
      }
    }
  }
  const allEntries = Object.values(files).flat();
  if (allEntries.length === 0) {
    parsingErrors.sheetsNotFound.push('Fitbit data');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Fitbit Export',
      reason: 'No Fitbit / Google Health data files were found in the ZIP file.',
      expectedPath: 'Takeout/Fitbit/… or Takeout/Google Health/…',
    });
    return { data, parsingErrors };
  }

  const totalBytes = allEntries.reduce((a, e) => a + e.compressedSize, 0) || 1;
  let doneBytes = 0;
  const read = async (key, onText) => {
    for (const e of files[key] || []) {
      try {
        onText(await zip.readText(e));
      } catch (err) {
        parsingErrors.tablesNotParsed.push({ sheetName: e.name, reason: err.message, expectedFormat: key });
      }
      doneBytes += e.compressedSize;
      if (onProgress) onProgress(doneBytes / totalBytes);
    }
  };
  const readJsonArray = (key, onItem) => read(key, (text) => {
    let arr;
    try { arr = JSON.parse(text); } catch (e) { return; }
    if (Array.isArray(arr)) for (const item of arr) if (item && typeof item === 'object') onItem(item);
  });
  const readCsv = (key, onRec) => read(key, (text) => forEachCsvRecord(text, onRec));

  const days = new Map();
  const dayOf = (d) => getOrCreate(days, d, newDay);
  const loc = new Localizer();

  // ---- Pass 1: rows that carry their own UTC offset --------------------
  const csvSleeps = new Map();
  await readCsv('csv:sleeps', (r) => {
    const start = parseIso(r.sleep_start);
    const end = parseIso(r.sleep_end);
    const so = parseOffset(r.start_utc_offset);
    const eo = parseOffset(r.end_utc_offset);
    loc.observe(start, so);
    loc.observe(end, eo);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    csvSleeps.set(r.sleep_id, {
      start, end, so, eo, type: (r.sleep_type || '').toLowerCase(),
      asleep: num(r.minutes_asleep), awake: num(r.minutes_awake),
      inBed: num(r.minutes_in_sleep_period), source: r.data_source || '',
      stages: { deep: 0, light: 0, rem: 0, wake: 0, asleep: 0 }, staged: false,
    });
  });
  await readCsv('csv:stages', (r) => {
    const s = csvSleeps.get(r.sleep_id);
    const minutes = (parseIso(r.sleep_stage_end) - parseIso(r.sleep_stage_start)) / 60000;
    if (!s || !Number.isFinite(minutes) || minutes <= 0) return;
    const t = (r.sleep_stage_type || '').toUpperCase();
    const key = { DEEP: 'deep', LIGHT: 'light', REM: 'rem', AWAKE: 'wake', WAKE: 'wake', ASLEEP: 'asleep' }[t];
    if (!key) return;
    s.stages[key] += minutes;
    if (key === 'deep' || key === 'light' || key === 'rem') s.staged = true;
  });
  const csvExercises = [];
  await readCsv('csv:exercises', (r) => {
    const start = parseIso(r.exercise_start);
    const end = parseIso(r.exercise_end);
    const off = parseOffset(r.utc_offset);
    loc.observe(start, off);
    if (!Number.isFinite(start)) return;
    const pickNum = (...keys) => { for (const k of keys) { const v = num(r[k]); if (Number.isFinite(v) && v > 0) return v; } return NaN; };
    csvExercises.push({
      start, end, off,
      activity: r.activity_name || 'Unknown',
      calories: pickNum('tracker_total_calories', 'manually_logged_total_calories'),
      steps: pickNum('tracker_total_steps', 'manually_logged_total_steps'),
      distanceKm: pickNum('tracker_total_distance_mm', 'manually_logged_total_distance_mm') / 1e6,
      avgHr: num(r.tracker_avg_heart_rate),
      maxHr: num(r.tracker_peak_heart_rate),
      logType: r.log_type || '',
    });
  });

  // ---- Pass 2: minute streams and daily series -------------------------
  const addUtc = (metric, ms, v, source) => {
    if (!Number.isFinite(ms) || !Number.isFinite(v)) return;
    const { day, offset } = loc.localDayOf(ms);
    const d = dayOf(day);
    d.offset = offset;
    d[metric].add(source, v);
  };
  const addWall = (metric, wallMs, v, source) => {
    if (!Number.isFinite(wallMs) || !Number.isFinite(v)) return;
    dayOf(wallDay(wallMs))[metric].add(source, v);
  };
  const addHr = (ms, bpm, source) => {
    if (!Number.isFinite(ms) || !Number.isFinite(bpm) || bpm <= 0) return;
    const { day, offset } = loc.localDayOf(ms);
    const d = dayOf(day);
    d.offset = offset;
    getOrCreate(d.hr, source, () => new Stat()).add(bpm);
  };
  const addDaily = (metric, dayStr, v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr) || !Number.isFinite(v) || v <= 0) return;
    dayOf(dayStr)[metric].add(v);
  };

  // Legacy JSON (steps / distance / HR are UTC; calories local).
  await readJsonArray('json:steps', (it) => addUtc('steps', parseMdy(it.dateTime), num(it.value), JSON_SOURCE));
  await readJsonArray('json:distance', (it) => addUtc('distance', parseMdy(it.dateTime), num(it.value) / 100000, JSON_SOURCE));
  await readJsonArray('json:calories', (it) => addWall('calories', parseMdy(it.dateTime), num(it.value), JSON_SOURCE));
  await readJsonArray('json:hr', (it) => addHr(parseMdy(it.dateTime), num(it.value && it.value.bpm), JSON_SOURCE));
  for (const k of ['light', 'moderate', 'very', 'sedentary']) {
    // eslint-disable-next-line no-await-in-loop
    await readJsonArray(`json:${k}`, (it) => addWall(k, parseMdy(it.dateTime), num(it.value), JSON_SOURCE));
  }
  await readJsonArray('json:restingHr', (it) => {
    const v = it.value || {};
    if (!v.date) return; // placeholder {date: null, value: 0}
    addDaily('restingHr', wallDay(parseMdy(v.date)), num(v.value));
  });

  // Google-data CSVs (UTC timestamps; daily files carry the local date).
  const src = (r) => r['data source'] || 'Fitbit (CSV)';
  await readCsv('csv:steps', (r) => addUtc('steps', parseIso(r.timestamp), num(r.steps), src(r)));
  await readCsv('csv:distance', (r) => addUtc('distance', parseIso(r.timestamp), num(r.distance) / 1000, src(r)));
  await readCsv('csv:calories', (r) => addUtc('calories', parseIso(r.timestamp), num(r.calories), src(r)));
  await readCsv('csv:hr', (r) => addHr(parseIso(r.timestamp), num(r['beats per minute']), src(r)));
  await readCsv('csv:activeMinutes', (r) => {
    const ms = parseIso(r.timestamp);
    addUtc('light', ms, num(r.light), src(r));
    addUtc('moderate', ms, num(r.moderate), src(r));
    addUtc('very', ms, num(r.very), src(r));
  });
  await readCsv('csv:azm', (r) => addUtc('azm', parseIso(r.timestamp), num(r['total minutes']), src(r)));
  await readCsv('csv:restingHr', (r) => addDaily('restingHr', (r.timestamp || '').slice(0, 10), num(r['beats per minute'])));
  await readCsv('csv:hrv', (r) => addDaily('hrv', (r.timestamp || '').slice(0, 10), num(r['average heart rate variability milliseconds'])));
  await readCsv('csv:spo2', (r) => addDaily('spo2', (r.timestamp || '').slice(0, 10), num(r['average percentage'])));
  await readCsv('csv:resp', (r) => addDaily('resp', (r.timestamp || '').slice(0, 10), num(r['breaths per minute'])));
  await readCsv('csv:legacyHrv', (r) => addDaily('hrv', (r.timestamp || '').slice(0, 10), num(r.rmssd)));
  await readCsv('csv:legacySpo2', (r) => addDaily('spo2', (r.timestamp || '').slice(0, 10), num(r.average_value)));
  await readCsv('csv:legacyResp', (r) => addDaily('resp', (r.timestamp || '').slice(0, 10), num(r.full_sleep_breathing_rate)));

  // ---- Sleep -------------------------------------------------------------
  const sleepScores = new Map();
  await readCsv('csv:sleepScore', (r) => sleepScores.set(String(r.sleep_log_entry_id), num(r.overall_score)));

  const sleepRows = new Map(); // key: local start minute → row (JSON wins)
  const minutes = (summary, k) => (summary && summary[k] ? num(summary[k].minutes) : NaN);
  await readJsonArray('json:sleep', (s) => {
    const start = parseIso(s.startTime);
    const end = parseIso(s.endTime);
    if (!Number.isFinite(start)) return;
    const summary = s.levels && s.levels.summary;
    const stages = s.type === 'stages';
    const key = formatWall(start);
    const date = s.dateOfSleep || wallDay(end);
    sleepRows.set(key, {
      Date: date,
      'Sleep Start': key,
      'Sleep End': formatWall(end),
      'Main Sleep': s.mainSleep === true ? 'Yes' : s.mainSleep === false ? 'No' : '',
      Type: stages ? 'Stages' : 'Classic',
      'Total Asleep': Number.isFinite(num(s.minutesAsleep)) ? formatDuration(num(s.minutesAsleep) * 60) : '',
      'Asleep (min)': fmtNum(s.minutesAsleep, 0),
      'Awake (min)': fmtNum(s.minutesAwake, 0),
      'In Bed (min)': fmtNum(s.timeInBed, 0),
      'Deep (min)': stages ? fmtNum(minutes(summary, 'deep'), 0) : '',
      'Light (min)': stages ? fmtNum(minutes(summary, 'light'), 0) : '',
      'REM (min)': stages ? fmtNum(minutes(summary, 'rem'), 0) : '',
      'Wake (min)': stages ? fmtNum(minutes(summary, 'wake'), 0) : '',
      'Restless (min)': stages ? '' : fmtNum(minutes(summary, 'restless'), 0),
      'Efficiency (%)': fmtNum(s.efficiency, 0),
      'Sleep Score': fmtNum(sleepScores.get(String(s.logId)), 0),
      Source: s.logType || '',
      _timestamp: dayTimestamp(date),
    });
  });
  for (const s of csvSleeps.values()) {
    const so = Number.isFinite(s.so) ? s.so : loc.offsetAt(s.start);
    const eo = Number.isFinite(s.eo) ? s.eo : loc.offsetAt(s.end);
    const key = formatWall(s.start + so * 60000);
    if (sleepRows.has(key)) continue;
    const date = wallDay(s.end + eo * 60000); // dated by local wake date
    const st = s.stages;
    sleepRows.set(key, {
      Date: date,
      'Sleep Start': key,
      'Sleep End': formatWall(s.end + eo * 60000),
      'Main Sleep': '',
      Type: s.staged || s.type === 'stages' ? 'Stages' : 'Classic',
      'Total Asleep': Number.isFinite(s.asleep) ? formatDuration(s.asleep * 60) : '',
      'Asleep (min)': fmtNum(s.asleep, 0),
      'Awake (min)': fmtNum(s.awake, 0),
      'In Bed (min)': fmtNum(Number.isFinite(s.inBed) ? s.inBed : (s.end - s.start) / 60000, 0),
      'Deep (min)': s.staged ? fmtNum(st.deep, 0) : '',
      'Light (min)': s.staged ? fmtNum(st.light, 0) : '',
      'REM (min)': s.staged ? fmtNum(st.rem, 0) : '',
      'Wake (min)': s.staged ? fmtNum(st.wake, 0) : '',
      'Restless (min)': '',
      'Efficiency (%)': '',
      'Sleep Score': '',
      Source: s.source,
      _timestamp: dayTimestamp(date),
    });
  }
  const sleeps = Array.from(sleepRows.values()).sort((a, b) => a['Sleep Start'].localeCompare(b['Sleep Start']));
  const sleepDays = new Set(sleeps.map((r) => r.Date));

  // ---- Exercise ----------------------------------------------------------
  const exerciseRows = new Map();
  await readJsonArray('json:exercise', (x) => {
    const start = parseMdy(x.startTime);
    if (!Number.isFinite(start)) return;
    const dur = num(x.activeDuration) || num(x.duration);
    let km = num(x.distance);
    if (/mile/i.test(x.distanceUnit || '')) km *= 1.609344;
    const activity = x.activityName || 'Unknown';
    const key = `${formatWall(start)}|${activity}`;
    exerciseRows.set(key, {
      Activity: activity,
      'Start Time': formatWall(start),
      Duration: Number.isFinite(dur) ? formatDuration(dur / 1000) : '',
      'Duration (min)': fmtNum(dur / 60000, 1),
      'Distance (km)': fmtNum(km, 2),
      'Calories (kcal)': fmtNum(x.calories, 0),
      Steps: fmtNum(x.steps, 0),
      'Avg HR (bpm)': fmtNum(x.averageHeartRate, 0),
      'Max HR (bpm)': '',
      'Log Type': x.logType || '',
      _timestamp: Date.parse(new Date(start).toISOString().slice(0, 19)),
      _app: activity,
    });
  });
  for (const x of csvExercises) {
    const off = Number.isFinite(x.off) ? x.off : loc.offsetAt(x.start);
    const wall = x.start + off * 60000;
    const key = `${formatWall(wall)}|${x.activity}`;
    if (exerciseRows.has(key)) continue;
    const durMs = x.end - x.start;
    exerciseRows.set(key, {
      Activity: x.activity,
      'Start Time': formatWall(wall),
      Duration: Number.isFinite(durMs) ? formatDuration(durMs / 1000) : '',
      'Duration (min)': fmtNum(durMs / 60000, 1),
      'Distance (km)': fmtNum(x.distanceKm, 2),
      'Calories (kcal)': fmtNum(x.calories, 0),
      Steps: fmtNum(x.steps, 0),
      'Avg HR (bpm)': fmtNum(x.avgHr, 0),
      'Max HR (bpm)': fmtNum(x.maxHr, 0),
      'Log Type': x.logType,
      _timestamp: x.start,
      _app: x.activity,
    });
  }
  const exercises = Array.from(exerciseRows.values()).sort((a, b) => a['Start Time'].localeCompare(b['Start Time']));

  // ---- Daily Activity ----------------------------------------------------
  const dailyRows = [];
  for (const [date, d] of days) {
    // Heart rate from the source with the most samples that day.
    let hr = null;
    for (const s of d.hr.values()) if (!hr || s.n > hr.n) hr = s;
    const row = {
      Date: date,
      Steps: fmtNum(pick(d.steps), 0),
      'Distance (km)': fmtNum(pick(d.distance), 2),
      'Calories (kcal)': fmtNum(pick(d.calories), 0),
      'Lightly Active (min)': fmtNum(pick(d.light), 0),
      'Fairly Active (min)': fmtNum(pick(d.moderate), 0),
      'Very Active (min)': fmtNum(pick(d.very), 0),
      'Sedentary (min)': fmtNum(pick(d.sedentary), 0),
      'Active Zone Minutes': fmtNum(pick(d.azm), 0),
      'Avg HR (bpm)': fmtNum(hr && hr.mean, 0),
      'Min HR (bpm)': fmtNum(hr && hr.lo, 0),
      'Max HR (bpm)': fmtNum(hr && hr.hi, 0),
      'Resting HR (bpm)': fmtNum(d.restingHr.mean, 0),
      'HRV RMSSD (ms)': fmtNum(d.hrv.mean, 1),
      'SpO2 (%)': fmtNum(d.spo2.mean, 1),
      'Respiratory Rate (brpm)': fmtNum(d.resp.mean, 1),
      'UTC Offset': formatOffset(d.offset),
      _timestamp: dayTimestamp(date),
    };
    // Drop days with no real signal (Fitbit pads daily files into the future
    // with sedentary 1440 / 0 placeholders; calories alone are BMR estimates).
    const signal = ['Steps', 'Distance (km)', 'Lightly Active (min)', 'Fairly Active (min)', 'Very Active (min)',
      'Active Zone Minutes', 'Avg HR (bpm)', 'Resting HR (bpm)', 'HRV RMSSD (ms)', 'SpO2 (%)', 'Respiratory Rate (brpm)']
      .some((k) => row[k] !== '' && Number(row[k]) > 0);
    if (!signal && !sleepDays.has(date)) continue;
    dailyRows.push(row);
  }
  dailyRows.sort((a, b) => a.Date.localeCompare(b.Date));

  if (dailyRows.length > 0) data['Daily Activity'] = dailyRows;
  else parsingErrors.sheetsNotFound.push('Daily activity');
  if (sleeps.length > 0) data['Sleep'] = sleeps;
  else parsingErrors.sheetsNotFound.push('Sleep');
  if (exercises.length > 0) data['Exercise'] = exercises;
  else parsingErrors.sheetsNotFound.push('Exercise');

  return { data, parsingErrors };
}

import { openZip, isZip, readSlice } from '../utils/zipReader';
import { openDatabase } from '../utils/sqliteReader';
import sha256Hex from '../utils/sha256';
import {
  fmtNum, formatDuration, dayTimestamp, formatLocal, localDay, sleepDay,
  humanize, Stat, SourceTotals, getOrCreate,
} from '../utils/wearableFormat';

/**
 * Parser for an Android Health Connect export (Settings → Health Connect →
 * Manage data → Export data; Android 15+). The export is `Health Connect.zip`
 * holding one unencrypted SQLite database, `health_connect_export.db`, which
 * is read in the browser by a small pure-JS SQLite reader (no WASM).
 *
 * Review tables:
 *   1. "Daily Activity" — per local day: steps, distance, active / total
 *      energy, floors, heart rate (avg/min/max), resting HR, HRV (RMSSD),
 *      SpO2, respiratory rate.
 *   2. "Sleep"          — per night: sleep window and stage minutes.
 *   3. "Exercise"       — per session: type, start, duration, heart rate
 *      during the session, and a Record Key (salted SHA-256 of the Health
 *      Connect record UUID) so repeat donations from the same person can be
 *      de-duplicated without exporting the UUID itself, which apps can derive
 *      from their own record IDs.
 *
 * Never read: session titles and notes (free text), exercise routes (GPS),
 * weight / body measurements, nutrition, and every other table. Several apps
 * often write the same steps (e.g. Fit and Samsung Health both syncing), so
 * cumulative daily metrics keep the largest single-app total.
 *
 * Schema (AOSP HealthFitness): times are epoch ms (UTC) with zone offsets in
 * seconds; energy is stored in calories (÷1000 → kcal); distance in metres.
 * Child tables (heart-rate series, sleep stages) point to their parent's
 * `row_id` via `parent_key`.
 *
 * @param {File} file - Health Connect .zip (or the bare .db)
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Promise<{data: Object, parsingErrors: {sheetsNotFound: string[], tablesNotParsed: Object[]}}>}
 */

// android.health.connect.datatypes.ExerciseSessionType (framework values,
// which differ from the Jetpack androidx constants).
const EXERCISE_TYPES = [
  'Unknown', 'Badminton', 'Baseball', 'Basketball', 'Biking', 'Biking (stationary)',
  'Boot camp', 'Boxing', 'Calisthenics', 'Cricket', 'Dancing', 'Exercise class',
  'Fencing', 'American football', 'Australian football', 'Frisbee', 'Golf',
  'Guided breathing', 'Gymnastics', 'Handball', 'HIIT', 'Hiking', 'Ice hockey',
  'Ice skating', 'Martial arts', 'Paddling', 'Paragliding', 'Pilates', 'Racquetball',
  'Rock climbing', 'Roller hockey', 'Rowing', 'Rugby', 'Running', 'Running (treadmill)',
  'Sailing', 'Scuba diving', 'Skating', 'Skiing', 'Snowboarding', 'Snowshoeing',
  'Soccer', 'Softball', 'Squash', 'Stair climbing', 'Strength training', 'Stretching',
  'Surfing', 'Swimming (open water)', 'Swimming (pool)', 'Table tennis', 'Tennis',
  'Volleyball', 'Walking', 'Water polo', 'Weightlifting', 'Wheelchair', 'Yoga',
  'Other workout', 'Stair climbing machine', 'Elliptical', 'Rowing machine',
];

// Sleep stage_type: 0 unknown, 1 awake, 2 sleeping, 3 out of bed,
// 4 light, 5 deep, 6 REM, 7 awake in bed.
const STAGE_KEY = { 1: 'awake', 2: 'unspecified', 3: 'awake', 4: 'light', 5: 'deep', 6: 'rem', 7: 'awake' };

const DAILY_CUMULATIVE = [
  ['steps_record_table', 'count', 'steps', 1],
  ['distance_record_table', 'distance', 'distance', 1 / 1000],
  ['active_calories_burned_record_table', 'energy', 'activeEnergy', 1 / 1000],
  ['total_calories_burned_record_table', 'energy', 'totalEnergy', 1 / 1000],
  ['floors_climbed_record_table', 'floors', 'floors', 1],
];

const DAILY_SAMPLED = [
  ['resting_heart_rate_record_table', 'beats_per_minute', 'restingHr'],
  ['heart_rate_variability_rmssd_record_table', 'heart_rate_variability_millis', 'hrv'],
  ['oxygen_saturation_record_table', 'percentage', 'spo2'],
  ['respiratory_rate_record_table', 'rate', 'resp'],
];

/** 16-byte uuid blob → canonical 8-4-4-4-12 hex string. */
export const uuidToString = (blob) => {
  if (!(blob instanceof Uint8Array) || blob.length !== 16) return '';
  const hex = Array.from(blob, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// Salt for Record Keys; bump the version to unlink keys across studies.
const RECORD_KEY_SALT = 'universal-data-donor/healthconnect/v1';
export const recordKey = (uuid) => (uuid ? sha256Hex(`${RECORD_KEY_SALT}|${uuid}`).slice(0, 20) : '');

const offsetMin = (seconds) => (Number.isFinite(Number(seconds)) ? Number(seconds) / 60 : 0);

const newNightSource = () => ({
  unspecified: 0, light: 0, deep: 0, rem: 0, awake: 0, inBed: 0,
  start: Infinity, end: -Infinity, offset: 0,
});

/**
 * Locate and read the SQLite bytes from the upload.
 * @param {File} file
 * @returns {Promise<Uint8Array|null>}
 */
const loadDatabaseBytes = async (file, onProgress) => {
  if (!(await isZip(file))) return readSlice(file, 0, file.size);
  const zip = await openZip(file);
  const dbs = zip.entries
    .filter((e) => /\.db$/i.test(e.name))
    .sort((a, b) => (/health_connect_export\.db$/i.test(b.name) - /health_connect_export\.db$/i.test(a.name))
      || b.size - a.size);
  if (dbs.length === 0) return null;
  return zip.readBytes(dbs[0], onProgress);
};

export default async function parseHealthConnectFile(file, onProgress) {
  const data = {};
  const parsingErrors = { sheetsNotFound: [], tablesNotParsed: [] };

  let db;
  try {
    const bytes = await loadDatabaseBytes(file, onProgress);
    if (!bytes) {
      parsingErrors.sheetsNotFound.push('health_connect_export.db');
      parsingErrors.tablesNotParsed.push({
        sheetName: 'Health Connect Export',
        reason: 'No database file (.db) was found inside the ZIP file.',
        expectedPath: 'health_connect_export.db',
      });
      return { data, parsingErrors };
    }
    db = openDatabase(bytes);
  } catch (error) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Health Connect Export',
      reason: `Failed to read the file: ${error.message}`,
      expectedFormat: 'ZIP containing health_connect_export.db',
    });
    return { data, parsingErrors };
  }

  if (!db.hasTable('application_info_table') && !db.hasTable('steps_record_table')) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Health Connect Export',
      reason: 'The database is not a Health Connect export (no Health Connect tables).',
      expectedFormat: 'health_connect_export.db',
    });
    return { data, parsingErrors };
  }

  // Each table is read in its own guard: a corrupt page or row in one table
  // is reported and skipped without losing the others.
  const safely = (table, fn) => {
    try {
      fn();
    } catch (error) {
      parsingErrors.tablesNotParsed.push({
        sheetName: table,
        reason: `Failed to read this part of the database: ${error.message}`,
        expectedFormat: 'health_connect_export.db',
      });
    }
  };

  // App labels: the app's display name (e.g. "Fit", "Samsung Health").
  const apps = new Map();
  safely('Apps', () => {
    for (const row of db.rows('application_info_table')) {
      apps.set(row.row_id, row.app_name || row.package_name || 'Unknown app');
    }
  });
  const appLabel = (id) => apps.get(id) || 'Unknown app';

  const days = new Map();
  const newDay = () => ({ cumulative: new Map(), sampled: new Map() });

  {
    // ---- Cumulative interval records ------------------------------------
    for (const [table, column, key, scale] of DAILY_CUMULATIVE) {
      safely(table, () => {
        for (const row of db.rows(table)) {
          const v = Number(row[column]) * scale;
          const day = localDay(Number(row.start_time), offsetMin(row.start_zone_offset));
          if (!day || !Number.isFinite(v)) continue;
          getOrCreate(getOrCreate(days, day, newDay).cumulative, key, () => new SourceTotals())
            .add(appLabel(row.app_info_id), v);
        }
      });
    }

    // ---- Instantaneous samples -----------------------------------------
    for (const [table, column, key] of DAILY_SAMPLED) {
      safely(table, () => {
        for (const row of db.rows(table)) {
          const v = Number(row[column]);
          const day = localDay(Number(row.time), offsetMin(row.zone_offset));
          if (!day || !Number.isFinite(v)) continue;
          getOrCreate(getOrCreate(days, day, newDay).sampled, key, () => new Stat()).add(v);
        }
      });
    }

    // ---- Exercise sessions (needed before heart-rate samples) ----------
    const sessions = [];
    safely('exercise_session_record_table', () => {
      for (const row of db.rows('exercise_session_record_table')) {
        const start = Number(row.start_time);
        const end = Number(row.end_time);
        if (!Number.isFinite(start) || !localDay(start)) continue;
        sessions.push({
          start, end, offset: offsetMin(row.start_zone_offset),
          type: Number(row.exercise_type),
          app: appLabel(row.app_info_id),
          key: recordKey(uuidToString(row.uuid)),
          hr: new Stat(),
        });
      }
    });
    sessions.sort((a, b) => a.start - b.start);
    // Running maximum of end times, so the backwards scan below can stop as
    // soon as no earlier session can still contain the instant, however long
    // an earlier session was.
    const maxEnd = [];
    for (let i = 0; i < sessions.length; i++) {
      const e = Number.isFinite(sessions[i].end) ? sessions[i].end : sessions[i].start;
      maxEnd.push(i > 0 ? Math.max(maxEnd[i - 1], e) : e);
    }

    /** Sessions whose [start, end] window contains `ms`. */
    const sessionsAt = (ms) => {
      let lo = 0;
      let hi = sessions.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sessions[mid].start <= ms) lo = mid + 1;
        else hi = mid;
      }
      const hits = [];
      for (let i = lo - 1; i >= 0 && maxEnd[i] >= ms; i--) {
        if (ms <= sessions[i].end) hits.push(sessions[i]);
      }
      return hits;
    };

    // ---- Heart-rate series ---------------------------------------------
    const hrParents = new Map();
    safely('heart_rate_record_table', () => {
      for (const row of db.rows('heart_rate_record_table')) {
        hrParents.set(row.row_id, offsetMin(row.start_zone_offset));
      }
    });
    safely('heart_rate_record_series_table', () => {
      for (const row of db.rows('heart_rate_record_series_table')) {
        const ms = Number(row.epoch_millis);
        const bpm = Number(row.beats_per_minute);
        const day = localDay(ms, hrParents.get(row.parent_key) || 0);
        if (!day || !Number.isFinite(bpm)) continue;
        getOrCreate(getOrCreate(days, day, newDay).sampled, 'hr', () => new Stat()).add(bpm);
        if (sessions.length > 0) for (const s of sessionsAt(ms)) s.hr.add(bpm);
      }
    });

    // ---- Exercise rows --------------------------------------------------
    const exerciseRows = sessions.map((s) => {
      const activity = EXERCISE_TYPES[s.type] || humanize(`type ${s.type}`);
      return {
        Activity: activity,
        'Start Time': formatLocal(s.start, s.offset),
        Duration: Number.isFinite(s.end) ? formatDuration((s.end - s.start) / 1000) : '',
        'Duration (min)': Number.isFinite(s.end) ? fmtNum((s.end - s.start) / 60000, 1) : '',
        'Avg HR (bpm)': fmtNum(s.hr.mean, 0),
        'Max HR (bpm)': fmtNum(s.hr.hi, 0),
        Source: s.app,
        'Record Key': s.key,
        _timestamp: s.start,
        _app: activity,
      };
    });
    if (exerciseRows.length > 0) data['Exercise'] = exerciseRows;
    else parsingErrors.sheetsNotFound.push('Exercise');

    // ---- Sleep ----------------------------------------------------------
    const nights = new Map();
    const sessionById = new Map();
    safely('sleep_session_record_table', () => { for (const row of db.rows('sleep_session_record_table')) {
      const start = Number(row.start_time);
      const end = Number(row.end_time);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      const offset = offsetMin(row.start_zone_offset);
      const night = getOrCreate(nights, sleepDay(start, offset), () => new Map());
      const acc = getOrCreate(night, appLabel(row.app_info_id), newNightSource);
      acc.inBed += (end - start) / 60000;
      acc.start = Math.min(acc.start, start);
      acc.end = Math.max(acc.end, end);
      acc.offset = offset;
      sessionById.set(row.row_id, acc);
    } });
    safely('sleep_stages_table', () => {
      for (const row of db.rows('sleep_stages_table')) {
        const acc = sessionById.get(row.parent_key);
        const key = STAGE_KEY[row.stage_type];
        const minutes = (Number(row.stage_end_time) - Number(row.stage_start_time)) / 60000;
        if (acc && key && Number.isFinite(minutes) && minutes > 0) acc[key] += minutes;
      }
    });

    const sleepRows = [];
    for (const [date, byApp] of nights) {
      let best = null;
      let bestApp = '';
      let bestScore = -1;
      for (const [app, acc] of byApp) {
        const asleep = acc.unspecified + acc.light + acc.deep + acc.rem;
        const score = (acc.light + acc.deep + acc.rem > 0 ? 1e6 : 0) + asleep + acc.inBed / 1e3;
        if (score > bestScore) { best = acc; bestApp = app; bestScore = score; }
      }
      const asleep = best.unspecified + best.light + best.deep + best.rem;
      const staged = best.light + best.deep + best.rem > 0;
      sleepRows.push({
        Date: date,
        'Sleep Start': formatLocal(best.start, best.offset),
        'Sleep End': formatLocal(best.end, best.offset),
        'Time in Bed': formatDuration(best.inBed * 60),
        'In Bed (min)': fmtNum(best.inBed, 0),
        // Sessions without stage data only tell us the time in bed.
        'Asleep (min)': asleep > 0 ? fmtNum(asleep, 0) : '',
        'Light (min)': staged ? fmtNum(best.light, 0) : '',
        'Deep (min)': staged ? fmtNum(best.deep, 0) : '',
        'REM (min)': staged ? fmtNum(best.rem, 0) : '',
        'Awake (min)': staged || best.awake > 0 ? fmtNum(best.awake, 0) : '',
        Source: bestApp,
        'Sources Recorded': String(byApp.size),
        _timestamp: dayTimestamp(date),
      });
    }
    sleepRows.sort((a, b) => a.Date.localeCompare(b.Date));
    if (sleepRows.length > 0) data['Sleep'] = sleepRows;
    else parsingErrors.sheetsNotFound.push('Sleep');
  }

  // ---- Daily Activity ----------------------------------------------------
  const dailyRows = [];
  for (const [date, d] of days) {
    const cum = (k) => (d.cumulative.has(k) ? d.cumulative.get(k).best() : { value: NaN, source: '' });
    const s = (k) => d.sampled.get(k);
    const mean = (k) => (s(k) ? s(k).mean : NaN);
    const steps = cum('steps');
    dailyRows.push({
      Date: date,
      Steps: fmtNum(steps.value, 0),
      'Distance (km)': fmtNum(cum('distance').value, 2),
      'Active Energy (kcal)': fmtNum(cum('activeEnergy').value, 0),
      'Total Energy (kcal)': fmtNum(cum('totalEnergy').value, 0),
      'Floors Climbed': fmtNum(cum('floors').value, 0),
      'Avg HR (bpm)': fmtNum(mean('hr'), 0),
      'Min HR (bpm)': fmtNum(s('hr') && s('hr').lo, 0),
      'Max HR (bpm)': fmtNum(s('hr') && s('hr').hi, 0),
      'Resting HR (bpm)': fmtNum(mean('restingHr'), 0),
      'HRV RMSSD (ms)': fmtNum(mean('hrv'), 1),
      'SpO2 (%)': fmtNum(mean('spo2'), 1),
      'Respiratory Rate (brpm)': fmtNum(mean('resp'), 1),
      'Steps Source': steps.source,
      _timestamp: dayTimestamp(date),
    });
  }
  dailyRows.sort((a, b) => a.Date.localeCompare(b.Date));
  if (dailyRows.length > 0) data['Daily Activity'] = dailyRows;
  else parsingErrors.sheetsNotFound.push('Daily activity');

  // Fixed table order on the review page.
  const ordered = {};
  for (const name of ['Daily Activity', 'Sleep', 'Exercise']) if (data[name]) ordered[name] = data[name];
  return { data: ordered, parsingErrors };
}

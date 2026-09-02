import JSZip from 'jszip';

/**
 * Parser for Garmin data from a Garmin account data export (.zip).
 *
 * Garmin's "Export Your Data" archive (garmin.com → Account → Data Management)
 * contains dozens of product folders. This parser reads only the health-related
 * layers and turns them into five review tables:
 *
 *   1. "Daily Wellness" — one row per day from
 *      `DI_CONNECT/DI-Connect-Aggregator/UDSFile_*.json`
 *      (steps, distance, calories, intensity minutes, floors, heart rate,
 *      wear time, all-day stress, Body Battery, waking respiration).
 *   2. "VO2max"         — one row per dated estimate from
 *      `DI_CONNECT/DI-Connect-Metrics/MetricsMaxMetData_*.json`.
 *   3. "Sleep"          — one row per night from
 *      `DI_CONNECT/DI-Connect-Wellness/*sleepData.json`
 *      (sleep window, stage durations, awakenings, respiration, sleep score).
 *   4. "Activities"     — one row per recorded workout from
 *      `DI_CONNECT/DI-Connect-Fitness/*summarizedActivities.json`
 *      (type, start, duration, distance, steps, calories, heart rate, speed).
 *   5. "Devices"        — one row per registered device from
 *      `IT_DEVICE_AND_CONTENT/devicesandcontent.json` (model + part number + date).
 *
 * Identifying fields are dropped: activity start latitude/longitude, device
 * serial numbers / unit IDs, VO2max device IDs, and everything outside the
 * sources above (profile, email, consent history, e-commerce, ...) is never read.
 *
 * Unit quirks in Garmin's activity export: distance is centimeters, durations
 * are milliseconds, speed is cm/ms (= 10 m/s). Converted here to km / minutes
 * / km/h. `startTimeLocal` is an epoch already shifted by the activity's UTC
 * offset, so formatting it as UTC yields the local wall-clock time.
 *
 * @param {File} file - Uploaded Garmin export .zip
 * @returns {Promise<{data: Object, parsingErrors: {sheetsNotFound: string[], tablesNotParsed: Object[]}}>}
 */

const UDS_RE = /(?:^|\/)DI-Connect-Aggregator\/UDSFile_[^/]*\.json$/i;
const VO2MAX_RE = /(?:^|\/)DI-Connect-Metrics\/MetricsMaxMetData_[^/]*\.json$/i;
const SLEEP_RE = /(?:^|\/)DI-Connect-Wellness\/[^/]*sleepData\.json$/i;
const ACTIVITIES_RE = /(?:^|\/)DI-Connect-Fitness\/[^/]*summarizedActivities[^/]*\.json$/i;
const DEVICES_RE = /(?:^|\/)devicesandcontent\.json$/i;

// Retail SKU prefix `010-XXXXX` → model family. Color / region suffixes are
// ignored at lookup time. Unknown prefixes fall back to the raw part number.
const DEVICE_MODELS = {
  '010-01614': 'Forerunner 735XT',
  '010-01688': 'Fenix 5',
  '010-01689': 'Forerunner 35',
  '010-01746': 'Forerunner 935',
  '010-01769': 'Vivoactive 3',
  '010-01987': 'Fenix 5S Plus',
  '010-01988': 'Fenix 5 Plus',
  '010-02006': 'MARQ',
  '010-02063': 'Forerunner 945',
  '010-02064': 'Instinct',
  '010-02120': 'Forerunner 245',
  '010-02156': 'Forerunner 45',
  '010-02157': 'Fenix 6X',
  '010-02158': 'Fenix 6',
  '010-02159': 'Fenix 6S',
  '010-02172': 'Vivoactive 4S',
  '010-02173': 'Venu',
  '010-02174': 'Vivoactive 4',
  '010-02240': 'Vivomove Style',
  '010-02241': 'Vivomove Luxe',
  '010-02247': 'Swim 2',
  '010-02293': 'Instinct Solar',
  '010-02384': 'Lily',
  '010-02408': 'Enduro',
  '010-02409': 'Fenix 6S Pro',
  '010-02410': 'Fenix 6 Pro',
  '010-02426': 'Venu Sq Music',
  '010-02427': 'Venu Sq',
  '010-02429': 'Venu 2S',
  '010-02430': 'Venu 2',
  '010-02445': 'Forerunner 745',
  '010-02464': 'Index BPM',
  '010-02496': 'Venu 2 Plus',
  '010-02539': 'Fenix 7S',
  '010-02540': 'Fenix 7',
  '010-02541': 'Fenix 7X',
  '010-02562': 'Forerunner 55',
  '010-02563': 'Instinct 2S',
  '010-02564': 'Instinct 2S Solar',
  '010-02566': 'Vivomove Sport',
  '010-02582': 'Epix Gen 2',
  '010-02626': 'Instinct 2',
  '010-02627': 'Instinct 2 Solar',
  '010-02638': 'Forerunner 955',
  '010-02641': 'Forerunner 255',
  '010-02648': 'MARQ Gen 2',
  '010-02665': 'Vivomove Trend',
  '010-02700': 'Venu Sq 2 Music',
  '010-02701': 'Venu Sq 2',
  '010-02704': 'Tactix 7',
  '010-02730': 'Instinct Crossover',
  '010-02746': 'Approach S70',
  '010-02751': 'Enduro 3',
  '010-02754': 'Enduro 2',
  '010-02776': 'Fenix 7S Pro',
  '010-02777': 'Fenix 7 Pro',
  '010-02778': 'Fenix 7X Pro',
  '010-02784': 'Venu 3',
  '010-02785': 'Venu 3S',
  '010-02802': 'Epix Pro Gen 2 42mm',
  '010-02803': 'Epix Pro Gen 2 47mm',
  '010-02804': 'Epix Pro Gen 2 51mm',
  '010-02805': 'Instinct 2X',
  '010-02809': 'Forerunner 965',
  '010-02810': 'Forerunner 265',
  '010-02839': 'Lily 2',
  '010-02862': 'Vivoactive 5',
  '010-02863': 'Forerunner 165',
  '010-02891': 'Lily 2 Active',
  '010-02903': 'Fenix 8 43mm',
  '010-02904': 'Fenix 8 47mm',
  '010-02905': 'Fenix 8 51mm',
  '010-02906': 'Fenix 8 Solar 47mm',
  '010-02907': 'Fenix 8 Solar 51mm',
  '010-02971': 'Forerunner 570',
  '010-03025': 'Fenix E',
  '010-04335': 'Fenix 9 Pro 43mm',
  '010-04336': 'Fenix 9 Pro 47mm',
  '010-04337': 'Fenix 9 Pro 51mm',
  '010-04761': 'Fenix 9 43mm',
  '010-04762': 'Fenix 9 47mm',
  '010-04763': 'Fenix 9 51mm',
  '010-10997': 'HRM-Tri',
  '010-12342': 'HRM-Swim',
};

/**
 * Round a numeric value to a fixed number of decimals, returning '' for
 * non-numeric / empty input so "no data" stays visibly blank.
 * @param {*} value
 * @param {number} decimals
 * @returns {string}
 */
const fmtNum = (value, decimals) => {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (decimals <= 0) return String(Math.round(n));
  const factor = 10 ** decimals;
  return String(Math.round(n * factor) / factor);
};

/**
 * Format a duration in seconds to a readable string, e.g. "1 hour 5 minutes".
 * @param {number} seconds
 * @returns {string}
 */
const formatDuration = (seconds) => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs !== 1 ? 's' : ''}`);

  return parts.join(' ');
};

/**
 * Format an epoch-milliseconds value as a UTC wall-clock string. Used for
 * Garmin's "local" epochs (already offset) and for GMT sleep timestamps.
 * @param {number} epochMs
 * @param {string} [suffix] - e.g. ' GMT' appended when the time really is GMT
 * @returns {string}
 */
const formatEpochAsUTC = (epochMs, suffix = '') => {
  const n = Number(epochMs);
  if (!Number.isFinite(n)) return '';
  const date = new Date(n);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  }) + suffix;
};

/**
 * Parse a Garmin GMT timestamp string like "2024-01-19T23:21:00.0" as UTC.
 * @param {string} value
 * @returns {number} epoch ms, or NaN
 */
const parseGmtTimestamp = (value) => {
  if (typeof value !== 'string' || value.length === 0) return NaN;
  return Date.parse(value.endsWith('Z') ? value : `${value}Z`);
};

/**
 * Humanize a Garmin activity type, e.g. "treadmill_running" -> "Treadmill Running".
 * @param {string} activity
 * @returns {string}
 */
const humanizeActivity = (activity) => {
  if (!activity) return 'Unknown';
  return String(activity)
    .replace(/[._-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Resolve a Garmin retail part number (e.g. "010-02429-11") to a model name.
 * Matches the full SKU first, then the `010-XXXXX` prefix; unknown codes are
 * returned unchanged so researchers still see something.
 * @param {string} partNumber
 * @returns {string}
 */
const modelFromPartNumber = (partNumber) => {
  if (typeof partNumber !== 'string' || partNumber.length === 0) return '';
  if (DEVICE_MODELS[partNumber]) return DEVICE_MODELS[partNumber];
  const prefix = partNumber.split('-').slice(0, 2).join('-');
  return DEVICE_MODELS[prefix] || partNumber;
};

/**
 * The TOTAL (all-day) stress aggregator, or null.
 * @param {Object} rec
 * @returns {Object|null}
 */
const totalStress = (rec) => {
  const list = rec && rec.allDayStress && rec.allDayStress.aggregatorList;
  if (!Array.isArray(list)) return null;
  return list.find((a) => a && a.type === 'TOTAL') || null;
};

/**
 * On-wrist minutes for a UDS day: stress sample count minus off-wrist count.
 * Each Garmin stress "count" is one minute. Returns '' when the block is absent.
 * @param {Object} rec
 * @returns {number|string}
 */
const wearMinutes = (rec) => {
  const agg = totalStress(rec);
  if (!agg || agg.totalStressCount === undefined || agg.totalStressCount === null) return '';
  const total = Number(agg.totalStressCount);
  const off = Number(agg.stressOffWristCount);
  if (!Number.isFinite(total)) return '';
  return Math.max(0, total - (Number.isFinite(off) ? off : 0));
};

/**
 * Body Battery stat value by type (HIGHEST, LOWEST, ...), or undefined.
 * @param {Object} rec
 * @param {string} type
 * @returns {*}
 */
const bodyBatteryStat = (rec, type) => {
  const list = rec && rec.bodyBattery && rec.bodyBattery.bodyBatteryStatList;
  if (!Array.isArray(list)) return undefined;
  const hit = list.find((s) => s && s.bodyBatteryStatType === type);
  return hit ? hit.statsValue : undefined;
};

/**
 * Seconds → minutes, or '' when missing / non-numeric.
 * @param {*} seconds
 * @returns {number|string}
 */
const secToMin = (seconds) => (Number.isFinite(Number(seconds)) ? Number(seconds) / 60 : '');

/**
 * Read and JSON-parse one zip entry, returning null on failure.
 * @param {JSZip} zip
 * @param {string} path
 * @returns {Promise<*>}
 */
const readJson = async (zip, path) => {
  try {
    const text = await zip.files[path].async('string');
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
};

// Daily fields that count as an actual measurement (vs. goal-only records
// Garmin emits for days the watch was never worn).
const DAILY_MEASURED_KEYS = [
  'totalSteps', 'totalDistanceMeters', 'wellnessDistanceMeters',
  'minHeartRate', 'maxHeartRate', 'restingHeartRate',
];

/**
 * Build one "Daily Wellness" row from a UDS record, or null for goal-only days.
 * @param {Object} rec
 * @returns {Object|null}
 */
const dailyRow = (rec) => {
  if (!rec || typeof rec !== 'object' || !rec.calendarDate) return null;
  const worn = wearMinutes(rec);
  const hasWear = worn !== '' && worn > 0;
  if (!DAILY_MEASURED_KEYS.some((k) => rec[k] !== undefined && rec[k] !== null) && !hasWear) {
    return null;
  }

  const stress = totalStress(rec);
  // Garmin writes -1 when there is no stress estimate for the day.
  const avgStress = stress ? Number(stress.averageStressLevel) : NaN;
  const hasStress = Number.isFinite(avgStress) && avgStress >= 0;
  const resp = rec.respiration && typeof rec.respiration === 'object' ? rec.respiration : null;
  const bb = rec.bodyBattery && typeof rec.bodyBattery === 'object' ? rec.bodyBattery : null;

  const row = {
    Date: rec.calendarDate,
    Steps: fmtNum(rec.totalSteps, 0),
    'Distance (km)': fmtNum(Number(rec.totalDistanceMeters ?? rec.wellnessDistanceMeters) / 1000, 2),
    'Total Calories (kcal)': fmtNum(rec.totalKilocalories, 0),
    'Active Calories (kcal)': fmtNum(rec.activeKilocalories, 0),
    'Active Time (min)': fmtNum(secToMin(rec.activeSeconds), 0),
    'Highly Active Time (min)': fmtNum(secToMin(rec.highlyActiveSeconds), 0),
    'Moderate Intensity (min)': fmtNum(rec.moderateIntensityMinutes, 0),
    'Vigorous Intensity (min)': fmtNum(rec.vigorousIntensityMinutes, 0),
    'Floors Ascended (m)': fmtNum(rec.floorsAscendedInMeters, 1),
    'Resting HR (bpm)': fmtNum(rec.restingHeartRate, 0),
    'Min HR (bpm)': fmtNum(rec.minHeartRate, 0),
    'Max HR (bpm)': fmtNum(rec.maxHeartRate, 0),
    'Wear Time (min)': fmtNum(worn, 0),
    'Avg Stress': hasStress ? fmtNum(avgStress, 0) : '',
    'Max Stress': hasStress ? fmtNum(stress.maxStressLevel, 0) : '',
    'Stress Time (min)': hasStress ? fmtNum(secToMin(stress.stressDuration), 0) : '',
    'Rest Time (min)': hasStress ? fmtNum(secToMin(stress.restDuration), 0) : '',
    'Body Battery High': fmtNum(bodyBatteryStat(rec, 'HIGHEST'), 0),
    'Body Battery Low': fmtNum(bodyBatteryStat(rec, 'LOWEST'), 0),
    'Body Battery Charged': fmtNum(bb && bb.chargedValue, 0),
    'Body Battery Drained': fmtNum(bb && bb.drainedValue, 0),
    'Avg Waking Respiration (brpm)': fmtNum(resp && resp.avgWakingRespirationValue, 1),
    'Min Respiration (brpm)': fmtNum(resp && resp.lowestRespirationValue, 1),
    'Max Respiration (brpm)': fmtNum(resp && resp.highestRespirationValue, 1),
  };
  const ts = Date.parse(`${rec.calendarDate}T12:00:00`);
  if (Number.isFinite(ts)) row._timestamp = ts;
  return row;
};

/**
 * Build one "VO2max" row. deviceId / userProfilePK are identifying and dropped.
 * @param {Object} rec
 * @returns {Object|null}
 */
const vo2maxRow = (rec) => {
  if (!rec || typeof rec !== 'object' || !rec.calendarDate) return null;
  if (rec.vo2MaxValue === undefined || rec.vo2MaxValue === null) return null;

  const row = {
    Date: rec.calendarDate,
    VO2max: fmtNum(rec.vo2MaxValue, 1),
    Sport: rec.sport ? humanizeActivity(String(rec.sport).toLowerCase()) : '',
  };
  const ts = Date.parse(`${rec.calendarDate}T12:00:00`);
  if (Number.isFinite(ts)) row._timestamp = ts;
  const updated = parseGmtTimestamp(rec.updateTimestamp);
  row._updated = Number.isFinite(updated) ? updated : 0;
  row._sportKey = rec.sport ? String(rec.sport) : '';
  return row;
};

/**
 * Build one "Sleep" row from a sleep record.
 * @param {Object} rec
 * @returns {Object|null}
 */
const sleepRow = (rec) => {
  if (!rec || typeof rec !== 'object' || !rec.calendarDate) return null;

  const deep = Number(rec.deepSleepSeconds);
  const light = Number(rec.lightSleepSeconds);
  const rem = Number(rec.remSleepSeconds);
  const stages = [deep, light, rem].filter(Number.isFinite);
  const totalSec = stages.length > 0 ? stages.reduce((a, b) => a + b, 0) : NaN;

  const startMs = parseGmtTimestamp(rec.sleepStartTimestampGMT);
  const endMs = parseGmtTimestamp(rec.sleepEndTimestampGMT);

  const row = {
    Date: rec.calendarDate,
    'Sleep Start': Number.isFinite(startMs) ? formatEpochAsUTC(startMs, ' GMT') : '',
    'Sleep End': Number.isFinite(endMs) ? formatEpochAsUTC(endMs, ' GMT') : '',
    'Total Sleep': Number.isFinite(totalSec) ? formatDuration(totalSec) : '',
    'Deep (min)': fmtNum(deep / 60, 0),
    'Light (min)': fmtNum(light / 60, 0),
    'REM (min)': fmtNum(rem / 60, 0),
    'Awake (min)': fmtNum(Number(rec.awakeSleepSeconds) / 60, 0),
    Awakenings: fmtNum(rec.awakeCount, 0),
    'Restless Moments': fmtNum(rec.restlessMomentCount, 0),
    'Avg Respiration (brpm)': fmtNum(rec.averageRespiration, 1),
    'Sleep Score': fmtNum(rec.sleepScores && rec.sleepScores.overallScore, 0),
  };
  const ts = Date.parse(`${rec.calendarDate}T12:00:00`);
  if (Number.isFinite(ts)) row._timestamp = ts;
  return row;
};

/**
 * Build one "Activities" row from a summarized-activity record.
 * Garmin units: distance cm, durations ms, speed cm/ms (= 10 m/s).
 * @param {Object} rec
 * @returns {Object|null}
 */
const activityRow = (rec) => {
  if (!rec || typeof rec !== 'object') return null;

  const activity = humanizeActivity(rec.activityType);
  const durationMs = Number(rec.duration ?? rec.elapsedDuration);
  const distanceCm = Number(rec.distance);
  const speedCmPerMs = Number(rec.avgSpeed);
  const beginTs = Number(rec.beginTimestamp ?? rec.startTimeGmt);

  // No `name` column: Garmin auto-names activities after the user's location
  // (e.g. "<City> Cycling"), which would leak where the participant lives.
  const row = {
    Activity: activity,
    'Start Time': formatEpochAsUTC(rec.startTimeLocal ?? rec.beginTimestamp),
    Duration: Number.isFinite(durationMs) ? formatDuration(durationMs / 1000) : '',
    'Distance (km)': fmtNum(distanceCm / 100000, 2),
    Steps: fmtNum(rec.steps, 0),
    'Calories (kcal)': fmtNum(rec.calories, 0),
    'Avg HR (bpm)': fmtNum(rec.avgHr, 0),
    'Max HR (bpm)': fmtNum(rec.maxHr, 0),
    'Avg Speed (km/h)': fmtNum(speedCmPerMs * 36, 1),
    'Moderate Intensity (min)': fmtNum(rec.moderateIntensityMinutes, 0),
    'Vigorous Intensity (min)': fmtNum(rec.vigorousIntensityMinutes, 0),
  };
  // Hidden helpers: `_timestamp` powers the date-range filter; `_app`
  // (the activity type) powers the "exclude" filter on the review page.
  if (Number.isFinite(beginTs)) row._timestamp = beginTs;
  row._app = activity;
  return row;
};

export default async function parseGarminFile(file) {
  const data = {};
  const parsingErrors = {
    sheetsNotFound: [],
    tablesNotParsed: [],
  };

  let zip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch (error) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Garmin Export',
      reason: `Failed to open the ZIP file: ${error.message}`,
      expectedFormat: 'ZIP',
    });
    return { data, parsingErrors };
  }

  const entries = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
  const udsPaths = entries.filter((p) => UDS_RE.test(p));
  const vo2maxPaths = entries.filter((p) => VO2MAX_RE.test(p));
  const sleepPaths = entries.filter((p) => SLEEP_RE.test(p));
  const activityPaths = entries.filter((p) => ACTIVITIES_RE.test(p));
  const devicePaths = entries.filter((p) => DEVICES_RE.test(p));

  // ---- Daily Wellness ----------------------------------------------------
  if (udsPaths.length === 0) {
    parsingErrors.sheetsNotFound.push('Daily wellness summaries');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Daily Wellness',
      reason: 'No UDSFile JSON files were found in the export.',
      expectedPath: 'DI_CONNECT/DI-Connect-Aggregator/UDSFile_*.json',
    });
  } else {
    // Adjacent UDS files share their boundary date; keep the richer record.
    const byDate = new Map();
    for (const path of udsPaths) {
      const records = await readJson(zip, path);
      if (!Array.isArray(records)) continue;
      for (const rec of records) {
        if (!rec || !rec.calendarDate) continue;
        const existing = byDate.get(rec.calendarDate);
        if (!existing || Object.keys(rec).length > Object.keys(existing).length) {
          byDate.set(rec.calendarDate, rec);
        }
      }
    }
    const rows = Array.from(byDate.values()).map(dailyRow).filter(Boolean);
    rows.sort((a, b) => (a._timestamp || 0) - (b._timestamp || 0));
    if (rows.length > 0) {
      data['Daily Wellness'] = rows;
    } else {
      parsingErrors.tablesNotParsed.push({
        sheetName: 'Daily Wellness',
        reason: 'Daily wellness files were found but contained no measured days.',
        expectedFormat: 'JSON',
      });
    }
  }

  // ---- VO2max ------------------------------------------------------------
  // Optional: older watches and some accounts have no MetricsMaxMetData.
  // Missing files are silent (not an error); overlapping dated files keep
  // the latest update per (date, sport). deviceId is identifying and dropped.
  if (vo2maxPaths.length > 0) {
    const byKey = new Map();
    for (const path of vo2maxPaths) {
      const records = await readJson(zip, path);
      if (!Array.isArray(records)) continue;
      for (const rec of records) {
        const row = vo2maxRow(rec);
        if (!row) continue;
        const key = `${row.Date}|${row._sportKey}`;
        const existing = byKey.get(key);
        if (!existing || (row._updated || 0) >= (existing._updated || 0)) {
          byKey.set(key, row);
        }
      }
    }
    const rows = Array.from(byKey.values());
    rows.sort((a, b) => (a._timestamp || 0) - (b._timestamp || 0)
      || String(a.Sport).localeCompare(String(b.Sport)));
    if (rows.length > 0) {
      data['VO2max'] = rows;
    }
  }

  // ---- Sleep -------------------------------------------------------------
  if (sleepPaths.length === 0) {
    parsingErrors.sheetsNotFound.push('Sleep data');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Sleep',
      reason: 'No sleepData JSON files were found in the export.',
      expectedPath: 'DI_CONNECT/DI-Connect-Wellness/*sleepData.json',
    });
  } else {
    const rows = [];
    for (const path of sleepPaths) {
      const records = await readJson(zip, path);
      if (!Array.isArray(records)) continue;
      for (const rec of records) {
        const row = sleepRow(rec);
        if (row) rows.push(row);
      }
    }
    rows.sort((a, b) => (a._timestamp || 0) - (b._timestamp || 0));
    if (rows.length > 0) {
      data['Sleep'] = rows;
    } else {
      parsingErrors.tablesNotParsed.push({
        sheetName: 'Sleep',
        reason: 'Sleep files were found but none of the records could be parsed.',
        expectedFormat: 'JSON',
      });
    }
  }

  // ---- Activities --------------------------------------------------------
  if (activityPaths.length === 0) {
    parsingErrors.sheetsNotFound.push('Summarized activities');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Activities',
      reason: 'No summarizedActivities JSON files were found in the export.',
      expectedPath: 'DI_CONNECT/DI-Connect-Fitness/*summarizedActivities.json',
    });
  } else {
    const rows = [];
    for (const path of activityPaths) {
      const parsed = await readJson(zip, path);
      if (!Array.isArray(parsed)) continue;
      // Each file is a list of wrappers: [{summarizedActivitiesExport: [...]}]
      for (const wrapper of parsed) {
        const records = wrapper && Array.isArray(wrapper.summarizedActivitiesExport)
          ? wrapper.summarizedActivitiesExport
          : [];
        for (const rec of records) {
          const row = activityRow(rec);
          if (row) rows.push(row);
        }
      }
    }
    rows.sort((a, b) => (a._timestamp || 0) - (b._timestamp || 0));
    if (rows.length > 0) {
      data['Activities'] = rows;
    } else {
      parsingErrors.tablesNotParsed.push({
        sheetName: 'Activities',
        reason: 'Activity files were found but none of the records could be parsed.',
        expectedFormat: 'JSON',
      });
    }
  }

  // ---- Devices -----------------------------------------------------------
  // Serial numbers and unit IDs are identifying, so only the model (looked
  // up from the part number), the part number itself, and registration date
  // are kept.
  if (devicePaths.length === 0) {
    parsingErrors.sheetsNotFound.push('Devices');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Devices',
      reason: 'No devicesandcontent.json was found in the export.',
      expectedPath: 'IT_DEVICE_AND_CONTENT/devicesandcontent.json',
    });
  } else {
    const rows = [];
    for (const path of devicePaths) {
      const parsed = await readJson(zip, path);
      const infoList = parsed && Array.isArray(parsed.deviceAndContentInfo)
        ? parsed.deviceAndContentInfo
        : [];
      for (const info of infoList) {
        const devices = info && Array.isArray(info.Devices) ? info.Devices : [];
        for (const dev of devices) {
          if (!dev || typeof dev !== 'object') continue;
          const partNumber = typeof dev.partNumber === 'string' ? dev.partNumber : '';
          rows.push({
            Model: modelFromPartNumber(partNumber),
            'Part Number': partNumber,
            'Registration Date': typeof dev.registrationDate === 'string' ? dev.registrationDate : '',
          });
        }
      }
    }
    if (rows.length > 0) {
      data['Devices'] = rows;
    } else {
      parsingErrors.tablesNotParsed.push({
        sheetName: 'Devices',
        reason: 'A device file was found but contained no devices.',
        expectedFormat: 'JSON',
      });
    }
  }

  return { data, parsingErrors };
}

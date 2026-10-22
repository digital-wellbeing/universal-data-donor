import { openZip, isZip, streamBlobText } from '../utils/zipReader';
import { createTagScanner, getAttr } from '../utils/xmlTagStream';
import {
  fmtNum, formatDuration, dayTimestamp, formatLocal, sleepDay, stripOwnerName,
  humanize, Stat, SourceTotals, getOrCreate, detach,
} from '../utils/wearableFormat';

/**
 * Parser for an Apple Health export (iPhone Health app → profile picture →
 * "Export All Health Data"), uploaded either as the original `export.zip` or
 * as the `export.xml` inside it.
 *
 * export.xml is streamed, never loaded whole: real exports run to several
 * gigabytes. Three review tables are built:
 *
 *   1. "Daily Activity" — one row per local day: steps, distance, flights,
 *      active / resting energy, exercise minutes, stand hours, daylight,
 *      heart rate (avg/min/max/resting/walking), HRV, respiration, SpO2, VO2max.
 *   2. "Sleep"          — one row per night from SleepAnalysis samples
 *      (in bed, asleep, Core / Deep / REM / awake stage minutes).
 *   3. "Workouts"       — one row per workout (type, start, duration,
 *      distance, energy, heart rate, indoor flag).
 *
 * Only whitelisted record types are read. `<Me>` (date of birth, sex, blood
 * type), clinical records, ECGs, audiograms, workout GPS routes, reproductive
 * and sexual-activity records, body measurements, nutrition, and the separate
 * `export_cda.xml` clinical document are never read.
 *
 * Overlapping sources (iPhone + Apple Watch + third-party apps all writing
 * steps) are not summed: cumulative metrics keep the largest single-source
 * daily total. Each sample's own UTC offset decides its local day, so travel
 * and DST shifts land on the right calendar date. Device names default to
 * "<name>'s Apple Watch", so source labels are reduced to the device model.
 *
 * @param {File} file
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Promise<{data: Object, parsingErrors: {sheetsNotFound: string[], tablesNotParsed: Object[]}}>}
 */

const T = 'HKQuantityTypeIdentifier';

// Cumulative types: summed per source per day, then max across sources.
const CUMULATIVE = {
  [`${T}StepCount`]: 'steps',
  [`${T}DistanceWalkingRunning`]: 'distance',
  [`${T}DistanceCycling`]: 'cycling',
  [`${T}FlightsClimbed`]: 'flights',
  [`${T}ActiveEnergyBurned`]: 'activeEnergy',
  [`${T}BasalEnergyBurned`]: 'restingEnergy',
  [`${T}AppleExerciseTime`]: 'exercise',
  [`${T}TimeInDaylight`]: 'daylight',
};

// Sampled types: pooled mean (and min/max for heart rate) across sources.
const SAMPLED = {
  [`${T}HeartRate`]: 'hr',
  [`${T}RestingHeartRate`]: 'restingHr',
  [`${T}WalkingHeartRateAverage`]: 'walkingHr',
  [`${T}HeartRateVariabilitySDNN`]: 'hrv',
  [`${T}RespiratoryRate`]: 'resp',
  [`${T}OxygenSaturation`]: 'spo2',
  [`${T}VO2Max`]: 'vo2max',
};

const SLEEP_TYPE = 'HKCategoryTypeIdentifierSleepAnalysis';
const SLEEP_STAGE = {
  HKCategoryValueSleepAnalysisInBed: 'inBed',
  HKCategoryValueSleepAnalysisAsleep: 'unspecified',
  HKCategoryValueSleepAnalysisAsleepUnspecified: 'unspecified',
  HKCategoryValueSleepAnalysisAsleepCore: 'core',
  HKCategoryValueSleepAnalysisAsleepDeep: 'deep',
  HKCategoryValueSleepAnalysisAsleepREM: 'rem',
  HKCategoryValueSleepAnalysisAwake: 'awake',
};

/** Distance → km. */
const toKm = (v, unit) => {
  switch (unit) {
    case 'km': return v;
    case 'm': return v / 1000;
    case 'mi': return v * 1.609344;
    case 'yd': return v * 0.0009144;
    case 'ft': return v * 0.0003048;
    default: return v;
  }
};

/** Energy → kcal ("Cal" is a food calorie, i.e. kcal). */
const toKcal = (v, unit) => {
  switch (unit) {
    case 'kJ': return v / 4.184;
    case 'J': return v / 4184;
    case 'cal': return v / 1000;
    default: return v; // kcal, Cal
  }
};

/** Time → minutes. */
const toMinutes = (v, unit) => {
  switch (unit) {
    case 's': return v / 60;
    case 'hr': case 'h': return v * 60;
    case 'd': return v * 1440;
    default: return v; // min
  }
};

/**
 * Parse "2024-01-19 23:21:00 +0100" → {ms, offset (minutes), day}.
 * @param {string} s
 * @returns {{ms: number, offset: number, day: string}|null}
 */
export const parseAppleDate = (s) => {
  if (typeof s !== 'string' || s.length < 19) return null;
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const offset = (m[3] === '-' ? -1 : 1) * (Number(m[4]) * 60 + Number(m[5]));
  const ms = Date.parse(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`);
  if (!Number.isFinite(ms)) return null;
  return { ms, offset, day: m[1] };
};

/**
 * Non-identifying label for a record's source. Apple devices are reported by
 * model (from the `device` attribute); other sources are app names, with any
 * "<name>'s " owner prefix removed.
 * @param {string} sourceName
 * @param {string} [device]
 * @returns {string}
 */
export const sourceLabel = (sourceName, device) => {
  if (device) {
    const manufacturer = (device.match(/manufacturer:([^,>]+)/) || [])[1] || '';
    const model = ((device.match(/model:([^,>]+)/) || [])[1] || '').trim();
    if (/apple/i.test(manufacturer) && model) {
      return model === 'Watch' ? 'Apple Watch' : model;
    }
  }
  // Without a device attribute, Apple devices are recognised by name in any
  // language ("Alex’s iPhone", "Apple Watch von Alex", "iPhone de Marie").
  const name = sourceName || '';
  if (/apple\s*watch/i.test(name)) return 'Apple Watch';
  if (/iphone/i.test(name)) return 'iPhone';
  if (/ipad/i.test(name)) return 'iPad';
  return stripOwnerName(name) || 'Unknown';
};

const newDay = () => ({
  cumulative: new Map(),
  sampled: new Map(),
  summary: null,
});

/** Sleep accumulator: per night → per source → stage minutes + window. */
const newNightSource = () => ({
  inBed: 0, unspecified: 0, core: 0, deep: 0, rem: 0, awake: 0,
  asleepStart: Infinity, asleepEnd: -Infinity,
  bedStart: Infinity, bedEnd: -Infinity,
  offset: 0,
});

export default async function parseAppleHealthFile(file, onProgress) {
  const data = {};
  const parsingErrors = { sheetsNotFound: [], tablesNotParsed: [] };

  const days = new Map();
  const nights = new Map();
  const workouts = [];
  const labelCache = new Map();
  let sawHealthData = false;
  let correlationDepth = 0;
  let workout = null;

  // The raw `device` string embeds a per-record object address, so the cache
  // is keyed on source name + model + manufacturer only.
  const label = (tag) => {
    const sourceName = getAttr(tag, 'sourceName') || '';
    const device = getAttr(tag, 'device') || '';
    const key = device
      ? `${sourceName}|${(device.match(/model:[^,>]*/) || [''])[0]}|${(device.match(/manufacturer:[^,>]*/) || [''])[0]}`
      : sourceName;
    let lbl = labelCache.get(key);
    if (lbl === undefined) {
      lbl = detach(sourceLabel(sourceName, device));
      labelCache.set(detach(key), lbl);
    }
    return lbl;
  };

  const onRecord = (tag) => {
    const type = getAttr(tag, 'type');
    if (!type) return;
    const cumKey = CUMULATIVE[type];
    const sampKey = cumKey ? undefined : SAMPLED[type];
    if (!cumKey && !sampKey && type !== SLEEP_TYPE) return;

    const start = parseAppleDate(getAttr(tag, 'startDate'));
    if (!start) return;

    if (type === SLEEP_TYPE) {
      const stage = SLEEP_STAGE[getAttr(tag, 'value')];
      const end = parseAppleDate(getAttr(tag, 'endDate'));
      if (!stage || !end || end.ms <= start.ms) return;
      const night = getOrCreate(nights, sleepDay(start.ms, start.offset), () => new Map());
      const acc = getOrCreate(night, label(tag), newNightSource);
      acc[stage] += (end.ms - start.ms) / 60000;
      acc.offset = start.offset;
      if (stage === 'inBed') {
        acc.bedStart = Math.min(acc.bedStart, start.ms);
        acc.bedEnd = Math.max(acc.bedEnd, end.ms);
      } else if (stage !== 'awake') {
        acc.asleepStart = Math.min(acc.asleepStart, start.ms);
        acc.asleepEnd = Math.max(acc.asleepEnd, end.ms);
      }
      return;
    }

    let value = Number(getAttr(tag, 'value'));
    if (!Number.isFinite(value)) return;
    const unit = getAttr(tag, 'unit') || '';
    const day = getOrCreate(days, start.day, newDay);

    if (cumKey) {
      if (cumKey === 'distance' || cumKey === 'cycling') value = toKm(value, unit);
      else if (cumKey === 'activeEnergy' || cumKey === 'restingEnergy') value = toKcal(value, unit);
      else if (cumKey === 'exercise' || cumKey === 'daylight') value = toMinutes(value, unit);
      getOrCreate(day.cumulative, cumKey, () => new SourceTotals()).add(label(tag), value);
    } else {
      // SpO2 is stored as a fraction (0.97) with unit "%".
      if (sampKey === 'spo2' && value <= 1) value *= 100;
      if (sampKey === 'hrv' && unit === 's') value *= 1000;
      getOrCreate(day.sampled, sampKey, () => new Stat()).add(value);
    }
  };

  const onActivitySummary = (tag) => {
    const date = getAttr(tag, 'dateComponents');
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number(date.slice(0, 4)) < 2000) return;
    const num = (name) => {
      const v = getAttr(tag, name);
      return v === undefined || v === '' ? NaN : Number(v);
    };
    const day = getOrCreate(days, date, newDay);
    day.summary = {
      move: toKcal(num('activeEnergyBurned'), getAttr(tag, 'activeEnergyBurnedUnit') || 'kcal'),
      moveGoal: toKcal(num('activeEnergyBurnedGoal'), getAttr(tag, 'activeEnergyBurnedUnit') || 'kcal'),
      exercise: num('appleExerciseTime'),
      stand: num('appleStandHours'),
    };
  };

  const startWorkout = (tag) => {
    const start = parseAppleDate(getAttr(tag, 'startDate'));
    const end = parseAppleDate(getAttr(tag, 'endDate'));
    const dur = Number(getAttr(tag, 'duration'));
    const durMin = Number.isFinite(dur) ? toMinutes(dur, getAttr(tag, 'durationUnit') || 'min') : NaN;
    const dist = Number(getAttr(tag, 'totalDistance'));
    const energy = Number(getAttr(tag, 'totalEnergyBurned'));
    return {
      type: getAttr(tag, 'workoutActivityType') || '',
      start,
      durationMin: Number.isFinite(durMin) ? durMin
        : (start && end ? (end.ms - start.ms) / 60000 : NaN),
      distanceKm: Number.isFinite(dist) ? toKm(dist, getAttr(tag, 'totalDistanceUnit') || 'km') : NaN,
      energyKcal: Number.isFinite(energy) ? toKcal(energy, getAttr(tag, 'totalEnergyBurnedUnit') || 'kcal') : NaN,
      avgHr: NaN,
      maxHr: NaN,
      indoor: '',
      source: label(tag),
    };
  };

  // iOS 16+ moved workout totals into <WorkoutStatistics> children.
  const onWorkoutStatistics = (tag) => {
    const type = getAttr(tag, 'type') || '';
    const unit = getAttr(tag, 'unit') || '';
    const sum = Number(getAttr(tag, 'sum'));
    if (/Distance/.test(type) && Number.isFinite(sum) && !Number.isFinite(workout.distanceKm)) {
      workout.distanceKm = toKm(sum, unit);
    } else if (type === `${T}ActiveEnergyBurned` && Number.isFinite(sum) && !Number.isFinite(workout.energyKcal)) {
      workout.energyKcal = toKcal(sum, unit);
    } else if (type === `${T}HeartRate`) {
      workout.avgHr = Number(getAttr(tag, 'average'));
      workout.maxHr = Number(getAttr(tag, 'maximum'));
    }
  };

  const finishWorkout = () => {
    const w = workout;
    workout = null;
    if (!w || !w.start) return;
    const activity = humanize(w.type.replace(/^HKWorkoutActivityType/, '')) || 'Unknown';
    workouts.push({
      Activity: activity,
      'Start Time': formatLocal(w.start.ms, w.start.offset),
      Duration: Number.isFinite(w.durationMin) ? formatDuration(w.durationMin * 60) : '',
      'Duration (min)': fmtNum(w.durationMin, 1),
      'Distance (km)': fmtNum(w.distanceKm, 2),
      'Active Energy (kcal)': fmtNum(w.energyKcal, 0),
      'Avg HR (bpm)': fmtNum(w.avgHr, 0),
      'Max HR (bpm)': fmtNum(w.maxHr, 0),
      Indoor: w.indoor,
      Source: w.source,
      _timestamp: w.start.ms,
      _app: activity,
    });
  };

  const scanner = createTagScanner((name, tag, kind) => {
    switch (name) {
      case 'HealthData':
        sawHealthData = true;
        break;
      case 'Correlation':
        // Member records of correlations (blood pressure, food) are skipped.
        if (kind === 'open') correlationDepth++;
        else if (kind === 'close') correlationDepth = Math.max(0, correlationDepth - 1);
        break;
      case 'Record':
        if (kind !== 'close' && correlationDepth === 0 && !workout) onRecord(tag);
        break;
      case 'ActivitySummary':
        if (kind !== 'close') onActivitySummary(tag);
        break;
      case 'Workout':
        if (kind === 'open') workout = startWorkout(tag);
        else if (kind === 'self') { workout = startWorkout(tag); finishWorkout(); }
        else finishWorkout();
        break;
      case 'WorkoutStatistics':
        if (workout && kind !== 'close') onWorkoutStatistics(tag);
        break;
      case 'MetadataEntry':
        if (workout && getAttr(tag, 'key') === 'HKIndoorWorkout') {
          workout.indoor = getAttr(tag, 'value') === '1' ? 'Yes' : 'No';
        }
        break;
      default:
        break;
    }
  });

  try {
    if (await isZip(file)) {
      const zip = await openZip(file);
      // The main file is translated on non-English phones (e.g. "экспорт.xml"),
      // so any top-level .xml except the clinical export_cda.xml qualifies;
      // "export.xml" wins when present, otherwise the largest.
      const candidates = zip.entries
        .filter((e) => /\.xml$/i.test(e.name)
          && !/(?:^|\/)export_cda\.xml$/i.test(e.name)
          && e.name.split('/').length <= 2)
        .sort((a, b) => (/(?:^|\/)export\.xml$/i.test(b.name) - /(?:^|\/)export\.xml$/i.test(a.name))
          || b.size - a.size);
      if (candidates.length === 0) {
        parsingErrors.sheetsNotFound.push('export.xml');
        parsingErrors.tablesNotParsed.push({
          sheetName: 'Apple Health Export',
          reason: 'No export.xml was found inside the ZIP file.',
          expectedPath: 'apple_health_export/export.xml',
        });
        return { data, parsingErrors };
      }
      await zip.streamText(candidates[0], (t) => scanner.push(t), onProgress);
    } else {
      await streamBlobText(file, (t) => scanner.push(t), onProgress);
    }
    scanner.end();
  } catch (error) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Apple Health Export',
      reason: `Failed to read the file: ${error.message}`,
      expectedFormat: 'ZIP or XML',
    });
    return { data, parsingErrors };
  }

  if (!sawHealthData) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Apple Health Export',
      reason: 'The file is not an Apple Health export (no <HealthData> element).',
      expectedFormat: 'export.zip or export.xml',
    });
    return { data, parsingErrors };
  }

  // ---- Daily Activity ----------------------------------------------------
  const dailyRows = [];
  for (const [date, d] of days) {
    const cum = (k) => (d.cumulative.has(k) ? d.cumulative.get(k).best().value : NaN);
    const s = (k) => d.sampled.get(k);
    const mean = (k) => (s(k) ? s(k).mean : NaN);
    const sum = d.summary;
    const exercise = sum && Number.isFinite(sum.exercise) ? sum.exercise : cum('exercise');
    const activeEnergy = Number.isFinite(cum('activeEnergy')) ? cum('activeEnergy') : (sum ? sum.move : NaN);
    const steps = d.cumulative.has('steps') ? d.cumulative.get('steps').best() : { value: NaN, source: '' };

    const row = {
      Date: date,
      Steps: fmtNum(steps.value, 0),
      'Distance (km)': fmtNum(cum('distance'), 2),
      'Cycling Distance (km)': fmtNum(cum('cycling'), 2),
      'Flights Climbed': fmtNum(cum('flights'), 0),
      'Active Energy (kcal)': fmtNum(activeEnergy, 0),
      'Resting Energy (kcal)': fmtNum(cum('restingEnergy'), 0),
      'Move Goal (kcal)': fmtNum(sum && sum.moveGoal, 0),
      'Exercise (min)': fmtNum(exercise, 0),
      'Stand Hours': fmtNum(sum && sum.stand, 0),
      'Time in Daylight (min)': fmtNum(cum('daylight'), 0),
      'Avg HR (bpm)': fmtNum(mean('hr'), 0),
      'Min HR (bpm)': fmtNum(s('hr') && s('hr').lo, 0),
      'Max HR (bpm)': fmtNum(s('hr') && s('hr').hi, 0),
      'Resting HR (bpm)': fmtNum(mean('restingHr'), 0),
      'Walking HR (bpm)': fmtNum(mean('walkingHr'), 0),
      'HRV SDNN (ms)': fmtNum(mean('hrv'), 1),
      'Respiratory Rate (brpm)': fmtNum(mean('resp'), 1),
      'SpO2 (%)': fmtNum(mean('spo2'), 1),
      VO2max: fmtNum(mean('vo2max'), 1),
      'Steps Source': steps.source,
    };
    if (Object.entries(row).every(([k, v]) => k === 'Date' || v === '')) continue;
    row._timestamp = dayTimestamp(date);
    dailyRows.push(row);
  }
  dailyRows.sort((a, b) => a.Date.localeCompare(b.Date));
  if (dailyRows.length > 0) data['Daily Activity'] = dailyRows;
  else {
    parsingErrors.sheetsNotFound.push('Daily activity');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Daily Activity',
      reason: 'No step, energy, heart-rate or activity-ring records were found.',
      expectedFormat: 'HKQuantityTypeIdentifier* records',
    });
  }

  // ---- Sleep -------------------------------------------------------------
  const sleepRows = [];
  for (const [date, bySource] of nights) {
    // Prefer the source with stage data, then the most time asleep.
    let best = null;
    let bestLabel = '';
    let bestScore = -1;
    let maxInBed = 0;
    for (const [lbl, acc] of bySource) {
      const asleep = acc.unspecified + acc.core + acc.deep + acc.rem;
      const staged = acc.core + acc.deep + acc.rem > 0 ? 1e6 : 0;
      const score = staged + asleep + (asleep === 0 ? acc.inBed / 1e3 : 0);
      if (score > bestScore) { best = acc; bestLabel = lbl; bestScore = score; }
      maxInBed = Math.max(maxInBed, acc.inBed);
    }
    if (!best) continue;
    const asleep = best.unspecified + best.core + best.deep + best.rem;
    const hasAsleep = asleep > 0;
    const startMs = hasAsleep ? best.asleepStart : best.bedStart;
    const endMs = hasAsleep ? best.asleepEnd : best.bedEnd;
    const staged = best.core + best.deep + best.rem > 0;
    sleepRows.push({
      Date: date,
      'Sleep Start': Number.isFinite(startMs) ? formatLocal(startMs, best.offset) : '',
      'Sleep End': Number.isFinite(endMs) ? formatLocal(endMs, best.offset) : '',
      'Total Asleep': hasAsleep ? formatDuration(asleep * 60) : '',
      'Asleep (min)': fmtNum(hasAsleep ? asleep : NaN, 0),
      'In Bed (min)': fmtNum(best.inBed > 0 ? best.inBed : (maxInBed > 0 ? maxInBed : NaN), 0),
      'Core (min)': staged ? fmtNum(best.core, 0) : '',
      'Deep (min)': staged ? fmtNum(best.deep, 0) : '',
      'REM (min)': staged ? fmtNum(best.rem, 0) : '',
      'Awake (min)': staged || best.awake > 0 ? fmtNum(best.awake, 0) : '',
      'Unstaged Asleep (min)': best.unspecified > 0 ? fmtNum(best.unspecified, 0) : '',
      Source: bestLabel,
      'Sources Recorded': String(bySource.size),
      _timestamp: dayTimestamp(date),
    });
  }
  sleepRows.sort((a, b) => a.Date.localeCompare(b.Date));
  if (sleepRows.length > 0) data['Sleep'] = sleepRows;
  else parsingErrors.sheetsNotFound.push('Sleep');

  // ---- Workouts ----------------------------------------------------------
  workouts.sort((a, b) => a._timestamp - b._timestamp);
  if (workouts.length > 0) data['Workouts'] = workouts;
  else parsingErrors.sheetsNotFound.push('Workouts');

  return { data, parsingErrors };
}

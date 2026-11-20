import { fmtNum } from '../utils/wearableFormat';
import { windowCutoff } from '../utils/timeWindow';

/**
 * Raw sample streams from a Google Takeout "Fit" export (`Fit/All Data/*.json`).
 *
 * Each file holds one data source: a `"Data Source"` id and a `"Data Points"`
 * array with one object per sample:
 *
 *   { "fitValue": [{ "value": { "fpVal": 72.0 } }],
 *     "startTimeNanos": 1767225600000000000,
 *     "endTimeNanos":   1767225600000000000,
 *     "dataTypeName": "com.google.heart_rate.bpm", ... }
 *
 * Files can be hundreds of MB (a heart-rate stream has a point every few
 * seconds), so they are streamed through a small brace-matching scanner that
 * hands over one point at a time instead of `JSON.parse`-ing the whole file.
 *
 * Only a whitelist of stream types is read (heart rate, steps, distance,
 * calories, activity segments, sleep segments). Location and every other
 * stream are never opened. Only samples inside the study window (the last
 * RAW_WINDOW_MONTHS months before the upload date) are kept.
 *
 * Google Fit stores several overlapping sources per type (its own merged
 * stream plus every raw app / device stream feeding it). Summing them would
 * double count, so when a merged stream exists only that one is read; if it
 * does not, every source for the type is kept and labelled.
 */

export const RAW_WINDOW_MONTHS = 6;

const ALL_DATA_RE = /(?:^|\/)All Data\/([^/]+)\.json$/i;
// File-name remainders (after "<derived|raw>_<type>_") of Google's merged streams.
const MERGED_RE = /^[^_]+_(?:merge|merged|estimated_steps)/i;
const DATA_POINTS_KEY_RE = /"Data Points"\s*:\s*\[/;

// Google Fit activity-type codes (com.google.activity.segment). Unlisted codes
// are shown as "Activity <code>" rather than guessed.
const ACTIVITY_NAMES = {
  0: 'In Vehicle', 1: 'Biking', 2: 'On Foot', 3: 'Still', 4: 'Unknown', 5: 'Tilting',
  7: 'Walking', 8: 'Running', 35: 'Hiking', 56: 'Jogging', 72: 'Sleeping',
  82: 'Swimming', 97: 'Weightlifting', 100: 'Yoga', 108: 'Other',
  109: 'Light Sleep', 110: 'Deep Sleep', 111: 'REM Sleep', 112: 'Awake (during sleep)',
};
// com.google.sleep.segment stage codes.
const SLEEP_STAGE_NAMES = {
  1: 'Awake', 2: 'Sleep', 3: 'Out of Bed', 4: 'Light Sleep', 5: 'Deep Sleep', 6: 'REM Sleep',
};

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Streams to read. `valueLabel` is the review-table column for the sample value. */
export const RAW_STREAMS = [
  { type: 'com.google.heart_rate.bpm', table: 'Raw Heart Rate', valueLabel: 'Heart Rate (bpm)', decimals: 1 },
  { type: 'com.google.step_count.delta', table: 'Raw Steps', valueLabel: 'Steps', decimals: 0 },
  { type: 'com.google.distance.delta', table: 'Raw Distance', valueLabel: 'Distance (m)', decimals: 2 },
  { type: 'com.google.calories.expended', table: 'Raw Calories', valueLabel: 'Calories (kcal)', decimals: 3 },
  { type: 'com.google.activity.segment', table: 'Raw Activity Segments', valueLabel: 'Activity', names: ACTIVITY_NAMES },
  { type: 'com.google.sleep.segment', table: 'Raw Sleep Segments', valueLabel: 'Sleep Stage', names: SLEEP_STAGE_NAMES },
].map((s) => ({ ...s, fileRe: new RegExp(`^(?:derived|raw)_${escapeRe(s.type)}_(.+)$`) }));

/**
 * Pick the whitelisted `All Data` files to read, per stream.
 * @param {{name: string}[]} entries - zip entries
 * @returns {Map<Object, {entry: Object, app: string}[]>} stream -> files
 */
export const selectStreamFiles = (entries) => {
  const found = new Map(RAW_STREAMS.map((s) => [s, []]));
  for (const entry of entries) {
    const m = entry.name.match(ALL_DATA_RE);
    if (!m) continue;
    for (const stream of RAW_STREAMS) {
      const rest = m[1].match(stream.fileRe);
      if (rest) {
        // The first underscore-delimited token is the app / device-maker id; the
        // rest of the stream id (device names, serials) is never emitted.
        found.get(stream).push({ entry, rest: rest[1], app: rest[1].split('_')[0] });
        break;
      }
    }
  }
  const selected = new Map();
  for (const [stream, files] of found) {
    const merged = files.filter((f) => MERGED_RE.test(f.rest));
    selected.set(stream, merged.length > 0 ? merged : files);
  }
  return selected;
};

/**
 * Incremental scanner: push UTF-8 text chunks, receive each element of the
 * `"Data Points"` array as a parsed object. Handles strings, escapes, and
 * objects split across chunk boundaries.
 * @param {(point: Object) => void} onPoint
 * @returns {{push: (text: string) => void, malformed: number}}
 */
export const createPointScanner = (onPoint) => {
  let header = '';
  let inPoints = false;
  let done = false;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let carry = '';
  const scanner = { malformed: 0 };

  scanner.push = (chunk) => {
    if (done) return;
    let text = chunk;
    if (!inPoints) {
      header += chunk;
      const m = DATA_POINTS_KEY_RE.exec(header);
      if (!m) {
        header = header.slice(-32); // the key may straddle chunks
        return;
      }
      text = header.slice(m.index + m[0].length);
      header = '';
      inPoints = true;
    }
    let segStart = depth > 0 ? 0 : -1;
    const n = text.length;
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      if (inStr) {
        if (esc) esc = false;
        else if (c === 92) esc = true; // backslash
        else if (c === 34) inStr = false; // quote
        continue;
      }
      if (c === 34) inStr = true;
      else if (c === 123) { // {
        if (depth === 0) segStart = i;
        depth += 1;
      } else if (c === 125) { // }
        depth -= 1;
        if (depth === 0) {
          const json = carry + text.slice(segStart, i + 1);
          carry = '';
          segStart = -1;
          try {
            onPoint(JSON.parse(json));
          } catch (e) {
            scanner.malformed += 1;
          }
        }
      } else if (c === 93 && depth === 0) { // ] closes the array
        done = true;
        return;
      }
    }
    if (depth > 0) carry += text.slice(segStart);
  };
  return scanner;
};

const nanosToMs = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n / 1e6 : NaN;
};

const pointValue = (point) => {
  const first = Array.isArray(point.fitValue) ? point.fitValue[0] : null;
  const v = first && first.value;
  if (!v) return null;
  if (v.intVal !== undefined) return Number(v.intVal);
  if (v.fpVal !== undefined) return Number(v.fpVal);
  return null;
};

const utc = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

/**
 * Read every whitelisted raw stream inside the study window.
 *
 * @param {Object} zip - result of `openZip`
 * @param {Object} [options]
 * @param {number} [options.now] - upload time, epoch ms (default: now)
 * @param {number} [options.windowMonths] - default RAW_WINDOW_MONTHS
 * @param {(fraction: number) => void} [options.onProgress]
 * @returns {Promise<{tables: Object, notes: Object[], hasAllData: boolean}>}
 */
export async function parseRawStreams(zip, options = {}) {
  const { now = Date.now(), windowMonths = RAW_WINDOW_MONTHS, onProgress } = options;
  const cutoff = windowCutoff(now, windowMonths);
  const selected = selectStreamFiles(zip.entries);

  const files = [];
  for (const [stream, list] of selected) list.forEach((f) => files.push({ stream, ...f }));
  const hasAllData = zip.entries.some((e) => ALL_DATA_RE.test(e.name));
  const totalBytes = files.reduce((sum, f) => sum + (f.entry.size || 0), 0) || 1;

  const samples = new Map(RAW_STREAMS.map((s) => [s, []])); // stream -> [startMs, endMs, value, app]
  const notes = [];
  let doneBytes = 0;

  for (const { stream, entry, app } of files) {
    const out = samples.get(stream);
    const scanner = createPointScanner((point) => {
      const startMs = nanosToMs(point.startTimeNanos);
      const endMs = nanosToMs(point.endTimeNanos);
      const anchor = Number.isFinite(endMs) ? endMs : startMs;
      if (!Number.isFinite(anchor) || anchor < cutoff) return; // outside the window
      const value = pointValue(point);
      if (value === null || !Number.isFinite(value)) return;
      out.push([Number.isFinite(startMs) ? startMs : anchor, anchor, value, app]);
    });
    // Snapshot per iteration: the progress closure must not read `doneBytes`,
    // which the loop mutates (react-app's no-loop-func fails CI builds on it).
    const bytesBefore = doneBytes;
    try {
      await zip.streamText(entry, (t) => scanner.push(t), (fraction) => {
        if (onProgress) onProgress(Math.min(1, (bytesBefore + fraction * (entry.size || 0)) / totalBytes));
      });
      if (scanner.malformed > 0) {
        notes.push({
          sheetName: stream.table,
          reason: `${scanner.malformed} malformed sample(s) were skipped.`,
          expectedFormat: 'JSON',
        });
      }
    } catch (error) {
      notes.push({ sheetName: stream.table, reason: `Failed to read a stream file: ${error.message}`, expectedFormat: 'JSON' });
    }
    doneBytes += entry.size || 0;
  }

  const tables = {};
  for (const stream of RAW_STREAMS) {
    const rows = samples.get(stream);
    if (rows.length === 0) {
      if (selected.get(stream).length > 0) {
        notes.push({
          sheetName: stream.table,
          reason: `No samples in the last ${windowMonths} months.`,
          expectedFormat: 'JSON',
        });
      }
      continue;
    }
    rows.sort((a, b) => a[0] - b[0]);
    // Keep the table compact: `End` only for interval streams, `Source` only
    // when more than one app contributed (otherwise it is constant).
    const hasInterval = rows.some((r) => r[1] !== r[0]);
    const multiSource = new Set(rows.map((r) => r[3])).size > 1;
    tables[stream.table] = rows.map(([startMs, endMs, value, app]) => {
      const row = { 'Start (UTC)': utc(startMs) };
      if (hasInterval) row['End (UTC)'] = endMs !== startMs ? utc(endMs) : '';
      row[stream.valueLabel] = stream.names
        ? (stream.names[value] || `Activity code ${value}`)
        : fmtNum(value, stream.decimals);
      if (multiSource) row.Source = app;
      // Hidden helpers: `_timestamp` powers the date-range filter, `_app`
      // lets the participant drop a whole stream with the exclude filter.
      row._timestamp = Math.round(startMs);
      row._app = stream.table;
      return row;
    });
  }
  return { tables, notes, hasAllData };
}

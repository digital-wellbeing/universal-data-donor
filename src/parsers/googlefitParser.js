import JSZip from 'jszip';

/**
 * Parser for Google Fit data from a Google Takeout export (.zip).
 *
 * Google Takeout's "Fit" export contains several folders. This parser reads the
 * two clean, research-relevant, low-sensitivity layers and turns them into two
 * review tables:
 *
 *   1. "Daily Activity"    — one row per day, aggregated from every 15-minute
 *      bucket in `Takeout/Fit/Daily activity metrics/<YYYY-MM-DD>.csv`
 *      (steps, calories, distance, move/heart minutes, heart rate, ...).
 *   2. "Activity Sessions" — one row per workout/session from every
 *      `Takeout/Fit/All Sessions/*.json` file (activity type, start/end,
 *      duration, and the aggregate metrics Google attaches to the session).
 *
 * Location columns (latitude / longitude) in the daily CSVs are dropped by
 * default as they are identifying; the raw per-sample streams under
 * `All Data/` and the GPS `.tcx` tracks under `Activities/` are intentionally
 * not parsed (heavy and highly granular). Add them here if a study needs them.
 *
 * @param {File} file - Uploaded Google Takeout .zip
 * @returns {Promise<{data: Object, parsingErrors: {sheetsNotFound: string[], tablesNotParsed: Object[]}}>}
 */

const DAILY_DIR_RE = /(?:^|\/)Daily activity metrics\/([^/]+)\.csv$/i;
// The combined per-day rollup Google ships alongside the intraday files.
const COMBINED_DAILY_RE = /(?:^|\/)Daily activity metrics\/Daily activity metrics\.csv$/i;
const SESSION_RE = /(?:^|\/)All Sessions\/([^/]+)\.json$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Known Google Fit session aggregate metrics → friendly column + rounding.
// Order here defines the display column order for the sessions table.
const SESSION_METRICS = [
  { name: 'com.google.step_count.delta', label: 'Steps', decimals: 0 },
  { name: 'com.google.calories.expended', label: 'Calories (kcal)', decimals: 1 },
  { name: 'com.google.distance.delta', label: 'Distance (m)', decimals: 1 },
  { name: 'com.google.active_minutes', label: 'Active Minutes', decimals: 0 },
  { name: 'com.google.heart_minutes.summary', label: 'Heart Minutes', decimals: 1 },
  { name: 'com.google.speed.summary', label: 'Average speed (m/s)', decimals: 2 },
];
const METRIC_BY_NAME = new Map(SESSION_METRICS.map((m) => [m.name, m]));

/**
 * Format a fractional-second duration to a readable string.
 * @param {number} seconds
 * @returns {string} e.g. "1 hour 5 minutes 3 seconds"
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
 * Format an ISO 8601 timestamp to a readable local date/time string.
 * @param {string} isoString
 * @returns {string}
 */
const formatISOTimestamp = (isoString) => {
  if (!isoString) return '';
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return String(isoString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });
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
 * Humanize a Google fitness-activity string, e.g. "weightlifting" -> "Weightlifting",
 * "in_vehicle" -> "In Vehicle".
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
 * Turn an unknown aggregate metric name into a readable column header, e.g.
 * "com.google.hydration" -> "Hydration".
 * @param {string} name
 * @returns {string}
 */
const labelForMetric = (name) => {
  const known = METRIC_BY_NAME.get(name);
  if (known) return known.label;
  const tail = String(name).replace(/^com\.google\./, '').replace(/\.(summary|delta)$/, '');
  return tail.replace(/[._-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Split one CSV line into fields, honoring double-quoted fields.
 * @param {string} line
 * @returns {string[]}
 */
const splitCsvLine = (line) => {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } else { inQuotes = false; }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
};

/**
 * Parse CSV text into a header row + array of value-arrays.
 * @param {string} text
 * @returns {{headers: string[], rows: string[][]}}
 */
const parseCsv = (text) => {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  const rows = lines.slice(1).map(splitCsvLine);
  return { headers, rows };
};

/**
 * Decide how a daily-metrics column aggregates across a day's 15-minute buckets.
 * Location and the per-bucket time columns are dropped.
 * @param {string} header
 * @returns {'sum'|'avg'|'max'|'min'|null}
 */
const dailyAggKind = (header) => {
  const h = header.trim();
  if (/latitude|longitude/i.test(h)) return null; // drop location (identifying)
  if (/^(start|end) time$/i.test(h)) return null; // replaced by the Date column
  if (/^average\b/i.test(h)) return 'avg';
  if (/^max\b/i.test(h)) return 'max';
  if (/^min\b/i.test(h)) return 'min';
  return 'sum';
};

/**
 * Decimal places for a daily aggregated column.
 * @param {string} header
 * @returns {number}
 */
const dailyDecimals = (header) => {
  if (/\((ms|min)\)/i.test(header)) return 1;
  if (/bpm|count|steps|minutes|points/i.test(header)) return 0;
  if (/speed/i.test(header)) return 2;
  return 1;
};

/**
 * Format one already-per-day row from the combined `Daily activity metrics.csv`
 * (Google pre-aggregates the day, so no summing is needed — just drop location,
 * convert millisecond durations to minutes, and round). Returns null if the row
 * has no date or carries no usable values.
 * @param {string[]} headers
 * @param {string[]} values
 * @returns {Object|null}
 */
const formatCombinedDailyRow = (headers, values) => {
  const row = {};
  let dateStr = '';
  let anyValue = false;

  headers.forEach((header, i) => {
    if (/latitude|longitude/i.test(header)) return; // drop location (identifying)
    const raw = values[i];
    if (/^date$/i.test(header)) {
      dateStr = (raw || '').trim();
      row.Date = dateStr;
      return;
    }
    let outHeader = header;
    let out = '';
    if (raw !== undefined && raw !== '') {
      const n = Number(raw);
      if (Number.isFinite(n)) {
        let value = n;
        if (/\(ms\)/i.test(header)) {
          value = n / 60000;
          outHeader = header.replace(/\(ms\)/i, '(min)');
        }
        out = fmtNum(value, dailyDecimals(outHeader));
        anyValue = true;
      } else {
        out = raw;
        anyValue = true;
      }
    } else if (/\(ms\)/i.test(header)) {
      outHeader = header.replace(/\(ms\)/i, '(min)');
    }
    row[outHeader] = out;
  });

  if (!dateStr || !anyValue) return null;
  const ts = Date.parse(`${dateStr}T12:00:00`);
  if (Number.isFinite(ts)) row._timestamp = ts;
  return row;
};

/**
 * Aggregate one day's CSV into a single summary row, or null if the file has no
 * usable metric values.
 * @param {string} dateStr - YYYY-MM-DD from the filename
 * @param {{headers: string[], rows: string[][]}} csv
 * @returns {Object|null}
 */
const aggregateDay = (dateStr, csv) => {
  const { headers, rows } = csv;
  if (headers.length === 0 || rows.length === 0) return null;

  // One accumulator per kept column.
  const cols = headers
    .map((header, index) => ({ header, index, kind: dailyAggKind(header) }))
    .filter((c) => c.kind !== null)
    .map((c) => ({ ...c, sum: 0, count: 0, max: -Infinity, min: Infinity }));

  for (const row of rows) {
    for (const col of cols) {
      const raw = row[col.index];
      if (raw === undefined || raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      col.count += 1;
      col.sum += n;
      if (n > col.max) col.max = n;
      if (n < col.min) col.min = n;
    }
  }

  const outRow = { Date: dateStr };
  let anyValue = false;

  for (const col of cols) {
    let outHeader = col.header;
    let value = '';
    if (col.count > 0) {
      anyValue = true;
      let n;
      if (col.kind === 'sum') n = col.sum;
      else if (col.kind === 'avg') n = col.sum / col.count;
      else if (col.kind === 'max') n = col.max;
      else n = col.min;
      // Present durations in minutes instead of milliseconds.
      if (/\(ms\)/i.test(col.header)) {
        n = n / 60000;
        outHeader = col.header.replace(/\(ms\)/i, '(min)');
      }
      value = fmtNum(n, dailyDecimals(outHeader));
    } else if (/\(ms\)/i.test(col.header)) {
      outHeader = col.header.replace(/\(ms\)/i, '(min)');
    }
    outRow[outHeader] = value;
  }

  if (!anyValue) return null;

  const ts = Date.parse(`${dateStr}T12:00:00`);
  if (Number.isFinite(ts)) outRow._timestamp = ts;
  return outRow;
};

/**
 * Parse one session JSON into an intermediate record.
 * @param {string} jsonText
 * @returns {Object|null}
 */
const parseSession = (jsonText) => {
  let session;
  try {
    session = JSON.parse(jsonText);
  } catch (e) {
    return null;
  }
  if (!session || typeof session !== 'object') return null;

  const activity = humanizeActivity(session.fitnessActivity);
  const startTime = session.startTime || '';
  const endTime = session.endTime || '';

  // Duration: prefer the "1234.5s" string; fall back to end - start.
  let durationSec = NaN;
  if (typeof session.duration === 'string') {
    durationSec = parseFloat(session.duration.replace(/s$/i, ''));
  }
  if (!Number.isFinite(durationSec)) {
    const s = Date.parse(startTime);
    const e = Date.parse(endTime);
    if (Number.isFinite(s) && Number.isFinite(e)) durationSec = (e - s) / 1000;
  }

  const metrics = {};
  if (Array.isArray(session.aggregate)) {
    for (const agg of session.aggregate) {
      if (!agg || (!agg.name && !agg.metricName)) continue;
      const name = agg.metricName || agg.name;
      const raw = agg.intValue !== undefined ? agg.intValue
        : agg.floatValue !== undefined ? agg.floatValue
        : undefined;
      if (raw === undefined) continue;
      const known = METRIC_BY_NAME.get(name);
      const decimals = known ? known.decimals : (agg.intValue !== undefined ? 0 : 2);
      metrics[name] = fmtNum(raw, decimals);
    }
  }

  const ts = Date.parse(startTime);
  return {
    activity,
    startTime,
    endTime,
    durationSec,
    metrics,
    _ts: Number.isFinite(ts) ? ts : null,
  };
};

/**
 * Run an async mapper over items with bounded concurrency (Takeout exports can
 * hold thousands of session files, so we avoid decompressing them all at once).
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
const mapWithConcurrency = async (items, limit, fn) => {
  const results = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
};

export default async function parseGoogleFitFile(file) {
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
      sheetName: 'Google Fit Takeout',
      reason: `Failed to open the ZIP file: ${error.message}`,
      expectedFormat: 'ZIP',
    });
    return { data, parsingErrors };
  }

  const entries = Object.keys(zip.files).filter((path) => !zip.files[path].dir);
  const combinedDailyPath = entries.find((p) => COMBINED_DAILY_RE.test(p));
  // Per-day intraday files, excluding the combined rollup.
  const perDayPaths = entries.filter((p) => DAILY_DIR_RE.test(p) && !COMBINED_DAILY_RE.test(p));
  const sessionPaths = entries.filter((p) => SESSION_RE.test(p));

  // ---- Daily Activity ----------------------------------------------------
  // Prefer Google's combined `Daily activity metrics.csv` (already one row per
  // day). Fall back to summing the per-day intraday CSVs on older exports.
  let dailyRows = [];
  if (combinedDailyPath) {
    try {
      const text = await zip.files[combinedDailyPath].async('string');
      const { headers, rows } = parseCsv(text);
      dailyRows = rows.map((values) => formatCombinedDailyRow(headers, values)).filter(Boolean);
    } catch (e) {
      dailyRows = [];
    }
  } else if (perDayPaths.length > 0) {
    const aggregated = await mapWithConcurrency(perDayPaths, 32, async (path) => {
      try {
        const match = path.match(DAILY_DIR_RE);
        const base = match ? match[1] : path.split('/').pop().replace(/\.csv$/i, '');
        const dateStr = DATE_RE.test(base) ? base : base;
        const text = await zip.files[path].async('string');
        return aggregateDay(dateStr, parseCsv(text));
      } catch (e) {
        return null;
      }
    });
    dailyRows = aggregated.filter(Boolean);
  }

  dailyRows.sort((a, b) => (a._timestamp || 0) - (b._timestamp || 0));
  if (dailyRows.length > 0) {
    data['Daily Activity'] = dailyRows;
  } else if (!combinedDailyPath && perDayPaths.length === 0) {
    parsingErrors.sheetsNotFound.push('Daily activity metrics');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Daily Activity',
      reason: 'No "Daily activity metrics" CSV files were found in the export.',
      expectedPath: 'Takeout/Fit/Daily activity metrics/<date>.csv',
    });
  } else {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Daily Activity',
      reason: 'Daily activity files were found but contained no usable metrics.',
      expectedFormat: 'CSV',
    });
  }

  // ---- Activity Sessions -------------------------------------------------
  if (sessionPaths.length === 0) {
    parsingErrors.sheetsNotFound.push('All Sessions');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Activity Sessions',
      reason: 'No "All Sessions" JSON files were found in the export.',
      expectedPath: 'Takeout/Fit/All Sessions/*.json',
    });
  } else {
    const parsed = (await mapWithConcurrency(sessionPaths, 48, async (path) => {
      try {
        const text = await zip.files[path].async('string');
        return parseSession(text);
      } catch (e) {
        return null;
      }
    })).filter(Boolean);

    if (parsed.length === 0) {
      parsingErrors.tablesNotParsed.push({
        sheetName: 'Activity Sessions',
        reason: 'Session files were found but none could be parsed.',
        expectedFormat: 'JSON',
      });
    } else {
      // Column order: known metrics first (in SESSION_METRICS order), then any
      // unknown metric names encountered, so every row shares the same columns.
      const presentNames = new Set();
      parsed.forEach((s) => Object.keys(s.metrics).forEach((n) => presentNames.add(n)));
      const orderedNames = [
        ...SESSION_METRICS.map((m) => m.name).filter((n) => presentNames.has(n)),
        ...Array.from(presentNames).filter((n) => !METRIC_BY_NAME.has(n)).sort(),
      ];

      parsed.sort((a, b) => (a._ts || 0) - (b._ts || 0));

      data['Activity Sessions'] = parsed.map((s) => {
        const row = {
          Activity: s.activity,
          'Start Time': formatISOTimestamp(s.startTime),
          'End Time': formatISOTimestamp(s.endTime),
          Duration: Number.isFinite(s.durationSec) ? formatDuration(s.durationSec) : '',
        };
        for (const name of orderedNames) {
          row[labelForMetric(name)] = s.metrics[name] !== undefined ? s.metrics[name] : '';
        }
        // Hidden helpers: `_timestamp` powers the date-range filter; `_app`
        // (the activity type) powers the "exclude" filter on the review page.
        if (s._ts !== null) row._timestamp = s._ts;
        row._app = s.activity;
        return row;
      });
    }
  }

  return { data, parsingErrors };
}

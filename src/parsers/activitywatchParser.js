/**
 * Parser for ActivityWatch data exports.
 *
 * Handles the standard "Export all buckets" JSON produced by aw-server / the
 * ActivityWatch web UI ( { "buckets": { <bucketId>: { type, hostname, events:[...] } } } ),
 * a single-bucket export ( { id, type, events:[...] } ), and a bare map of
 * bucketId -> bucket. One review table is produced per bucket.
 *
 * It is watcher-agnostic: it keys off each bucket's `type` for a friendly name
 * and takes the UNION of every event's `data` fields as the table columns, so
 * desktop (aw-watcher-window / aw-watcher-afk / aw-watcher-web) and mobile
 * (aw-watcher-android window + unlock) exports all parse without special-casing.
 *
 * @param {File} file - Uploaded ActivityWatch .json export
 * @returns {Promise<{data: Object, parsingErrors: {sheetsNotFound: string[], tablesNotParsed: Object[]}}>}
 */

// Friendly, human-readable table names per known bucket type.
const TYPE_LABELS = {
  currentwindow: 'App / Window Activity',
  afkstatus: 'Away-From-Keyboard (AFK)',
  'os.lockscreen.unlocks': 'Screen Unlocks',
  'web.tab.current': 'Web Browsing',
};

// Friendly column headers for known event `data` fields.
const FIELD_LABELS = {
  app: 'App',
  title: 'Title',
  package: 'Package',
  classname: 'Class Name',
  url: 'URL',
  status: 'Status',
  audible: 'Audible',
  incognito: 'Incognito',
};

/**
 * Format a duration in (fractional) seconds to a readable string.
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
 * Turn a raw `data` field key into a readable column header.
 * @param {string} key
 * @returns {string}
 */
const labelForField = (key) =>
  FIELD_LABELS[key] ||
  key.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Coerce a `data` value into something a table cell can display.
 * @param {*} value
 * @returns {string|number}
 */
const coerceValue = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }
  return value;
};

/**
 * Normalize the several possible export shapes into a bucketId -> bucket map.
 * @param {*} root - Parsed JSON root
 * @returns {Object} map of bucketId -> bucket
 */
const extractBuckets = (root) => {
  if (!root || typeof root !== 'object') return {};

  // Standard export: { "buckets": { ... } }
  if (root.buckets && typeof root.buckets === 'object') return root.buckets;

  // Single-bucket export: { id/type, events: [...] }
  if (Array.isArray(root.events) && (root.id || root.type)) {
    return { [root.id || 'bucket']: root };
  }

  // Bare map of bucketId -> bucket (every value has an events array)
  const values = Object.values(root);
  if (values.length > 0 && values.every((v) => v && typeof v === 'object' && Array.isArray(v.events))) {
    return root;
  }

  return {};
};

/**
 * Pick a unique, friendly table name for a bucket, disambiguating collisions
 * (e.g. the same watcher type on two hosts) by hostname/id.
 * @param {Object} bucket
 * @param {string} bucketId
 * @param {Set<string>} usedNames
 * @returns {string}
 */
const friendlyName = (bucket, bucketId, usedNames) => {
  const base = TYPE_LABELS[bucket.type] || bucketId || 'Bucket';
  if (!usedNames.has(base)) {
    usedNames.add(base);
    return base;
  }
  const host = bucket.hostname && bucket.hostname !== 'unknown' ? bucket.hostname : bucketId;
  let name = `${base} (${host})`;
  let n = 2;
  while (usedNames.has(name)) {
    name = `${base} (${host} ${n++})`;
  }
  usedNames.add(name);
  return name;
};

export default async function parseActivityWatchFile(file) {
  const data = {};
  const parsingErrors = {
    sheetsNotFound: [],
    tablesNotParsed: [],
  };

  // Read + parse JSON.
  let root;
  try {
    const text = await file.text();
    root = JSON.parse(text);
  } catch (error) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'ActivityWatch export',
      reason: `File is not valid JSON: ${error.message}`,
      expectedFormat: 'JSON',
    });
    return { data, parsingErrors };
  }

  const buckets = extractBuckets(root);
  const bucketIds = Object.keys(buckets);

  if (bucketIds.length === 0) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'ActivityWatch export',
      reason: 'No ActivityWatch buckets found. Expected a JSON export containing a "buckets" object with events.',
      expectedFormat: 'ActivityWatch bucket export (JSON)',
    });
    return { data, parsingErrors };
  }

  const usedNames = new Set();

  for (const bucketId of bucketIds) {
    const bucket = buckets[bucketId] || {};
    const events = Array.isArray(bucket.events) ? bucket.events : [];
    const tableName = friendlyName(bucket, bucketId, usedNames);

    if (events.length === 0) {
      parsingErrors.tablesNotParsed.push({
        sheetName: tableName,
        reason: 'Bucket contains no events',
        bucketId,
      });
      continue;
    }

    // Determine the union of `data` field keys (preserving first-seen order) and
    // whether any event carries a meaningful (> 0) duration.
    const dataKeys = [];
    const seenKeys = new Set();
    let hasDuration = false;

    for (const event of events) {
      if (Number(event && event.duration) > 0) hasDuration = true;
      const eventData = event && event.data;
      if (eventData && typeof eventData === 'object') {
        for (const key of Object.keys(eventData)) {
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            dataKeys.push(key);
          }
        }
      }
    }

    // Column order is defined by the insertion order of the first row's keys
    // (see FilterPage), so build every row with the same keys in a fixed order:
    // time, [duration], then each data field.
    const timeHeader = hasDuration ? 'Start Time' : 'Time';

    const rows = events.map((event) => {
      const row = {};
      row[timeHeader] = formatISOTimestamp(event && event.timestamp);
      if (hasDuration) row['Duration'] = formatDuration(event && event.duration);
      for (const key of dataKeys) {
        const raw = event && event.data ? event.data[key] : '';
        row[labelForField(key)] = coerceValue(raw);
      }

      // Hidden helper fields (keys starting with "_" are excluded from the
      // displayed columns and stripped from the donation by FilterPage). These
      // power the date-range and per-app filters on the review page.
      const ts = Date.parse(event && event.timestamp);
      if (Number.isFinite(ts)) row._timestamp = ts;
      const appValue = event && event.data ? event.data.app : undefined;
      if (appValue !== undefined && appValue !== null && appValue !== '') {
        row._app = String(appValue);
      }

      return row;
    });

    data[tableName] = rows;
  }

  return { data, parsingErrors };
}

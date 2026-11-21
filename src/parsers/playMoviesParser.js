import { openZip } from '../utils/zipReader';
import { parseLooseDate } from '../utils/timeWindow';

/**
 * Parser for the "Google Play Movies & TV" folder of a Google Takeout zip.
 *
 * Reads two JSON files, keeping the title and the time of each entry:
 *  - `Watchlist.json`: titles you saved, with the time you saved them.
 *  - a viewing-history file (`Viewing History.json`, `Watch history.json`, ...), when the
 *    export has one. Many exports do not: the legacy service is retired.
 *
 * Everything else in the folder (purchases, rentals, ratings, linked and streaming
 * services, notification preferences) is never opened.
 *
 * Layout sources (unverified against a populated export): a community guide describes
 * `Watchlist.json` as `{"items": [{"title": ..., "added_time": "Apr 28, 2023, 4:32:51 AM GMT"}]}`,
 * while empty exports hold a bare `[]`. So both an `items` object and a plain array are
 * accepted, and the time field is looked up under several likely names. A file that has
 * entries but no recognisable title/time is reported instead of silently producing nothing.
 *
 * @param {File} file - One Takeout zip.
 * @param {(fraction: number) => void} [onProgress]
 * @returns {Promise<{data: Object, parsingErrors: Object}>}
 */

/** Path of the files this parser reads (the folder name is localised, the file names are not). */
export const PLAY_MOVIES_FILE = /(?:^|\/)Google Play [^/]*\/(?:[^/]+\/)*(?:Watchlist|(?:Viewing|Watch)[ _-]?(?:History|Activity))\.json$/i;
const WATCHLIST_FILE = /\/Watchlist\.json$/i;

const TITLE_KEYS = ['title', 'name', 'Title', 'Name'];
const WATCHLIST_TIME_KEYS = ['added_time', 'addedTime', 'added_at', 'addedAt', 'time_added', 'timestamp', 'time', 'date'];
const HISTORY_TIME_KEYS = [
  'watched_time', 'watchedTime', 'watch_time', 'watchTime', 'viewed_time', 'viewTime', 'start_time', 'startTime',
  'timestamp', 'time', 'date',
];
const PLACEHOLDER_TITLE = /^unknown item$/i;

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// "Apr 28, 2023, 4:32:51 AM GMT" (the space before AM/PM may be U+202F).
const GOOGLE_STAMP = /^([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?\s*(?:GMT|UTC|Z)?$/i;

/**
 * Epoch ms of a time value: epoch number (seconds or ms), ISO string, or Google's printed
 * form (read as GMT). Falls back to midnight of the printed date; null when there is none.
 */
export const parseStamp = (value) => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value < 1e11 ? value * 1000 : value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const iso = Date.parse(text);
    if (Number.isFinite(iso)) return iso;
  }
  const printed = text.match(GOOGLE_STAMP);
  if (printed && MONTHS[printed[1].slice(0, 3).toLowerCase()] !== undefined) {
    let hour = +printed[4];
    if (printed[7]) hour = (hour % 12) + (printed[7].toUpperCase() === 'PM' ? 12 : 0);
    return Date.UTC(+printed[3], MONTHS[printed[1].slice(0, 3).toLowerCase()], +printed[2], hour, +printed[5], +(printed[6] || 0));
  }
  return parseLooseDate(text);
};

const firstOf = (item, keys) => {
  for (const key of keys) {
    if (item[key] !== undefined && item[key] !== null && item[key] !== '') return item[key];
  }
  return undefined;
};

/** The array of entries in a file: the file itself, or its `items` (or only array-valued) field. */
const entriesOf = (parsed) => {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.items)) return parsed.items;
    const arrays = Object.values(parsed).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0];
  }
  return null;
};

const toRows = (entries, { timeKeys, dateColumn }) => {
  const rows = [];
  let unrecognised = 0;
  entries.forEach((entry) => {
    if (!entry || typeof entry !== 'object') { unrecognised += 1; return; }
    const title = firstOf(entry, TITLE_KEYS);
    if (typeof title !== 'string' || PLACEHOLDER_TITLE.test(title.trim())) {
      // Title-less and "Unknown Item" placeholders carry nothing to donate.
      if (title === undefined) unrecognised += 1;
      return;
    }
    const raw = firstOf(entry, timeKeys);
    const ms = parseStamp(raw);
    const row = { Title: title.trim(), [dateColumn]: typeof raw === 'string' ? raw : (ms === null ? '' : new Date(ms).toISOString()) };
    if (ms !== null) row._timestamp = ms;
    rows.push(row);
  });
  return { rows: rows.sort((a, b) => (a._timestamp ?? Infinity) - (b._timestamp ?? Infinity)), unrecognised };
};

export default async function parsePlayMovies(file, onProgress) {
  const data = {};
  const parsingErrors = { sheetsNotFound: [], tablesNotParsed: [] };

  const zip = await openZip(file);
  const targets = zip.entries.filter((entry) => PLAY_MOVIES_FILE.test(entry.name));

  for (let i = 0; i < targets.length; i += 1) {
    const entry = targets[i];
    const isWatchlist = WATCHLIST_FILE.test(entry.name);
    const table = isWatchlist ? 'Watchlist' : 'Viewing History';
    try {
      const entries = entriesOf(JSON.parse(await zip.readText(entry)));
      if (entries === null) throw new TypeError('Expected a JSON array of entries');
      const { rows, unrecognised } = toRows(entries, {
        timeKeys: isWatchlist ? WATCHLIST_TIME_KEYS : HISTORY_TIME_KEYS,
        dateColumn: isWatchlist ? 'Date Added' : 'Date Watched',
      });
      if (rows.length > 0) data[table] = (data[table] || []).concat(rows);
      if (entries.length > 0 && rows.length === 0 && unrecognised > 0) {
        parsingErrors.tablesNotParsed.push({
          sheetName: table,
          reason: `The file has ${entries.length} entries but none with a recognisable title.`,
          expectedColumns: ['title', isWatchlist ? 'added_time' : 'watched time'],
        });
      }
    } catch (error) {
      // Error messages can quote file content, so only the error type is recorded.
      parsingErrors.tablesNotParsed.push({
        sheetName: table,
        reason: `Could not read ${table} (${(error && error.name) || 'error'}).`,
        expectedFormat: 'JSON',
      });
    }
    if (onProgress) onProgress((i + 1) / targets.length);
  }

  return { data, parsingErrors };
}

import JSZip from 'jszip';
import { openZip } from '../utils/zipReader';
import { windowCutoff, parseLooseDate, applyWindow } from '../utils/timeWindow';
import parseGoogleFit from './googlefitParser';
import parseGoogleHealth from './fitbitParser';
import parsePlayGames from './androidParser';
import parseYouTube from './youtubeParser';
import parsePlayMovies, { PLAY_MOVIES_FILE } from './playMoviesParser';

/**
 * Parser for a complete Google Takeout export: one or several `.zip` parts.
 *
 * Google splits large exports across zips (`takeout-...-1-001.zip`, `-2-001`,
 * ...), each holding different services, so this parser takes every part at
 * once, finds which services each contains, delegates to the matching
 * single-service parser, labels each table with its source, and keeps only
 * rows from the last `windowMonths` months (a parameter; 0 disables it).
 * While a window is active, a row whose date cannot be determined is removed
 * too, so nothing of unknown age is donated.
 *
 * Services: Google Fit, Google Health (Fitbit), Google Play Games, Play Movies & TV
 * (watchlist and viewing history), YouTube.
 *
 * @param {File|File[]} input - One Takeout zip, or all of its parts.
 * @param {(fraction: number) => void} [onProgress]
 * @param {{windowMonths?: number, youtubeSessionGapMinutes?: number, now?: Date|number}} [options]
 * @returns {Promise<{data: Object, parsingErrors: Object, metadata: {window: Object, services: string[]}}>}
 */

const DEFAULT_WINDOW_MONTHS = 6;

// androidParser loads the whole zip with JSZip, which cannot cope with a multi-GB Takeout part, so
// only the two small files it reads are copied into a fresh zip first.
const PLAY_GAMES_FILES = /(?:^|\/)Google Play Games Services\/(?:Global\/Playtime|Games\/[^/]+\/Activity)\.(?:html|json)$/i;

const slimPlayGamesZip = async (file) => {
  const zip = await openZip(file);
  const slim = new JSZip();
  for (const entry of zip.entries) {
    if (PLAY_GAMES_FILES.test(entry.name)) slim.file(entry.name, await zip.readBytes(entry));
  }
  const bytes = await slim.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return new File([bytes], 'play-games.zip', { type: 'application/zip' });
};

const SERVICES = [
  {
    id: 'fit',
    label: 'Google Fit',
    prefix: 'Google Fit',
    detect: /(?:^|\/)Fit\/(?:All Sessions|Daily activity metrics)\//i,
    // Fit also streams raw samples with its own window, so hand it the same one.
    parse: (file, report, options) => parseGoogleFit(file, report, { now: options.now, windowMonths: options.windowMonths }),
  },
  {
    id: 'health',
    label: 'Google Health',
    prefix: 'Google Health',
    // Google renamed the Fitbit export to "Google Health"; fitbitParser reads both layouts.
    detect: /(?:^|\/)(?:Google Health|Fitbit)\//i,
    parse: (file, report) => parseGoogleHealth(file, report),
  },
  {
    id: 'games',
    label: 'Play Games',
    prefix: 'Play Games',
    detect: /(?:^|\/)Google Play Games Services\//i,
    parse: async (file) => parsePlayGames(await slimPlayGamesZip(file)),
  },
  {
    id: 'movies',
    label: 'Play Movies & TV',
    prefix: 'Play Movies & TV',
    detect: PLAY_MOVIES_FILE,
    parse: (file, report) => parsePlayMovies(file, report),
  },
  {
    id: 'youtube',
    label: 'YouTube',
    prefix: null, // the YouTube parser already names its tables "YouTube - ..."
    multiFile: true, // watch and search history may sit in different parts, so it reads them all in one run
    // The folder is localised ("YouTube und YouTube Music"); the file names are not.
    detect: /(?:^|\/)history\/(?:watch|search)-history\.(?:html|json)$/i,
    parse: (files, report, options) => parseYouTube(files, report, { sessionGapMinutes: options.youtubeSessionGapMinutes }),
  },
];

const tableName = (service, name) => (service.prefix ? `${service.prefix} - ${name}` : name);

/** Best-effort epoch ms for a row; null when the row has no usable date. */
const timestampOf = (table, row) => {
  // Sessions and daily rows share one rule (the day as printed in the export), so a session
  // cannot be dropped while the daily row that counts it is kept, or the reverse.
  if (table.startsWith('YouTube - ')) return parseLooseDate(row.Date);
  if (Number.isFinite(row._timestamp)) return row._timestamp;
  if (table === 'Play Games - Daily Playtime') return parseLooseDate(row.Date);
  if (table === 'Play Games - Game Activity') {
    const last = parseLooseDate(row['Time Last Played']);
    return last === null ? parseLooseDate(row['Time First Played']) : last;
  }
  return null;
};

const byTimeUndatedLast = (table) => (a, b) => {
  const ta = timestampOf(table, a);
  const tb = timestampOf(table, b);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return ta - tb;
};

/** A game still played recently must not carry an older "first played" date out of the window. */
const redactOldFirstPlayed = (rows, cutoff, cutoffDate) => rows.map((row) => {
  const value = row['Time First Played'];
  if (!value) return row;
  const first = parseLooseDate(value);
  if (first === null) return { ...row, 'Time First Played': '' };
  return first < cutoff ? { ...row, 'Time First Played': `Before ${cutoffDate}` } : row;
});

/** Cheap identity of a zip from its central directory (names + sizes), so a re-download counts once. */
const fingerprint = (entries) => {
  let hash = 2166136261;
  const text = entries.map((e) => `${e.name}:${e.size}`).join('|');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${entries.length}:${hash}`;
};

export default async function parseGoogleTakeout(input, onProgress, options = {}) {
  const files = (Array.isArray(input) ? input : [input]).filter(Boolean);
  const months = options.windowMonths === undefined ? DEFAULT_WINDOW_MONTHS : options.windowMonths;
  const cutoff = windowCutoff(options.now === undefined ? new Date() : options.now, months);
  const windowed = Number.isFinite(cutoff);
  const cutoffDate = windowed ? new Date(cutoff).toISOString().slice(0, 10) : null;

  const parsingErrors = { sheetsNotFound: [], tablesNotParsed: [] };
  const holders = new Map(SERVICES.map((service) => [service.id, []]));
  const seen = new Set();

  // 1. Find which services each zip holds (reads only the zip's central directory).
  for (let i = 0; i < files.length; i += 1) {
    let entries;
    try {
      entries = (await openZip(files[i])).entries;
    } catch (error) {
      parsingErrors.tablesNotParsed.push({
        sheetName: `Takeout file ${i + 1}`,
        reason: `Could not open the file as a ZIP archive: ${error.message}`, // zipReader's own fixed messages
        expectedFormat: 'ZIP',
      });
      continue;
    }
    const id = fingerprint(entries);
    if (seen.has(id)) continue; // the same part selected twice
    seen.add(id);
    const names = entries.map((entry) => entry.name);
    SERVICES.forEach((service) => {
      if (names.some((name) => service.detect.test(name))) holders.get(service.id).push(files[i]);
    });
  }

  const found = new Set();
  const jobs = [];
  SERVICES.forEach((service) => {
    const list = holders.get(service.id);
    if (list.length === 0) return;
    found.add(service.id);
    if (service.multiFile) jobs.push({ input: list, service });
    else list.forEach((file) => jobs.push({ input: file, service }));
  });

  // 2. Run each service parser on the zips that hold it and collect labelled rows.
  const collected = new Map();
  // Rows a service parser already removed under the same window (Google Fit cuts its own tables).
  const preDropped = {};
  const preUndated = {};
  for (let j = 0; j < jobs.length; j += 1) {
    const { input: jobInput, service } = jobs[j];
    const report = (fraction) => onProgress && onProgress((j + fraction) / jobs.length);
    try {
      const result = await service.parse(jobInput, report, options);
      Object.entries(result.data || {}).forEach(([name, tableRows]) => {
        const key = tableName(service, name);
        collected.set(key, (collected.get(key) || []).concat(tableRows));
      });
      const preWindow = (result.metadata && result.metadata.window) || {};
      Object.entries(preWindow.droppedRowCounts || {}).forEach(([name, n]) => {
        const key = tableName(service, name);
        preDropped[key] = (preDropped[key] || 0) + n;
      });
      Object.entries(preWindow.undatedRowCounts || {}).forEach(([name, n]) => {
        const key = tableName(service, name);
        preUndated[key] = (preUndated[key] || 0) + n;
      });
      const errors = result.parsingErrors || {};
      (errors.sheetsNotFound || []).forEach((name) => parsingErrors.sheetsNotFound.push(`${service.label}: ${name}`));
      (errors.tablesNotParsed || []).forEach((error) => parsingErrors.tablesNotParsed.push({
        ...error,
        sheetName: service.prefix ? `${service.label}: ${error.sheetName}` : error.sheetName,
      }));
    } catch (error) {
      // Error messages can quote file content, so only the error type is recorded.
      parsingErrors.tablesNotParsed.push({
        sheetName: service.label,
        reason: `Failed to parse ${service.label} data (${(error && error.name) || 'error'}).`,
      });
    }
    report(1);
  }
  SERVICES.filter((service) => !found.has(service.id)).forEach((service) => parsingErrors.sheetsNotFound.push(service.label));

  // 3. Keep only the last `windowMonths` months and remember what was removed.
  const data = {};
  const droppedRowCounts = {};
  const undatedRowCounts = {};
  collected.forEach((tableRows, name) => {
    const { kept, dropped, undated } = applyWindow(tableRows, (row) => timestampOf(name, row), cutoff, { keepUndated: false });
    if (dropped > 0) droppedRowCounts[name] = dropped;
    if (undated > 0 && windowed) undatedRowCounts[name] = undated;
    if (kept.length === 0) return;
    const ordered = kept.sort(byTimeUndatedLast(name));
    data[name] = windowed && name === 'Play Games - Game Activity' ? redactOldFirstPlayed(ordered, cutoff, cutoffDate) : ordered;
  });
  // Add what the service parsers removed themselves, including tables they emptied entirely.
  Object.entries(preDropped).forEach(([name, n]) => { droppedRowCounts[name] = (droppedRowCounts[name] || 0) + n; });
  if (windowed) Object.entries(preUndated).forEach(([name, n]) => { undatedRowCounts[name] = (undatedRowCounts[name] || 0) + n; });
  const totalDropped = Object.values(droppedRowCounts).reduce((sum, n) => sum + n, 0);
  const effectiveMonths = windowed ? Math.max(1, Math.round(months)) : null;

  if (Object.keys(data).length === 0 && totalDropped > 0) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Time window',
      reason: `Found ${totalDropped} rows, but all are older than ${cutoffDate} (the last ${effectiveMonths} months), so none can be donated.`,
    });
  }

  return {
    data,
    parsingErrors,
    metadata: {
      window: { months: effectiveMonths, cutoff: cutoffDate, droppedRowCounts, undatedRowCounts, totalDropped },
      services: SERVICES.filter((service) => found.has(service.id)).map((service) => service.label),
    },
  };
}

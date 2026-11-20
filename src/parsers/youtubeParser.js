import { openZip } from '../utils/zipReader';

/**
 * Parser for YouTube / YouTube Music watch and search history from a Google
 * Takeout export (.zip), in either the HTML or the JSON Takeout format.
 *
 * Privacy by construction: only *when* something happened is kept. Video
 * titles, URLs, channel names and search text are read to classify an entry
 * and are then discarded; they never reach the returned tables.
 *
 * Takeout records no watch durations, so a "viewing session" is estimated by
 * grouping consecutive watch events that are at most `sessionGapMinutes`
 * apart; its span runs from the first to the last event in the group.
 *
 * Output tables:
 *   - "YouTube - Viewing Sessions": one row per estimated session and product.
 *   - "YouTube - Daily Activity":   one row per day (as printed in the export).
 *
 * @param {File|File[]} input - Takeout .zip (or all its parts) containing `.../history/watch-history.*`
 *   and/or `.../history/search-history.*`.
 * @param {(fraction: number) => void} [onProgress]
 * @param {{sessionGapMinutes?: number}} [options]
 * @returns {Promise<{data: Object, parsingErrors: {sheetsNotFound: string[], tablesNotParsed: Object[]}}>}
 */

// The folder name is localised ("YouTube und YouTube Music", ...), the file names are not.
const HISTORY_RE = /(?:^|\/)history\/(watch|search)-history\.(html|json)$/i;
const BLOCK_MARK = '<div class="outer-cell';
const DEFAULT_GAP_MINUTES = 30;

const MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Offsets in minutes for the abbreviations Google prints. Ambiguous ones
// (IST: India / Ireland / Israel) are deliberately absent and get flagged.
const TZ_OFFSETS = {
  GMT: 0, UTC: 0, UT: 0, Z: 0, WET: 0, WEST: 60, BST: 60, CET: 60, CEST: 120, EET: 120, EEST: 180,
  MSK: 180, SAST: 120, WAT: 60, CAT: 120, EAT: 180, PKT: 300, SGT: 480, HKT: 480, JST: 540, KST: 540,
  AWST: 480, ACST: 570, AEST: 600, AEDT: 660, NZST: 720, NZDT: 780,
  EST: -300, EDT: -240, CST: -360, CDT: -300, MST: -420, MDT: -360, PST: -480, PDT: -420,
  AKST: -540, AKDT: -480, HST: -600,
};

// The timestamp is the LAST thing in an entry: a date, a time, an optional AM/PM and an optional
// zone. Anchoring to the end of the text (and requiring an upper-case zone) means a date that
// merely appears inside a video title can never be mistaken for the event time, and no fragment
// of a title can ever be captured as a "zone".
const TIME_TAIL = ',?\\s+(\\d{1,2}):(\\d{2}):(\\d{2})[\\s\\u00a0\\u202f]*([AaPp]\\.?[Mm]\\.?)?'
  + '[\\s\\u00a0\\u202f]*((?:GMT|UTC)?[+\\-\\u2212]\\d{1,2}(?::?\\d{2})?|[A-Z]{2,5})?(?![A-Za-z])\\s*$';
const TS_FORMATS = [
  { re: new RegExp(`([A-Za-z]{3,9})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})${TIME_TAIL}`), monthAt: 1, dayAt: 2 }, // Nov 19, 2026, 9:08:08 AM GMT
  { re: new RegExp(`(\\d{1,2})\\.?\\s+([A-Za-z]{3,9})\\.?,?\\s+(\\d{4})${TIME_TAIL}`), monthAt: 2, dayAt: 1 }, // 19 Nov 2026, 09:08:08 GMT
];

const pad = (n) => String(n).padStart(2, '0');

const formatOffset = (minutes) => {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

/** Offset in minutes for a tz token, or null when it is not recognised. */
const offsetFor = (token) => {
  if (!token) return null;
  const numeric = token.match(/^(?:GMT|UTC)?([+\-−])(\d{1,2})(?::?(\d{2}))?$/i);
  if (numeric) {
    const sign = numeric[1] === '+' ? 1 : -1;
    return sign * (Number(numeric[2]) * 60 + Number(numeric[3] || 0));
  }
  const known = TZ_OFFSETS[token.toUpperCase()];
  return known === undefined ? null : known;
};

/**
 * Parse the timestamp Google prints in the HTML export, in either English
 * order: "Nov 19, 2026, 9:08:08 AM GMT" (the space before AM/PM is U+202F) or
 * "19 Nov 2026, 09:08:08 GMT". The timestamp must end the text, so a date
 * inside a title cannot win.
 *
 * @param {string} text
 * @returns {{ms: number, dateKey: string, time: string, offsetMin: number, tz: string, tzAssumed: boolean}|null}
 */
export const parseTakeoutTimestamp = (text) => {
  if (typeof text !== 'string') return null;
  for (const { re, monthAt, dayAt } of TS_FORMATS) {
    const match = text.match(re);
    const month = match ? MONTH_INDEX[match[monthAt].slice(0, 3).toLowerCase()] : undefined;
    if (month === undefined) continue;

    const day = Number(match[dayAt]);
    const year = Number(match[3]);
    let hour = Number(match[4]);
    const ampm = match[7] ? match[7].replace(/\./g, '').toUpperCase() : null;
    if (ampm) hour = (hour % 12) + (ampm === 'PM' ? 12 : 0);
    const minute = Number(match[5]);
    const second = Number(match[6]);

    const tz = match[8] || '';
    const known = offsetFor(tz);
    const offsetMin = known === null ? 0 : known;
    return {
      ms: Date.UTC(year, month, day, hour, minute, second) - offsetMin * 60000,
      dateKey: `${year}-${pad(month + 1)}-${pad(day)}`,
      time: `${pad(hour)}:${pad(minute)}:${pad(second)}`,
      offsetMin,
      tz,
      tzAssumed: known === null,
    };
  }
  return null;
};

const decodeText = (html) => html
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;|&emsp;|&ensp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/\s+/g, ' ')
  .trim();

const classify = (text) => {
  if (/^Watched\b/i.test(text)) return 'watch';
  if (/^Searched for\b/i.test(text)) return 'search';
  return 'other';
};

const normaliseProduct = (value) => (/music/i.test(value || '') ? 'YouTube Music' : 'YouTube');

/** Collects events and tallies what was skipped, without retaining any content. */
const createCollector = () => {
  const events = [];
  const stats = { watch: 0, search: 0, other: 0, ads: 0, unparsable: 0, tzAssumed: new Map() };

  const add = (kind, product, stamp, isAd) => {
    if (isAd) { stats.ads += 1; return; }
    if (kind === 'other') { stats.other += 1; return; }
    if (!stamp) { stats.unparsable += 1; return; }
    if (stamp.tzAssumed) stats.tzAssumed.set(stamp.tz || '(none)', (stats.tzAssumed.get(stamp.tz || '(none)') || 0) + 1);
    stats[kind] += 1;
    events.push({
      kind, product: normaliseProduct(product), ms: stamp.ms, dateKey: stamp.dateKey, time: stamp.time, offsetMin: stamp.offsetMin,
    });
  };

  const addHtmlBlock = (block) => {
    const cell = block.match(/mdl-typography--body-1">([\s\S]*?)<\/div>/);
    if (!cell) return;
    const text = decodeText(cell[1]);
    const header = block.match(/mdl-typography--title">([^<]*)</);
    add(classify(text), header ? header[1] : '', parseTakeoutTimestamp(text), /From Google Ads/i.test(block));
  };

  const addJsonItem = (item) => {
    if (!item || typeof item !== 'object') return;
    const kind = classify(String(item.title || ''));
    const time = typeof item.time === 'string' ? Date.parse(item.time) : NaN;
    const stamp = Number.isFinite(time)
      ? (() => {
        const d = new Date(time);
        return {
          ms: time,
          dateKey: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
          time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`,
          offsetMin: 0,
          tz: 'UTC',
          tzAssumed: false,
        };
      })()
      : null;
    const isAd = Array.isArray(item.details) && item.details.some((d) => /Google Ads/i.test(String((d && d.name) || '')));
    add(kind, item.header || (Array.isArray(item.products) ? item.products[0] : ''), stamp, isAd);
  };

  return { events, stats, addHtmlBlock, addJsonItem };
};

/** Stream an HTML history file block by block so large exports stay memory-flat. */
const readHtml = async (zip, entry, collector, onProgress) => {
  let buffer = '';
  const flush = (final) => {
    let start = buffer.indexOf(BLOCK_MARK);
    if (start < 0) {
      buffer = final ? '' : buffer.slice(-BLOCK_MARK.length); // a marker may straddle two chunks
      return;
    }
    for (;;) {
      const next = buffer.indexOf(BLOCK_MARK, start + BLOCK_MARK.length);
      if (next < 0) break;
      collector.addHtmlBlock(buffer.slice(start, next));
      start = next;
    }
    buffer = buffer.slice(start);
    if (final) { collector.addHtmlBlock(buffer); buffer = ''; }
  };
  await zip.streamText(entry, (chunk) => { buffer += chunk; flush(false); }, onProgress);
  flush(true);
};

const readJson = async (zip, entry, collector) => {
  const items = JSON.parse(await zip.readText(entry));
  if (!Array.isArray(items)) throw new Error('Expected a JSON array of history items');
  items.forEach((item) => collector.addJsonItem(item));
};

const sessionize = (events, gapMs) => {
  const sessions = [];
  let current = null;
  [...events].sort((a, b) => a.ms - b.ms).forEach((e) => {
    if (current && e.ms - current.last.ms <= gapMs) {
      current.last = e;
      current.count += 1;
    } else {
      current = { first: e, last: e, count: 1 };
      sessions.push(current);
    }
  });
  return sessions;
};

const buildSessionRows = (watchEvents, gapMs) => {
  const byProduct = new Map();
  watchEvents.forEach((e) => {
    if (!byProduct.has(e.product)) byProduct.set(e.product, []);
    byProduct.get(e.product).push(e);
  });
  const rows = [];
  byProduct.forEach((events, product) => {
    sessionize(events, gapMs).forEach(({ first, last, count }) => {
      rows.push({
        Date: first.dateKey,
        Product: product,
        'Start Time': `${first.dateKey} ${first.time}`,
        'End Time': `${last.dateKey} ${last.time}`,
        'Span (min)': String(Math.round(((last.ms - first.ms) / 60000) * 10) / 10),
        'Items Played': String(count),
        'UTC Offset': formatOffset(first.offsetMin),
        _timestamp: first.ms,
      });
    });
  });
  return rows.sort((a, b) => a._timestamp - b._timestamp);
};

const buildDailyRows = (events, sessionRows) => {
  const days = new Map();
  const dayFor = (key) => {
    if (!days.has(key)) days.set(key, { videos: 0, music: 0, searches: 0, first: null, last: null });
    return days.get(key);
  };
  events.forEach((e) => {
    const day = dayFor(e.dateKey);
    if (e.kind === 'search') day.searches += 1;
    else if (e.product === 'YouTube Music') day.music += 1;
    else day.videos += 1;
    if (!day.first || e.ms < day.first.ms) day.first = e;
    if (!day.last || e.ms > day.last.ms) day.last = e;
  });
  const sessionsPerDay = new Map();
  sessionRows.forEach((s) => sessionsPerDay.set(s.Date, (sessionsPerDay.get(s.Date) || 0) + 1));

  return [...days.keys()].sort().map((key) => {
    const day = days.get(key);
    const [y, m, d] = key.split('-').map(Number);
    return {
      Date: key,
      'Videos Watched': String(day.videos),
      'Music Tracks Played': String(day.music),
      Searches: String(day.searches),
      'Viewing Sessions': String(sessionsPerDay.get(key) || 0),
      'First Activity': day.first.time,
      'Last Activity': day.last.time,
      _timestamp: Date.UTC(y, m - 1, d, 12),
    };
  });
};

/** A fixed, content-free description of a failure (error messages can quote the input). */
const safeReason = (error) => (error && error.name ? error.name : 'error');

export default async function parseYouTubeFile(input, onProgress, options = {}) {
  const data = {};
  const parsingErrors = { sheetsNotFound: [], tablesNotParsed: [] };
  const gapMinutes = Number.isFinite(options.sessionGapMinutes) && options.sessionGapMinutes > 0
    ? options.sessionGapMinutes
    : DEFAULT_GAP_MINUTES;
  const files = (Array.isArray(input) ? input : [input]).filter(Boolean);

  // One history file per kind (watch / search) across ALL zips; JSON wins over HTML.
  const chosen = new Map();
  let opened = 0;
  for (let i = 0; i < files.length; i += 1) {
    let zip;
    try {
      zip = await openZip(files[i]);
      opened += 1;
    } catch (error) {
      parsingErrors.tablesNotParsed.push({
        sheetName: 'YouTube Export',
        reason: `Failed to open ZIP file ${i + 1}: ${error.message}`, // zipReader's own fixed messages
        expectedFormat: 'ZIP',
      });
      continue;
    }
    zip.entries.forEach((entry) => {
      const m = entry.name.match(HISTORY_RE);
      if (!m) return;
      const key = m[1].toLowerCase();
      const isJson = m[2].toLowerCase() === 'json';
      const previous = chosen.get(key);
      if (!previous || (isJson && !previous.isJson)) chosen.set(key, { zip, entry, isJson });
    });
  }
  if (opened === 0) return { data, parsingErrors };

  if (chosen.size === 0) {
    parsingErrors.sheetsNotFound.push('YouTube watch-history / search-history');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'YouTube history',
      reason: 'No watch-history or search-history file was found in the ZIP file.',
      expectedPath: 'Takeout/YouTube and YouTube Music/history/',
    });
    return { data, parsingErrors };
  }

  const collector = createCollector();
  const jobs = [...chosen.entries()];
  for (let i = 0; i < jobs.length; i += 1) {
    const [key, { zip, entry, isJson }] = jobs[i];
    const report = (fraction) => onProgress && onProgress((i + fraction) / jobs.length);
    try {
      if (isJson) await readJson(zip, entry, collector);
      else await readHtml(zip, entry, collector, report);
    } catch (error) {
      parsingErrors.tablesNotParsed.push({
        sheetName: `YouTube ${key} history`,
        reason: `Failed to read the ${isJson ? 'JSON' : 'HTML'} file (${safeReason(error)}).`,
        expectedFormat: isJson ? 'JSON' : 'HTML',
      });
    }
    report(1);
  }

  const { events, stats } = collector;
  stats.tzAssumed.forEach((count, tz) => {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'YouTube timestamps',
      reason: `${count} timestamp(s) used the time zone "${tz}", which is not recognised; they were read as UTC.`,
    });
  });
  if (stats.unparsable > 0) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'YouTube timestamps',
      reason: `${stats.unparsable} history entries had a timestamp that could not be read, so they were skipped `
        + '(the export may use a date format that is not supported yet).',
      expectedFormat: 'English-language Takeout export',
    });
  }
  if (stats.watch + stats.search === 0 && stats.other > 0) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'YouTube history',
      reason: `${stats.other} history entries were not recognised (the export may be in a language other than English).`,
      expectedFormat: 'English-language Takeout export',
    });
  }
  if (events.length === 0) return { data, parsingErrors };

  const sessionRows = buildSessionRows(events.filter((e) => e.kind === 'watch'), gapMinutes * 60000);
  data['YouTube - Viewing Sessions'] = sessionRows;
  data['YouTube - Daily Activity'] = buildDailyRows(events, sessionRows);
  return { data, parsingErrors };
}

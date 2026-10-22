import { openZip } from '../utils/zipReader';
import { dayTimestamp, localDay, getOrCreate } from '../utils/wearableFormat';

/**
 * Parser for an Instagram "Download your information" export (Accounts
 * Center → Your information and permissions → Download your information,
 * format JSON), uploaded as the .zip.
 *
 * Instagram exports hold other people's data (usernames, profile links,
 * message text, comments, captions), so this parser counts activity instead
 * of copying records, following data-donation practice (D3I / Port):
 *
 *   1. "Daily Activity"  — per local day: posts viewed, videos watched, ads
 *      viewed / clicked, posts / comments / stories liked, comments posted,
 *      posts saved, posts / stories / reels published, searches, accounts
 *      followed, new followers, messages sent and received.
 *   2. "Activity Totals" — each category's total, first and last date.
 *   3. "Topics"          — the interest topics Instagram inferred.
 *
 * Never emitted: any username, name, URL, comment or message text, caption,
 * media file, photo EXIF location, search term, login / IP / device record,
 * contact, or profile field. The participant's own name is read only to tell
 * sent from received messages.
 *
 * Handles every known layout (2020 `account_information/`… through the
 * current Accounts Center `your_instagram_activity/`, `media/` vs
 * `content/`), both record schemas (`string_list_data` / `string_map_data`
 * and the 2025+ `label_values` lists) and Meta's mojibake (UTF-8 bytes
 * written as \u00XX escapes).
 *
 * @param {File} file - Instagram export .zip
 * @param {(fraction: number) => void} [onProgress]
 */

// Category → file-name patterns (base name). Order = column order.
const CATEGORIES = [
  ['Posts Viewed', /^posts_viewed\.json$/i],
  ['Videos Watched', /^videos_watched\.json$/i],
  ['Ads Viewed', /^ads_viewed\.json$/i],
  ['Ads Clicked', /^ads_clicked\.json$/i],
  ['Posts Liked', /^liked_posts\.json$/i],
  ['Comments Liked', /^liked_comments\.json$/i],
  ['Stories Liked', /^story_likes\.json$/i],
  ['Comments Posted', /^(?:post_comments(?:_\d+)?|reels_comments)\.json$/i],
  ['Posts Saved', /^saved_posts\.json$/i],
  ['Posts Published', /^posts(?:_\d+)?\.json$/i],
  ['Stories Published', /^stories\.json$/i],
  ['Reels Published', /^reels\.json$/i],
  ['Searches', /^(?:profile_searches|account_searches|word_or_phrase_searches|keyword_searches|tag_searches)\.json$/i],
  ['Accounts Followed', /^following\.json$/i],
  ['New Followers', /^followers(?:_\d+)?\.json$/i],
];
const MESSAGE_RE = /(?:^|\/)messages\/(?:inbox|message_requests)\/[^/]+\/message_\d+\.json$/i;
const TOPICS_RE = /^(?:recommended_topics|your_topics)\.json$/i;
const PROFILE_RE = /^personal_information\.json$/i;
// Facebook exports share folder names; only Instagram trees are read.
const FACEBOOK_RE = /(?:^|\/)(?:activity|your_activity_across_facebook)\//i;

/**
 * Undo Meta's mojibake: strings whose UTF-8 bytes were written as separate
 * \u00XX code points ("ð\u009f\u0091\u008d" → "👍").
 * @param {string} s
 * @returns {string}
 */
export const fixMojibake = (s) => {
  if (typeof s !== 'string' || !/[\u0080-ÿ]/.test(s)) return s;
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 255) return s;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
  } catch (e) {
    return s;
  }
};

/** Records of an export file: a root list, or every list-valued property. */
const recordsOf = (json) => {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== 'object') return [];
  return Object.values(json).filter(Array.isArray).flat();
};

/**
 * First positive epoch-seconds timestamp found in a record, across schemas:
 * `timestamp`, `creation_timestamp`, `string_list_data[].timestamp`,
 * `string_map_data.<label>.timestamp`, `label_values[].timestamp_value`,
 * `media[].creation_timestamp`.
 * @param {Object} rec
 * @returns {number} epoch ms, or NaN
 */
export const recordTime = (rec) => {
  if (!rec || typeof rec !== 'object') return NaN;
  const pos = (v) => (typeof v === 'number' && v > 0 ? v : NaN);
  let t = pos(rec.timestamp);
  if (Number.isNaN(t)) t = pos(rec.creation_timestamp);
  if (Number.isNaN(t) && Array.isArray(rec.string_list_data)) {
    for (const d of rec.string_list_data) { t = pos(d && d.timestamp); if (!Number.isNaN(t)) break; }
  }
  if (Number.isNaN(t) && rec.string_map_data && typeof rec.string_map_data === 'object') {
    for (const d of Object.values(rec.string_map_data)) { t = pos(d && d.timestamp); if (!Number.isNaN(t)) break; }
  }
  if (Number.isNaN(t) && Array.isArray(rec.label_values)) {
    for (const d of rec.label_values) { t = pos(d && d.timestamp_value); if (!Number.isNaN(t)) break; }
  }
  if (Number.isNaN(t) && Array.isArray(rec.media)) {
    for (const m of rec.media) { t = pos(m && m.creation_timestamp); if (!Number.isNaN(t)) break; }
  }
  return Number.isNaN(t) ? NaN : t * 1000;
};

/** Local calendar day in the donor's browser time zone. */
const dayOfMs = (ms) => localDay(ms, -new Date(ms).getTimezoneOffset());

/** Profile Name / Username (only to recognise the participant's own messages). */
const ownNames = (json) => {
  const names = new Set();
  const add = (v) => { if (typeof v === 'string' && v.trim()) names.add(fixMojibake(v.trim())); };
  for (const rec of recordsOf(json)) {
    const smd = rec && rec.string_map_data;
    if (smd) for (const [k, v] of Object.entries(smd)) if (/^(name|naam|username|gebruikersnaam)$/i.test(k)) add(v && v.value);
    if (Array.isArray(rec && rec.label_values)) {
      for (const lv of rec.label_values) if (/^(name|naam|username|gebruikersnaam)$/i.test(lv.label || '')) add(lv.value);
    }
  }
  return names;
};

export default async function parseInstagramFile(file, onProgress) {
  const data = {};
  const parsingErrors = { sheetsNotFound: [], tablesNotParsed: [] };

  let zip;
  try {
    zip = await openZip(file);
  } catch (error) {
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Instagram Export', reason: `Failed to open the ZIP file: ${error.message}`, expectedFormat: 'ZIP',
    });
    return { data, parsingErrors };
  }

  const jobs = [];
  for (const e of zip.entries) {
    if (!/\.json$/i.test(e.name) || FACEBOOK_RE.test(e.name)) continue;
    const base = e.name.slice(e.name.lastIndexOf('/') + 1);
    if (MESSAGE_RE.test(e.name)) { jobs.push({ e, kind: 'message' }); continue; }
    if (TOPICS_RE.test(base)) { jobs.push({ e, kind: 'topics' }); continue; }
    if (PROFILE_RE.test(base)) { jobs.push({ e, kind: 'profile' }); continue; }
    // posts_1 / stories / reels only under media/ or content/ (not archived_posts etc.).
    const cat = CATEGORIES.find(([, re]) => re.test(base));
    if (!cat) continue;
    if (/^(Posts|Stories|Reels) Published$/.test(cat[0]) && !/(?:^|\/)(?:media|content)\//i.test(e.name)) continue;
    jobs.push({ e, kind: 'category', category: cat[0] });
  }

  if (jobs.length === 0 || !jobs.some((j) => j.kind !== 'profile')) {
    parsingErrors.sheetsNotFound.push('Instagram activity files');
    parsingErrors.tablesNotParsed.push({
      sheetName: 'Instagram Export',
      reason: 'No Instagram activity files were found. Was the export made in JSON format?',
      expectedPath: 'your_instagram_activity/… , ads_information/… , connections/…',
    });
    return { data, parsingErrors };
  }

  const days = new Map();
  const totals = new Map();
  const bump = (category, ms) => {
    // Out-of-range values (e.g. ms written where seconds belong) are skipped.
    const day = Number.isFinite(ms) ? dayOfMs(ms) : '';
    if (!day) return;
    const counts = getOrCreate(days, day, () => new Map());
    counts.set(category, (counts.get(category) || 0) + 1);
    const t = getOrCreate(totals, category, () => ({ count: 0, first: Infinity, last: -Infinity }));
    t.count += 1;
    t.first = Math.min(t.first, ms);
    t.last = Math.max(t.last, ms);
  };

  const topics = new Set();
  const names = new Set();
  const threads = []; // [{participants: string[], messages: [sender, ms][]}]

  const totalBytes = jobs.reduce((a, j) => a + j.e.compressedSize, 0) || 1;
  let done = 0;
  for (const job of jobs) {
    let json = null;
    try {
      // eslint-disable-next-line no-await-in-loop
      json = JSON.parse(await zip.readText(job.e));
    } catch (err) {
      parsingErrors.tablesNotParsed.push({ sheetName: job.category || job.kind, reason: 'Unreadable JSON file', expectedFormat: 'JSON' });
    }
    if (json) {
      if (job.kind === 'category') {
        for (const rec of recordsOf(json)) bump(job.category, recordTime(rec));
      } else if (job.kind === 'topics') {
        for (const rec of recordsOf(json)) {
          const smd = rec && rec.string_map_data;
          const v = smd && (smd.Name || smd.Naam || smd.Ad);
          const lv = Array.isArray(rec && rec.label_values) && rec.label_values.find((x) => /^(name|naam)$/i.test(x.label || ''));
          const name = (v && v.value) || (lv && lv.value);
          if (typeof name === 'string' && name.trim()) topics.add(fixMojibake(name.trim()));
        }
      } else if (job.kind === 'profile') {
        for (const n of ownNames(json)) names.add(n);
      } else if (job.kind === 'message') {
        const participants = (Array.isArray(json.participants) ? json.participants : [])
          .map((p) => fixMojibake(p && p.name)).filter(Boolean);
        const msgs = (Array.isArray(json.messages) ? json.messages : [])
          .map((m) => [fixMojibake(m && m.sender_name), Number(m && m.timestamp_ms)])
          .filter(([, ms]) => Number.isFinite(ms) && ms > 0);
        threads.push({ participants, messages: msgs });
      }
    }
    done += job.e.compressedSize;
    if (onProgress) onProgress(done / totalBytes);
  }

  // Own name: from the profile, else whoever takes part in the most threads.
  if (names.size === 0 && threads.length > 0) {
    const seen = new Map();
    for (const t of threads) for (const p of new Set(t.participants)) seen.set(p, (seen.get(p) || 0) + 1);
    let best = '';
    let bestN = 0;
    for (const [p, n] of seen) if (n > bestN) { best = p; bestN = n; }
    if (best) names.add(best);
  }
  for (const t of threads) {
    for (const [sender, ms] of t.messages) bump(names.has(sender) ? 'Messages Sent' : 'Messages Received', ms);
  }

  // ---- Daily Activity ------------------------------------------------------
  const columns = [...CATEGORIES.map(([c]) => c), 'Messages Sent', 'Messages Received']
    .filter((c) => totals.has(c));
  const dailyRows = Array.from(days.keys()).sort().map((date) => {
    const counts = days.get(date);
    const row = { Date: date };
    for (const c of columns) row[c] = String(counts.get(c) || 0);
    row._timestamp = dayTimestamp(date);
    return row;
  });
  if (dailyRows.length > 0) data['Daily Activity'] = dailyRows;
  else parsingErrors.sheetsNotFound.push('Daily activity');

  // ---- Activity Totals -----------------------------------------------------
  const totalRows = columns.map((c) => {
    const t = totals.get(c);
    return {
      Category: c,
      Count: String(t.count),
      'First Date': dayOfMs(t.first),
      'Last Date': dayOfMs(t.last),
    };
  });
  if (totalRows.length > 0) data['Activity Totals'] = totalRows;

  // ---- Topics ----------------------------------------------------------------
  const topicRows = Array.from(topics).sort((a, b) => a.localeCompare(b)).map((t) => ({ Topic: t }));
  if (topicRows.length > 0) data['Topics'] = topicRows;

  return { data, parsingErrors };
}

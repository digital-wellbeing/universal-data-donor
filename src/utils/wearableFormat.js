/**
 * Formatting helpers shared by the wearable parsers (Apple Health, Health
 * Connect, Fitbit, Samsung Health). Every helper returns '' for missing input
 * so "no data" stays visibly blank in the review tables.
 */

/**
 * Round to a fixed number of decimals.
 * @param {*} value
 * @param {number} decimals
 * @returns {string}
 */
export const fmtNum = (value, decimals = 0) => {
  if (value === null || value === undefined || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  if (decimals <= 0) return String(Math.round(n));
  const factor = 10 ** decimals;
  return String(Math.round(n * factor) / factor);
};

/**
 * Seconds → "1 hour 5 minutes".
 * @param {number} seconds
 * @returns {string}
 */
export const formatDuration = (seconds) => {
  const n = Number(seconds);
  if (!Number.isFinite(n)) return '';
  const total = Math.max(0, Math.round(n));
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
 * Epoch ms of noon on a YYYY-MM-DD day (the hidden `_timestamp` for day rows,
 * matching the other parsers' convention), or undefined.
 * @param {string} day
 * @returns {number|undefined}
 */
export const dayTimestamp = (day) => {
  const ts = Date.parse(`${day}T12:00:00`);
  return Number.isFinite(ts) ? ts : undefined;
};

/**
 * Epoch ms → "YYYY-MM-DD HH:MM" in a fixed offset (minutes east of UTC).
 * @param {number} epochMs
 * @param {number} offsetMinutes
 * @returns {string}
 */
export const formatLocal = (epochMs, offsetMinutes = 0) => {
  if (!Number.isFinite(epochMs)) return '';
  const d = new Date(epochMs + offsetMinutes * 60000);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 16).replace('T', ' ');
};

/**
 * Local calendar day (YYYY-MM-DD) of an instant in a fixed offset.
 * @param {number} epochMs
 * @param {number} offsetMinutes
 * @returns {string}
 */
export const localDay = (epochMs, offsetMinutes = 0) => {
  if (!Number.isFinite(epochMs)) return '';
  return new Date(epochMs + offsetMinutes * 60000).toISOString().slice(0, 10);
};

/**
 * The "sleep day" a sleep sample belongs to: the local date of start + 6 h,
 * so a night from 18:00 the previous evening to 18:00 counts as one date
 * (the morning you wake up). Naps before 18:00 join that day.
 * @param {number} startMs
 * @param {number} offsetMinutes
 * @returns {string}
 */
export const sleepDay = (startMs, offsetMinutes = 0) => localDay(startMs + 6 * 3600000, offsetMinutes);

/**
 * Drop a possessive owner prefix from a user-named device, e.g.
 * "Alex’s Apple Watch" → "Apple Watch", "Sam's Galaxy Watch5" → "Galaxy Watch5".
 * Device names default to "<first name>'s <model>", which identifies people.
 * @param {string} name
 * @returns {string}
 */
export const stripOwnerName = (name) => {
  if (typeof name !== 'string') return '';
  return name
    .replace(/^.*?['’‘`]s\s+/u, '')
    // "Galaxy Watch von Alex", "Montre de Marie", "Horloge van Jan"
    .replace(/\s+(?:von|de|du|des|da|di|del|van|der)\s+\S.*$/iu, '')
    .trim();
};

/**
 * "TRADITIONAL_STRENGTH_TRAINING" / "traditionalStrengthTraining" →
 * "Traditional Strength Training".
 * @param {string} value
 * @returns {string}
 */
export const humanize = (value) => {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};

/**
 * Running pooled mean / min / max.
 */
export class Stat {
  constructor() {
    this.n = 0;
    this.sum = 0;
    this.min = Infinity;
    this.max = -Infinity;
  }

  add(v) {
    if (!Number.isFinite(v)) return;
    this.n += 1;
    this.sum += v;
    if (v < this.min) this.min = v;
    if (v > this.max) this.max = v;
  }

  get mean() { return this.n > 0 ? this.sum / this.n : NaN; }

  get lo() { return this.n > 0 ? this.min : NaN; }

  get hi() { return this.n > 0 ? this.max : NaN; }
}

/**
 * Daily totals kept per source so overlapping writers (phone + watch both
 * counting steps) are not double counted: the day's value is the largest
 * single-source total, which approximates the platforms' own de-duplication.
 */
export class SourceTotals {
  constructor() {
    this.bySource = new Map();
  }

  add(source, v) {
    if (!Number.isFinite(v)) return;
    const prev = this.bySource.get(source);
    this.bySource.set(prev === undefined ? detach(source) : source, (prev || 0) + v);
  }

  /** @returns {{value: number, source: string}} */
  best() {
    let value = NaN;
    let source = '';
    for (const [s, v] of this.bySource) {
      if (!(v <= value)) { value = v; source = s; }
    }
    return { value, source };
  }
}

/**
 * Copy a string so it no longer references the buffer it was sliced from.
 * V8 substrings (slice, regex groups) keep their parent string alive; a
 * long-lived Map key cut from a 4 MB streamed chunk would otherwise pin the
 * whole chunk in memory.
 * @param {*} s
 * @returns {*}
 */
export const detach = (s) => (typeof s === 'string' && s.length > 0 ? JSON.parse(JSON.stringify(s)) : s);

/**
 * Get-or-create a value in a Map. New string keys are detached (see above).
 * @template K, V
 * @param {Map<K, V>} map
 * @param {K} key
 * @param {() => V} make
 * @returns {V}
 */
export const getOrCreate = (map, key, make) => {
  let v = map.get(key);
  if (v === undefined) {
    v = make();
    map.set(detach(key), v);
  }
  return v;
};

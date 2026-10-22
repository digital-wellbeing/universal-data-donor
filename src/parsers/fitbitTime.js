/**
 * Time handling for Fitbit / Google Health Takeout exports, whose files mix
 * three conventions:
 *
 *   - UTC instants: Global Export steps / distance / heart-rate minute stamps
 *     ("MM/DD/YY HH:MM:SS") and every `*_GoogleData` CSV timestamp ("…Z").
 *   - Naive local wall-clock: sleep JSON, exercise JSON, calories JSON.
 *   - Local calendar dates: daily series (resting HR, active minutes, and
 *     `…T00:00:00Z` rows in daily Google-data CSVs).
 *
 * UTC instants need the participant's offset to land on the right local day.
 * The export has no reliable profile time zone, so offsets are taken from
 * rows that carry one (sleep `start_utc_offset`, exercise `utc_offset`),
 * nearest in time, which follows DST changes and travel at night-level
 * resolution. Without any, the donor's browser time zone is used.
 */

/**
 * "01/25/25 13:00:07" → wall-clock epoch ms (interpreted as UTC).
 * @param {string} s
 * @returns {number} NaN when unparseable
 */
export const parseMdy = (s) => {
  const m = typeof s === 'string' && s.match(/^(\d{2})\/(\d{2})\/(\d{2,4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return NaN;
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  return Date.UTC(year, Number(m[1]) - 1, Number(m[2]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
};

/**
 * ISO timestamp → epoch ms. A zone-less value is read as wall-clock UTC,
 * so naive local times keep their digits. Also accepts the
 * "2025-12-03 21:12:30+0000" variant.
 * @param {string} s
 * @returns {number}
 */
export const parseIso = (s) => {
  if (typeof s !== 'string' || s.length < 10) return NaN;
  let v = s.trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v += 'T00:00:00';
  v = v.replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(v)) v += 'Z';
  return Date.parse(v);
};

/**
 * "+05:30" / "-0400" → minutes east of UTC, or NaN.
 * @param {string} s
 * @returns {number}
 */
export const parseOffset = (s) => {
  const m = typeof s === 'string' && s.trim().match(/^(?:UTC)?([+-])(\d{1,2}):?(\d{2})$/);
  if (!m) return NaN;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
};

/** Minutes → "+05:30". */
export const formatOffset = (minutes) => {
  if (!Number.isFinite(minutes)) return '';
  const sign = minutes < 0 ? '-' : '+';
  const a = Math.abs(minutes);
  return `${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};

/**
 * Builds offset lookups from observed (instant, offset) pairs.
 */
export class Localizer {
  constructor() {
    this.obs = [];
    this.sorted = true;
    this.dayCache = new Map();
  }

  /** Record that local offset `offsetMin` applied at UTC instant `ms`. */
  observe(ms, offsetMin) {
    if (!Number.isFinite(ms) || !Number.isFinite(offsetMin)) return;
    this.obs.push([ms, offsetMin]);
    this.sorted = false;
  }

  get hasObservations() { return this.obs.length > 0; }

  /** Offset (minutes east of UTC) at UTC instant `ms`. */
  offsetAt(ms) {
    if (this.obs.length === 0) return -new Date(ms).getTimezoneOffset();
    if (!this.sorted) {
      this.obs.sort((a, b) => a[0] - b[0]);
      this.sorted = true;
    }
    let lo = 0;
    let hi = this.obs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.obs[mid][0] < ms) lo = mid + 1;
      else hi = mid;
    }
    const after = this.obs[lo];
    const before = this.obs[Math.max(0, lo - 1)];
    return Math.abs(after[0] - ms) < Math.abs(ms - before[0]) ? after[1] : before[1];
  }

  /**
   * Local calendar day of a UTC instant. Cached per UTC quarter-hour: offsets
   * are multiples of 15 minutes, so local midnight never falls inside a
   * bucket and the cached day is exact.
   * @returns {{day: string, offset: number}}
   */
  localDayOf(ms) {
    const bucket = Math.floor(ms / 900000);
    let hit = this.dayCache.get(bucket);
    if (!hit) {
      const start = bucket * 900000;
      const offset = this.offsetAt(start);
      const d = new Date(start + offset * 60000);
      hit = { offset, day: isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10) };
      this.dayCache.set(bucket, hit);
    }
    return hit;
  }
}

/** Wall-clock ms (UTC-interpreted) → "YYYY-MM-DD HH:MM". */
const validDate = (ms) => {
  const d = Number.isFinite(ms) ? new Date(ms) : null;
  return d && !isNaN(d.getTime()) ? d : null;
};

export const formatWall = (wallMs) => {
  const d = validDate(wallMs);
  return d ? d.toISOString().slice(0, 16).replace('T', ' ') : '';
};

/** Wall-clock ms (UTC-interpreted) → "YYYY-MM-DD". */
export const wallDay = (wallMs) => {
  const d = validDate(wallMs);
  return d ? d.toISOString().slice(0, 10) : '';
};

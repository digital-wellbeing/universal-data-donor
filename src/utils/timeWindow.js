/**
 * Helpers for restricting donated rows to a recent time window
 * (e.g. "the last 6 months"). The window length is a parameter, never a
 * constant: pass `months` of 0 / null / Infinity to disable the cut-off.
 */

const MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Start (UTC midnight) of the window: `months` calendar months before `now`.
 * The day of month is clamped, so 31 Aug minus 6 months is 28/29 Feb rather
 * than spilling into March.
 *
 * @param {Date|number} now - Reference time (the moment of upload).
 * @param {number|null|undefined} months - Window length in whole months (fractions round to the
 *   nearest month, minimum 1); falsy, negative or non-finite disables the window.
 * @returns {number} Cut-off in epoch ms, or -Infinity when there is no window.
 */
export const windowCutoff = (now, months) => {
  if (!Number.isFinite(months) || months <= 0) return -Infinity;
  const ref = new Date(now);
  const day = ref.getUTCDate();
  const wholeMonths = Math.max(1, Math.round(months));
  const target = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - wholeMonths, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay));
};

/**
 * Extract the calendar date from the loose formats Google exports use
 * ("2025-01-03", "Jan 3, 2025", "3 Jan 2025", "October 16, 2015 at 07:13:22 AM UTC").
 * Deliberately avoids `Date.parse` on free text, which differs between
 * browsers.
 *
 * @param {*} value
 * @returns {number|null} UTC midnight of that date in epoch ms, or null.
 */
export const parseLooseDate = (value) => {
  if (typeof value !== 'string') return null;
  const iso = value.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return Date.UTC(+iso[1], +iso[2] - 1, +iso[3]);
  const monthFirst = value.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (monthFirst) {
    const month = MONTH_INDEX[monthFirst[1].slice(0, 3).toLowerCase()];
    if (month !== undefined) return Date.UTC(+monthFirst[3], month, +monthFirst[2]);
  }
  const dayFirst = value.match(/(\d{1,2})\.?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/);
  if (dayFirst) {
    const month = MONTH_INDEX[dayFirst[2].slice(0, 3).toLowerCase()];
    if (month !== undefined) return Date.UTC(+dayFirst[3], month, +dayFirst[1]);
  }
  return null;
};

/**
 * Split rows into those inside the window and a count of those removed.
 * Rows whose timestamp cannot be determined are counted in `undated`; by
 * default they are kept, but a caller that promises "nothing older than the
 * window leaves your computer" passes `keepUndated: false` so a row of unknown
 * age is removed too. With no window (cutoff -Infinity) nothing is removed.
 *
 * @param {Object[]} rows
 * @param {(row: Object) => (number|null)} getTimestamp - Epoch ms of a row.
 * @param {number} cutoff - From {@link windowCutoff}.
 * @param {{keepUndated?: boolean}} [options]
 * @returns {{kept: Object[], dropped: number, undated: number}} `dropped` counts every removed row.
 */
export const applyWindow = (rows, getTimestamp, cutoff, { keepUndated = true } = {}) => {
  const kept = [];
  let dropped = 0;
  let undated = 0;
  const enforce = cutoff !== -Infinity;
  for (const row of rows) {
    const ts = getTimestamp(row);
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      undated += 1;
      if (keepUndated || !enforce) kept.push(row);
      else dropped += 1;
    } else if (ts >= cutoff) {
      kept.push(row);
    } else {
      dropped += 1;
    }
  }
  return { kept, dropped, undated };
};

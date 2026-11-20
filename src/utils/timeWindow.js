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
 * @param {number|null|undefined} months - Window length; falsy or non-finite disables the window.
 * @returns {number} Cut-off in epoch ms, or -Infinity when there is no window.
 */
export const windowCutoff = (now, months) => {
  if (!Number.isFinite(months) || months <= 0) return -Infinity;
  const ref = new Date(now);
  const day = ref.getUTCDate();
  const target = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth() - Math.floor(months), 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay));
};

/**
 * Extract the calendar date from the loose formats Google exports use
 * ("2025-01-03", "Jan 3, 2025", "October 16, 2015 at 07:13:22 AM UTC").
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
  const named = value.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (named) {
    const month = MONTH_INDEX[named[1].slice(0, 3).toLowerCase()];
    if (month !== undefined) return Date.UTC(+named[3], month, +named[2]);
  }
  return null;
};

/**
 * Split rows into those inside the window and a count of those outside it.
 * Rows whose timestamp cannot be determined are kept (never silently
 * dropped) and counted separately.
 *
 * @param {Object[]} rows
 * @param {(row: Object) => (number|null)} getTimestamp - Epoch ms of a row.
 * @param {number} cutoff - From {@link windowCutoff}.
 * @returns {{kept: Object[], dropped: number, undated: number}}
 */
export const applyWindow = (rows, getTimestamp, cutoff) => {
  const kept = [];
  let dropped = 0;
  let undated = 0;
  for (const row of rows) {
    const ts = getTimestamp(row);
    if (typeof ts !== 'number' || !Number.isFinite(ts)) {
      undated += 1;
      kept.push(row);
    } else if (ts >= cutoff) {
      kept.push(row);
    } else {
      dropped += 1;
    }
  }
  return { kept, dropped, undated };
};

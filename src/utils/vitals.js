/**
 * Fields that describe the heart, breathing, blood or body measurements. A study that sets
 * `parserOptions.excludeVitals` never donates them. "Heart Points" and "Heart Minutes" are
 * Google's activity-intensity scores, not heart measurements, so they are kept.
 */
export const VITAL_FIELD = /heart[ ._]rate|\bhrv?\b|\bbpm\b|brpm|oxygen|spo2|respirat|breath|blood|glucose|temperature|\bweight \(|height|body|nutrition|hydration/i;

/** A copy of a review-table row without its vital-sign fields. */
export const withoutVitals = (row) => Object.fromEntries(
  Object.entries(row).filter(([key]) => !VITAL_FIELD.test(key)),
);

/**
 * Validates the merged result of the Google Takeout parser.
 * Valid when at least one table holds rows. When nothing survived because the
 * export only contains data older than the donation window, say so.
 *
 * @param {Object} parseResult - Result from googleTakeoutParser
 * @returns {{valid: boolean, reason?: string}}
 */
export default function validateGoogleTakeoutData(parseResult) {
  const { data, metadata } = parseResult || {};

  if (data) {
    for (const tableName in data) {
      if (Array.isArray(data[tableName]) && data[tableName].length > 0) {
        return { valid: true };
      }
    }
  }

  const window = metadata && metadata.window;
  if (window && window.totalDropped > 0) {
    return {
      valid: false,
      reason: `Your export contains data, but none from the last ${window.months} months`,
    };
  }

  return {
    valid: false,
    reason: 'No Google Fit, Google Health, Play Games or YouTube data found in the uploaded Takeout export',
  };
}

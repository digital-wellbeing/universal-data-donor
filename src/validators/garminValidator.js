/**
 * Validates Garmin data from the parser.
 * Ensures the uploaded Garmin export ZIP produced at least one table with rows.
 *
 * @param {Object} parseResult - Result from garminParser
 * @param {Object} parseResult.data - Parsed data organized by table name
 * @param {Object} parseResult.parsingErrors - Parsing errors encountered
 * @returns {Object} Validation result: { valid: boolean, reason?: string }
 */
export default function validateGarminData(parseResult) {
  const { data } = parseResult || {};

  if (!data) {
    return {
      valid: false,
      reason: 'No data found in the file',
    };
  }

  // Valid if at least one table (Daily Wellness / VO2max / Sleep / Activities / Devices) has rows.
  for (const tableName in data) {
    if (Array.isArray(data[tableName]) && data[tableName].length > 0) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    reason: 'No Garmin health data found in the uploaded export',
  };
}

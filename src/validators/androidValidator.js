/**
 * Validates Google Play Games Services data from parser
 * Ensures the uploaded file contains usable playtime data
 *
 * @param {Object} parseResult - Result from androidParser
 * @param {Object} parseResult.data - Parsed data organized by table name
 * @param {Object} parseResult.parsingErrors - Parsing errors encountered
 * @returns {Object} Validation result: { valid: boolean, reason?: string }
 */
export default function validateAndroidData(parseResult) {
  const { data } = parseResult || {};

  // Check if data exists
  if (!data) {
    return {
      valid: false,
      reason: 'No data found in the file'
    };
  }

  // Check if at least one table has data
  for (const tableName in data) {
    if (Array.isArray(data[tableName]) && data[tableName].length > 0) {
      return { valid: true };
    }
  }

  // No tables with data found
  return {
    valid: false,
    reason: 'No playtime or game activity data found in the file'
  };
}

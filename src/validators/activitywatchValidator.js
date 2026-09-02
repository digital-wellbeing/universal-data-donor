/**
 * Validates ActivityWatch data from the parser.
 * Ensures the uploaded file produced at least one bucket table with events.
 *
 * @param {Object} parseResult - Result from activitywatchParser
 * @param {Object} parseResult.data - Parsed data organized by table name
 * @param {Object} parseResult.parsingErrors - Parsing errors encountered
 * @returns {Object} Validation result: { valid: boolean, reason?: string }
 */
export default function validateActivityWatchData(parseResult) {
  const { data } = parseResult || {};

  if (!data) {
    return {
      valid: false,
      reason: 'No data found in the file',
    };
  }

  // Valid if at least one bucket table has data.
  for (const tableName in data) {
    if (Array.isArray(data[tableName]) && data[tableName].length > 0) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    reason: 'No ActivityWatch event data found in the file',
  };
}

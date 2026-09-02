/**
 * Validates Google Fit data from the parser.
 * Ensures the uploaded Takeout ZIP produced at least one table with rows.
 *
 * @param {Object} parseResult - Result from googlefitParser
 * @param {Object} parseResult.data - Parsed data organized by table name
 * @param {Object} parseResult.parsingErrors - Parsing errors encountered
 * @returns {Object} Validation result: { valid: boolean, reason?: string }
 */
export default function validateGoogleFitData(parseResult) {
  const { data } = parseResult || {};

  if (!data) {
    return {
      valid: false,
      reason: 'No data found in the file',
    };
  }

  // Valid if at least one table (Daily Activity / Activity Sessions) has rows.
  for (const tableName in data) {
    if (Array.isArray(data[tableName]) && data[tableName].length > 0) {
      return { valid: true };
    }
  }

  return {
    valid: false,
    reason: 'No Google Fit data found in the uploaded Takeout export',
  };
}

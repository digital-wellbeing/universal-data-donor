/**
 * Build a validator that accepts a parse result when at least one table has
 * rows. Shared by the wearable / social-media parsers whose tables are all
 * optional on their own.
 *
 * @param {string} emptyReason - Message shown when no table has rows
 * @returns {(parseResult: Object) => {valid: boolean, reason?: string}}
 */
export default function createTableValidator(emptyReason) {
  return (parseResult) => {
    const { data } = parseResult || {};
    if (!data) return { valid: false, reason: 'No data found in the file' };
    for (const tableName in data) {
      if (Array.isArray(data[tableName]) && data[tableName].length > 0) return { valid: true };
    }
    return { valid: false, reason: emptyReason };
  };
}

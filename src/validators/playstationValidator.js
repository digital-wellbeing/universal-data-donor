export default function validatePlaystationData(parseResult) {
  const { data } = parseResult || {};
  if (!data) {
    return { valid: false, reason: 'No data' };
  }
  for (const sheetName in data) {
    if (Array.isArray(data[sheetName]) && data[sheetName].length > 0) {
      return { valid: true };
    }
  }
  return { valid: false, reason: 'No sheets with data' };
}

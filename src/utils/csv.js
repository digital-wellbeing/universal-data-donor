/**
 * Small RFC 4180 CSV reader shared by the CSV-based export parsers (Fitbit /
 * Google Health Takeout, Samsung Health).
 *
 * Handles a UTF-8 BOM, quoted fields with embedded commas, quotes and
 * newlines, and \r\n, \n or bare \r line endings. Rows are delivered through
 * a callback so large files never become one big array of arrays.
 */

/**
 * Call `onRow(fields, index)` for every row of `text`.
 * @param {string} text
 * @param {(fields: string[], index: number) => (void|false)} onRow - return false to stop
 * @param {string} [delimiter=',']
 */
export function forEachCsvRow(text, onRow, delimiter = ',') {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  const d = delimiter.charCodeAt(0);
  let row = [];
  let index = 0;

  while (i <= n) {
    if (i === n) {
      // End of input: flush a final row without a trailing newline.
      if (row.length > 0) onRow(row, index);
      break;
    }
    let field;
    if (text.charCodeAt(i) === 34 /* " */) {
      let j = i + 1;
      let out = '';
      for (;;) {
        const q = text.indexOf('"', j);
        if (q === -1) { out += text.slice(j); j = n; break; }
        out += text.slice(j, q);
        if (text.charCodeAt(q + 1) === 34) { out += '"'; j = q + 2; continue; }
        j = q + 1;
        break;
      }
      field = out;
      i = j;
      // Skip anything between the closing quote and the next separator.
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === d || c === 10 || c === 13) break;
        i++;
      }
    } else {
      let j = i;
      while (j < n) {
        const c = text.charCodeAt(j);
        if (c === d || c === 10 || c === 13) break;
        j++;
      }
      field = text.slice(i, j);
      i = j;
    }
    row.push(field);

    if (i >= n) continue;
    const c = text.charCodeAt(i);
    if (c === d) {
      i++;
      if (i === n) row.push('');
      continue;
    }
    // Line break (\r\n, \n or \r).
    i += c === 13 && text.charCodeAt(i + 1) === 10 ? 2 : 1;
    if (!(row.length === 1 && row[0] === '')) {
      if (onRow(row, index) === false) return;
      index++;
    }
    row = [];
  }
}

/**
 * Iterate a headed CSV as objects keyed by header name. Extra trailing fields
 * (e.g. Samsung's trailing comma) are ignored.
 * @param {string} text
 * @param {(row: Object, header: string[]) => (void|false)} onRecord
 * @param {{skipLines?: number, delimiter?: string}} [opts]
 */
export function forEachCsvRecord(text, onRecord, opts = {}) {
  const skip = opts.skipLines || 0;
  let header = null;
  forEachCsvRow(text, (fields, index) => {
    if (index < skip) return undefined;
    if (!header) {
      header = fields.map((h) => h.trim());
      return undefined;
    }
    const rec = {};
    for (let k = 0; k < header.length; k++) rec[header[k]] = k < fields.length ? fields[k] : '';
    return onRecord(rec, header);
  }, opts.delimiter);
}

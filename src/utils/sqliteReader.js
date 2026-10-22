/**
 * Minimal read-only SQLite 3 file reader (pure JS, no WASM).
 *
 * Used for the Android Health Connect export, a plain SQLite database inside
 * a zip. A WASM engine (sql.js) would need `'wasm-unsafe-eval'` in the site
 * CSP; this reader walks table b-trees directly instead. It supports what a
 * read-out needs: rowid tables, overflow pages, all record serial types,
 * UTF-8/UTF-16 text and INTEGER PRIMARY KEY rowid aliases. WITHOUT ROWID
 * tables and indexes are not read.
 *
 * File format reference: https://www.sqlite.org/fileformat2.html
 */

const HEADER = 'SQLite format 3\u0000';

/**
 * Split a CREATE TABLE statement into column names, flagging the rowid alias.
 * @param {string} sql
 * @returns {{columns: string[], rowidColumn: number, withoutRowid: boolean}}
 */
export const parseCreateTable = (sql) => {
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close < open) return { columns: [], rowidColumn: -1, withoutRowid: false };
  const body = sql.slice(open + 1, close);

  // Split on commas at parenthesis depth 0, ignoring quoted text.
  const defs = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of body) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`' || ch === '[') {
      quote = ch === '[' ? ']' : ch;
    } else if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      defs.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) defs.push(cur.trim());

  const columns = [];
  let rowidColumn = -1;
  for (const def of defs) {
    if (/^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|CHECK|FOREIGN\s+KEY)\b/i.test(def)) continue;
    const m = def.match(/^(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\S+))\s*(.*)$/s);
    if (!m) continue;
    const name = m[1] || m[2] || m[3] || m[4];
    const rest = m[5] || '';
    if (/^INTEGER\b/i.test(rest) && /\bPRIMARY\s+KEY\b/i.test(rest) && !/\bPRIMARY\s+KEY\s+DESC\b/i.test(rest)) {
      rowidColumn = columns.length;
    }
    columns.push(name);
  }
  return {
    columns,
    rowidColumn,
    withoutRowid: /\)\s*WITHOUT\s+ROWID\s*;?\s*$/i.test(sql),
  };
};

/**
 * Open a SQLite database held in memory.
 * @param {Uint8Array} bytes
 * @returns {{tableNames: () => string[], columns: (t: string) => string[], rows: (t: string) => Generator<Object>, hasTable: (t: string) => boolean}}
 */
export function openDatabase(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 100) {
    throw new Error('Not a SQLite database (file too small)');
  }
  const magic = String.fromCharCode(...bytes.subarray(0, 16));
  if (magic !== HEADER) throw new Error('Not a SQLite database (bad header)');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawPageSize = view.getUint16(16, false);
  const pageSize = rawPageSize === 1 ? 65536 : rawPageSize;
  const usable = pageSize - bytes[20];
  const encoding = view.getUint32(56, false);
  const textDecoder = new TextDecoder(
    encoding === 2 ? 'utf-16le' : encoding === 3 ? 'utf-16be' : 'utf-8',
  );

  const pageOffset = (page) => (page - 1) * pageSize;

  /** Read a varint at `pos`; returns [value, nextPos]. */
  const varint = (pos) => {
    let value = 0;
    for (let i = 0; i < 8; i++) {
      const b = bytes[pos + i];
      value = value * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return [value, pos + i + 1];
    }
    return [value * 256 + bytes[pos + 8], pos + 9];
  };

  /** Assemble a cell's full payload, following overflow pages if needed. */
  const payloadOf = (pos, payloadSize) => {
    const maxLocal = usable - 35;
    if (payloadSize <= maxLocal) return bytes.subarray(pos, pos + payloadSize);
    const minLocal = Math.floor(((usable - 12) * 32) / 255) - 23;
    const k = minLocal + ((payloadSize - minLocal) % (usable - 4));
    const local = k <= maxLocal ? k : minLocal;

    const out = new Uint8Array(payloadSize);
    out.set(bytes.subarray(pos, pos + local), 0);
    let filled = local;
    let next = view.getUint32(pos + local, false);
    while (next !== 0 && filled < payloadSize) {
      const base = pageOffset(next);
      const take = Math.min(usable - 4, payloadSize - filled);
      out.set(bytes.subarray(base + 4, base + 4 + take), filled);
      filled += take;
      next = view.getUint32(base, false);
    }
    return out;
  };

  /** Decode a record payload into an array of column values. */
  const decodeRecord = (payload) => {
    const pv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
    const pVarint = (pos) => {
      let value = 0;
      for (let i = 0; i < 8; i++) {
        const b = payload[pos + i];
        value = value * 128 + (b & 0x7f);
        if ((b & 0x80) === 0) return [value, pos + i + 1];
      }
      return [value * 256 + payload[pos + 8], pos + 9];
    };
    const [headerSize, afterSize] = pVarint(0);
    const types = [];
    for (let h = afterSize; h < headerSize;) {
      const [t, nh] = pVarint(h);
      types.push(t);
      h = nh;
    }
    const values = [];
    let d = headerSize;
    for (const t of types) {
      if (t === 0) values.push(null);
      else if (t >= 1 && t <= 6) {
        const n = [0, 1, 2, 3, 4, 6, 8][t];
        let v;
        if (n === 8) {
          const big = pv.getBigInt64(d, false);
          const asNum = Number(big);
          v = Number.isSafeInteger(asNum) ? asNum : big;
        } else {
          v = 0;
          for (let i = 0; i < n; i++) v = v * 256 + payload[d + i];
          const limit = 2 ** (8 * n - 1);
          if (v >= limit) v -= 2 * limit;
        }
        values.push(v);
        d += n;
      } else if (t === 7) {
        values.push(pv.getFloat64(d, false));
        d += 8;
      } else if (t === 8) values.push(0);
      else if (t === 9) values.push(1);
      else if (t >= 12) {
        const len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2;
        const slice = payload.subarray(d, d + len);
        values.push(t % 2 === 0 ? slice.slice() : textDecoder.decode(slice));
        d += len;
      } else values.push(null);
    }
    return values;
  };

  /** Yield [rowid, values[]] for every row of the table b-tree at `rootPage`. */
  function* walkTable(rootPage) {
    const stack = [rootPage];
    const seen = new Set();
    while (stack.length > 0) {
      const page = stack.pop();
      if (seen.has(page)) continue; // corrupt-file guard against cycles
      seen.add(page);
      const base = pageOffset(page);
      const hdr = page === 1 ? base + 100 : base;
      const type = bytes[hdr];
      const cellCount = view.getUint16(hdr + 3, false);

      if (type === 0x0d) {
        for (let i = 0; i < cellCount; i++) {
          const cellPos = base + view.getUint16(hdr + 8 + i * 2, false);
          const [payloadSize, p1] = varint(cellPos);
          const [rowid, p2] = varint(p1);
          yield [rowid, decodeRecord(payloadOf(p2, payloadSize))];
        }
      } else if (type === 0x05) {
        // Push children right-to-left so rows come out in rowid order.
        stack.push(view.getUint32(hdr + 8, false));
        for (let i = cellCount - 1; i >= 0; i--) {
          const cellPos = base + view.getUint16(hdr + 12 + i * 2, false);
          stack.push(view.getUint32(cellPos, false));
        }
      } else {
        throw new Error(`Unexpected b-tree page type ${type} on page ${page}`);
      }
    }
  }

  // sqlite_master: type, name, tbl_name, rootpage, sql
  const tables = new Map();
  for (const [, v] of walkTable(1)) {
    if (v[0] !== 'table' || typeof v[4] !== 'string') continue;
    tables.set(v[1], { rootPage: v[3], ...parseCreateTable(v[4]) });
  }

  const hasTable = (name) => tables.has(name) && !tables.get(name).withoutRowid;

  return {
    tableNames: () => Array.from(tables.keys()),
    hasTable,
    columns: (name) => (tables.has(name) ? tables.get(name).columns.slice() : []),
    /**
     * Iterate a table's rows as {column: value} objects.
     * @param {string} name
     */
    *rows(name) {
      if (!hasTable(name)) return;
      const { rootPage, columns, rowidColumn } = tables.get(name);
      for (const [rowid, values] of walkTable(rootPage)) {
        const row = {};
        for (let i = 0; i < columns.length; i++) {
          row[columns[i]] = i < values.length ? values[i] : null;
        }
        if (rowidColumn >= 0) row[columns[rowidColumn]] = rowid;
        yield row;
      }
    },
  };
}

import fs from 'fs';
import path from 'path';
import { openDatabase, parseCreateTable } from './sqliteReader';

// Fixture built by scripts/fixtures/make_sqlite_fixture.py (synthetic data).
const loadFixture = () =>
  new Uint8Array(fs.readFileSync(path.join(__dirname, '__fixtures__', 'sample.sqlite')));

describe('parseCreateTable', () => {
  test('extracts columns, skips table constraints, finds the rowid alias', () => {
    const res = parseCreateTable(
      'CREATE TABLE t (row_id INTEGER PRIMARY KEY AUTOINCREMENT, uuid BLOB, '
      + 'x REAL DEFAULT (1.0), "odd, name" TEXT, UNIQUE(uuid), FOREIGN KEY (x) REFERENCES y(z))',
    );
    expect(res.columns).toEqual(['row_id', 'uuid', 'x', 'odd, name']);
    expect(res.rowidColumn).toBe(0);
    expect(res.withoutRowid).toBe(false);
    expect(res.virtual.size).toBe(0);
  });

  test('flags virtual generated columns', () => {
    const res = parseCreateTable('CREATE TABLE t (a INTEGER, b INTEGER AS (a * 2), c INTEGER AS (a) STORED, d TEXT)');
    expect(Array.from(res.virtual)).toEqual([1]);
  });

  test('no alias when the primary key is not INTEGER', () => {
    expect(parseCreateTable('CREATE TABLE t (id TEXT PRIMARY KEY, v)').rowidColumn).toBe(-1);
  });
});

describe('openDatabase', () => {
  test('rejects non-SQLite input', () => {
    expect(() => openDatabase(new Uint8Array(200))).toThrow(/Not a SQLite database/);
  });

  test('lists tables and columns', () => {
    const db = openDatabase(loadFixture());
    expect(db.tableNames()).toEqual(expect.arrayContaining(['t', 'quoted name', 'later']));
    expect(db.columns('t')).toEqual(['row_id', 'name', 'n', 'big', 'x', 'b', 'note']);
    expect(db.hasTable('missing')).toBe(false);
  });

  test('reads every row across interior pages in rowid order', () => {
    const db = openDatabase(loadFixture());
    const rows = Array.from(db.rows('t'));
    expect(rows).toHaveLength(500);
    expect(rows.map((r) => r.row_id)).toEqual(Array.from({ length: 500 }, (_, i) => i + 1));

    const r7 = rows[6];
    expect(r7.name).toBe('row7');
    expect(r7.n).toBe(-7);
    expect(r7.big).toBe(1700000000007);
    expect(r7.x).toBeCloseTo(1.75);
    expect(Array.from(r7.b)).toEqual([7, 1, 2]);
    expect(r7.note).toBeNull();
  });

  test('follows overflow chains and decodes UTF-8', () => {
    const db = openDatabase(loadFixture());
    const row = Array.from(db.rows('t')).find((r) => r.row_id === 250);
    expect(row.note).toHaveLength(5004);
    expect(row.note.startsWith('éx')).toBe(true);
    expect(row.note.endsWith('xend')).toBe(true);
  });

  test('handles quoted identifiers and columns added by ALTER TABLE', () => {
    const db = openDatabase(loadFixture());
    expect(Array.from(db.rows('quoted name'))).toEqual([{ 'a b': 'hello', c: 0 }]);
    expect(Array.from(db.rows('later'))).toEqual([
      { id: 1, v: 'before alter', gen: null, extra: null },
      { id: 2, v: 'after alter', gen: null, extra: 'x' }, // virtual column not stored
    ]);
  });
});

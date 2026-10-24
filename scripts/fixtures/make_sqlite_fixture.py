"""Build the synthetic SQLite fixture used by src/utils/sqliteReader.test.js.

Run: python3 scripts/fixtures/make_sqlite_fixture.py
Small pages (1 KiB) force interior b-tree pages and overflow chains.
"""
import os
import sqlite3
import sys

out = os.path.join(os.path.dirname(__file__), "..", "..", "src", "utils", "__fixtures__", "sample.sqlite")
out = os.path.abspath(out)
if os.path.exists(out):
    os.remove(out)

con = sqlite3.connect(out)
con.execute("PRAGMA page_size = 1024")
con.execute("PRAGMA journal_mode = DELETE")
con.execute(
    "CREATE TABLE t (row_id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, "
    "n INTEGER, big INTEGER, x REAL, b BLOB, note TEXT, UNIQUE(name))"
)
rows = []
for i in range(1, 501):
    rows.append((f"row{i}", i * (-1 if i % 7 == 0 else 1), 1_700_000_000_000 + i,
                 i / 4, bytes([i % 256, 1, 2]), None))
con.executemany("INSERT INTO t (name, n, big, x, b, note) VALUES (?,?,?,?,?,?)", rows)
# One row whose payload spills across several overflow pages.
con.execute("UPDATE t SET note = ? WHERE row_id = 250", ("é" + "x" * 5000 + "end",))
con.execute('CREATE TABLE "quoted name" ("a b" TEXT, c INTEGER)')
con.execute('INSERT INTO "quoted name" VALUES (?, ?)', ("hello", 0))
con.execute("CREATE TABLE later (id INTEGER PRIMARY KEY, v TEXT)")
con.execute("INSERT INTO later (v) VALUES ('before alter')")
con.execute("ALTER TABLE later ADD COLUMN gen INTEGER AS (id * 2)")
con.execute("ALTER TABLE later ADD COLUMN extra TEXT")
con.execute("ALTER TABLE later ADD COLUMN flag INTEGER DEFAULT 42")
con.execute("ALTER TABLE later ADD COLUMN label TEXT DEFAULT 'it''s'")
con.execute("INSERT INTO later (v, extra) VALUES ('after alter', 'x')")
con.commit()
con.close()
print(out, os.path.getsize(out), file=sys.stderr)

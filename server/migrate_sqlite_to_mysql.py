"""Copy donations from the SQLite store into MySQL (one-off and idempotent).

    python migrate_sqlite_to_mysql.py [--sqlite PATH] [--dry-run]

Reads the same MYSQL_* settings as the API (see app.py) and DONATION_DB for the source. It
refuses to run if ANY source row holds an unencrypted payload (the MySQL server is shared
and must only hold ciphertext): encrypt those first with `python donation_crypto.py
encrypt-existing`. A row already in MySQL (same submission id) is skipped, so re-running
is safe. Each copied row is read back from MySQL and compared with the source. Payload
contents are never printed.

In the running container (its filesystem is read-only; this only reads the volume):
    docker exec datadonation-api python migrate_sqlite_to_mysql.py --dry-run
    docker exec datadonation-api python migrate_sqlite_to_mysql.py
"""

import argparse
import os
import sqlite3
import sys

from storage import (
    SEALED_PREFIX,
    DuplicateSubmission,
    StorageError,
    mysql_store_from_env,
)

COLUMNS = ("submission_id", "platform", "received_at", "ip_hash", "user_agent",
           "total_tables", "total_rows", "payload")


def read_source(path):
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return conn.execute(f"SELECT {', '.join(COLUMNS)} FROM donations ORDER BY id").fetchall()
    finally:
        conn.close()


def migrate(rows, store, dry_run=False, out=print):
    """Copy `rows` into `store`. Returns the process exit code (0 ok, 2 refused, 3 verification failed)."""
    plaintext = [r[0] for r in rows if not str(r[-1]).startswith(SEALED_PREFIX)]
    if plaintext:
        out(f"ABORT: {len(plaintext)} of {len(rows)} source row(s) hold an unencrypted payload "
            f"(submission ids: {', '.join(plaintext)}). Encrypt them first with "
            "`python donation_crypto.py encrypt-existing`. Nothing was copied.")
        return 2
    copied = skipped = 0
    for row in rows:
        record = dict(zip(COLUMNS, row))
        if dry_run:
            out(f"would copy {record['submission_id']} ({record['platform']}, {len(record['payload'])} chars)")
            copied += 1
            continue
        try:
            store.add(**record)
        except DuplicateSubmission:
            skipped += 1
            continue
        if store.fetch_payload(record["submission_id"]) != record["payload"]:
            out(f"VERIFICATION FAILED for {record['submission_id']}: the stored payload differs from the source.")
            return 3
        copied += 1
    verb = "would copy" if dry_run else "copied"
    out(f"{verb} {copied}, already present (skipped) {skipped}, of {len(rows)} source row(s).")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--sqlite", default=os.environ.get("DONATION_DB", "donations.sqlite"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    try:
        store = mysql_store_from_env(os.environ)
        return migrate(read_source(args.sqlite), store, dry_run=args.dry_run)
    except (ValueError, OSError, sqlite3.Error, StorageError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())

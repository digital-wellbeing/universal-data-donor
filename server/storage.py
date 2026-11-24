"""Donation storage backends: SQLite (default) and MySQL (opt-in).

Both expose the same small interface so app.py does not care where a donation lands:

    store.name                      "sqlite" | "mysql"
    store.add(**fields) -> int      insert one donation atomically; returns its row id
                                    raises DuplicateSubmission / StorageError
    store.ping()                    raises when the store cannot take donations

The rate limiter keeps its own small SQLite table in app.py: it is ephemeral, needs no
sharing, and keeps working if the MySQL server is briefly unreachable.
"""

import contextlib
import datetime
import sqlite3
import ssl

CHUNK_CHARS = 4 * 1024 * 1024  # stays far below a managed server's default max_allowed_packet
SEALED_PREFIX = "enc:v1:"
DONATIONS_TABLE = "datadonation_donations"
CHUNKS_TABLE = "datadonation_payload_chunks"
MYSQL_DUPLICATE_ERRNO = 1062


class DuplicateSubmission(Exception):
    """A donation with this submission id is already stored."""


class StorageError(Exception):
    """The store could not take the donation (unreachable, refused, rolled back)."""


class SqliteStore:
    """The original store: a local SQLite file, shared with app.py's connection helper."""

    name = "sqlite"

    def __init__(self, connect, lock):
        self._connect = connect
        self._lock = lock

    def add(self, *, submission_id, platform, received_at, ip_hash, user_agent,
            total_tables, total_rows, payload):
        try:
            with self._lock, self._connect() as c:
                # A submission id is the participant's handle for withdrawal: never let a
                # second package overwrite or shadow an existing one.
                if c.execute("SELECT 1 FROM donations WHERE submission_id = ?", (submission_id,)).fetchone():
                    raise DuplicateSubmission(submission_id)
                cur = c.execute(
                    """
                    INSERT INTO donations
                        (submission_id, platform, received_at, ip_hash, user_agent,
                         total_tables, total_rows, payload)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (submission_id, platform, received_at, ip_hash, user_agent,
                     total_tables, total_rows, payload),
                )
                return cur.lastrowid
        except sqlite3.Error as exc:
            raise StorageError(str(exc)) from exc

    def ping(self):
        return True


def ssl_argument(mode, ca_file=None):
    """The PyMySQL `ssl` argument for a mode (or None for "off").

    off          no TLS (tests and local development only)
    required     encrypted, server certificate NOT verified (what `--ssl-mode=REQUIRED` does)
    verify-ca    encrypted, certificate chain verified against `ca_file` or the system store
    verify-full  as verify-ca, and the certificate must also match the host name used
    """
    if mode == "off":
        return None
    if mode == "required":
        return {"ca": None}  # a non-empty dict turns TLS on; no CA means no verification
    if mode in ("verify-ca", "verify-full"):
        context = ssl.create_default_context(cafile=ca_file)
        context.check_hostname = mode == "verify-full"
        # Python 3.13 turns on the strict RFC 5280 profile (it rejects, for example, a CA
        # without an Authority Key Identifier, as MySQL's auto-generated certificates are).
        # The chain, expiry and signatures are still verified; this only keeps behaviour the
        # same as with Python 3.12 and with MySQL's own clients.
        context.verify_flags &= ~ssl.VERIFY_X509_STRICT
        return context
    raise ValueError(f"unknown MySQL ssl mode: {mode!r}")


# TODO(governance): the consent text says donations are "stored on servers managed by the
# University of Surrey". Confirm that the Azure-hosted MySQL instance counts as such (check with
# the DPO / IT), or reword that sentence in every public/config-*.json.
class MysqlStore:
    """Donations in MySQL: one metadata row plus the ciphertext in <= 4 MiB chunks, one transaction."""

    name = "mysql"

    def __init__(self, *, host, port, database, user, password, ssl_mode="required",
                 ca_file=None, connect_timeout=5, io_timeout=120):
        self._params = {
            "host": host, "port": int(port), "database": database, "user": user, "password": password,
            "connect_timeout": connect_timeout, "read_timeout": io_timeout, "write_timeout": io_timeout,
            "autocommit": False, "charset": "utf8mb4", "ssl": ssl_argument(ssl_mode, ca_file),
        }

    def _open(self):
        import pymysql  # imported on use so the SQLite default needs no MySQL driver
        return pymysql.connect(**self._params)

    def add(self, *, submission_id, platform, received_at, ip_hash, user_agent,
            total_tables, total_rows, payload):
        if not payload.startswith(SEALED_PREFIX):
            # The donations of several studies share this server: only ciphertext may be stored.
            raise StorageError("refusing to store an unencrypted payload")
        import pymysql

        moment = datetime.datetime.fromisoformat(received_at)
        if moment.tzinfo is not None:
            moment = moment.astimezone(datetime.UTC).replace(tzinfo=None)
        chunks = [payload[i:i + CHUNK_CHARS] for i in range(0, len(payload), CHUNK_CHARS)]

        driver_errors = (pymysql.err.MySQLError, OSError)
        try:
            conn = self._open()
        except driver_errors as exc:  # unreachable, TLS refused, access denied...
            raise StorageError(f"cannot connect: {exc}") from exc
        try:
            with conn.cursor() as cur:
                try:
                    cur.execute(
                        f"INSERT INTO {DONATIONS_TABLE} (submission_id, platform, received_at, ip_hash, user_agent,"
                        " total_tables, total_rows, payload_bytes, chunk_count)"
                        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
                        (submission_id, platform, moment, ip_hash, user_agent, total_tables, total_rows,
                         len(payload), len(chunks)),
                    )
                except pymysql.err.IntegrityError as exc:
                    if exc.args and exc.args[0] == MYSQL_DUPLICATE_ERRNO:
                        conn.rollback()
                        raise DuplicateSubmission(submission_id) from exc
                    raise
                donation_id = cur.lastrowid
                for seq, chunk in enumerate(chunks):
                    cur.execute(
                        f"INSERT INTO {CHUNKS_TABLE} (donation_id, seq, chunk) VALUES (%s, %s, %s)",
                        (donation_id, seq, chunk),
                    )
            conn.commit()
            return donation_id
        except DuplicateSubmission:
            raise
        except driver_errors as exc:
            with contextlib.suppress(*driver_errors):  # a dead connection is rolled back by the server itself
                conn.rollback()
            raise StorageError(f"insert failed and was rolled back: {exc}") from exc
        finally:
            conn.close()

    def ping(self):
        """Raises StorageError unless the server is reachable and both tables are readable by this account."""
        import pymysql

        try:
            conn = self._open()
            try:
                with conn.cursor() as cur:
                    cur.execute(f"SELECT 1 FROM {DONATIONS_TABLE} LIMIT 1")
                    cur.execute(f"SELECT 1 FROM {CHUNKS_TABLE} LIMIT 1")
            finally:
                conn.close()
        except (pymysql.err.MySQLError, OSError) as exc:
            raise StorageError(f"the MySQL store is not usable: {exc}") from exc

    def fetch_payload(self, submission_id):
        """The stored ciphertext of one donation, reassembled (used by the migration check and tests)."""
        conn = self._open()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    f"SELECT c.chunk FROM {CHUNKS_TABLE} c JOIN {DONATIONS_TABLE} d ON d.id = c.donation_id"
                    " WHERE d.submission_id = %s ORDER BY c.seq",
                    (submission_id,),
                )
                rows = cur.fetchall()
            return "".join(r[0] for r in rows) if rows else None
        finally:
            conn.close()


def mysql_store_from_env(env):
    """Build a MysqlStore from MYSQL_* settings (shared by the API and the migration script).

    Raises ValueError, naming what is missing, when the settings are incomplete.
    """
    password_file = (env.get("MYSQL_PASSWORD_FILE") or "").strip()
    if password_file:
        with open(password_file, encoding="utf-8") as fh:
            password = fh.read().strip()
    else:
        password = env.get("MYSQL_PASSWORD", "")
    missing = [k for k in ("MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER") if not env.get(k)]
    if not password:
        missing.append("MYSQL_PASSWORD (or MYSQL_PASSWORD_FILE)")
    if missing:
        raise ValueError("missing " + ", ".join(missing))
    return MysqlStore(
        host=env["MYSQL_HOST"], port=env.get("MYSQL_PORT", "3306"), database=env["MYSQL_DATABASE"],
        user=env["MYSQL_USER"], password=password,
        ssl_mode=(env.get("MYSQL_SSL_MODE") or "required").strip().lower(),
        ca_file=env.get("MYSQL_CA_FILE") or None,
    )

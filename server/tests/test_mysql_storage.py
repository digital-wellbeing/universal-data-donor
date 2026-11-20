"""MySQL storage tests against a REAL MySQL 8.4 server in Docker (skipped if Docker is unavailable).

They apply server/mysql_schema.sql exactly as an administrator would, create the API's
least-privilege account, and exercise the store, the API on top of it and the migration.
Needs: docker, and `pymysql` + `cryptography` installed.
"""
import base64
import json
import os
import re
import sqlite3
import subprocess
import tempfile
import time
import uuid
from pathlib import Path

import pytest

pymysql = pytest.importorskip("pymysql")

import app as appmod
import migrate_sqlite_to_mysql as migrate
import storage
from storage import DuplicateSubmission, MysqlStore, StorageError

SCHEMA = (Path(__file__).parent.parent / "mysql_schema.sql").read_text()
SID = "1234567890123456"
# Throwaway container only; random per run so no credential-shaped literal lives in the repo.
ROOT_PW = uuid.uuid4().hex
APP_PW = uuid.uuid4().hex
ENV_VALUE_KEY = "MYSQL_PASSWORD"
OTHER_PW = uuid.uuid4().hex  # a password that is deliberately not the account's


def _docker(*args, check=True):
    return subprocess.run(["docker", *args], capture_output=True, text=True, check=check)


@pytest.fixture(scope="module")
def mysql_server():
    if subprocess.run(["docker", "info"], capture_output=True, check=False).returncode != 0:
        pytest.skip("Docker is not available")
    name = f"dd-mysql-test-{uuid.uuid4().hex[:8]}"
    _docker("run", "-d", "--rm", "--name", name, "-e", f"MYSQL_ROOT_PASSWORD={ROOT_PW}", "-e", "MYSQL_DATABASE=iema",
            "-p", "127.0.0.1::3306", "mysql:8.4")
    try:
        port = int(_docker("port", name, "3306/tcp").stdout.strip().splitlines()[0].rsplit(":", 1)[1])
        ready = 0
        deadline = time.time() + 120
        while time.time() < deadline and ready < 3:
            try:
                pymysql.connect(host="127.0.0.1", port=port, user="root", password=ROOT_PW, database="iema").close()
                ready += 1
                time.sleep(1)
            except pymysql.err.MySQLError:
                ready = 0
                time.sleep(2)
        assert ready == 3, "MySQL did not become ready"
        root = pymysql.connect(host="127.0.0.1", port=port, user="root", password=ROOT_PW, database="iema", autocommit=True)
        with root.cursor() as cur:
            # The schema, exactly as the administrator would run it (comments stripped).
            statements = [s.strip() for s in re.sub(r"--[^\n]*", "", SCHEMA).split(";") if s.strip()]
            for statement in statements:
                cur.execute(statement)
            cur.execute("CREATE USER 'datadonation'@'%%' IDENTIFIED WITH caching_sha2_password BY %s", (APP_PW,))
            cur.execute("GRANT SELECT, INSERT ON iema.datadonation_donations TO 'datadonation'@'%'")
            cur.execute("GRANT SELECT, INSERT ON iema.datadonation_payload_chunks TO 'datadonation'@'%'")
            cur.execute("CREATE TABLE iema.another_app_table (id INT)")  # must stay out of reach
        ca = Path(tempfile.mkdtemp()) / "ca.pem"
        _docker("cp", f"{name}:/var/lib/mysql/ca.pem", str(ca))
        yield {"port": port, "root": root, "ca": str(ca)}
        root.close()
    finally:
        _docker("rm", "-f", name, check=False)


def make_store(server, **over):
    params = {"host": "127.0.0.1", "port": server["port"], "database": "iema", "user": "datadonation", "password": APP_PW, "ssl_mode": "required"}
    params.update(over)
    return MysqlStore(**params)


@pytest.fixture
def store(mysql_server):
    with mysql_server["root"].cursor() as cur:
        cur.execute("DELETE FROM datadonation_donations")
    return make_store(mysql_server)


def sealed(n_chars):
    return "enc:v1:" + base64.b64encode(os.urandom(n_chars * 3 // 4)).decode()[:n_chars]


def fields(sid=SID, payload=None, **over):
    base = {"submission_id": sid, "platform": "googletakeout", "received_at": "2026-11-20T21:00:00.123456+00:00",
            "ip_hash": "ab" * 16, "user_agent": "UA/1.0", "total_tables": 2, "total_rows": 7, "payload": payload or sealed(1000)}
    base.update(over)
    return base


def counts(server):
    with server["root"].cursor() as cur:
        cur.execute("SELECT (SELECT COUNT(*) FROM datadonation_donations), (SELECT COUNT(*) FROM datadonation_payload_chunks)")
        return cur.fetchone()


def test_schema_applied_and_account_is_least_privilege(mysql_server, store):
    conn = pymysql.connect(host="127.0.0.1", port=mysql_server["port"], user="datadonation", password=APP_PW, database="iema", ssl={"ca": None})
    with conn.cursor() as cur:
        cur.execute("SELECT 1 FROM datadonation_donations LIMIT 1")  # allowed
        for forbidden in ("DELETE FROM datadonation_donations", "UPDATE datadonation_donations SET platform='x'",
                          "DROP TABLE datadonation_donations", "CREATE TABLE intruder (id INT)",
                          "SELECT 1 FROM another_app_table"):
            with pytest.raises(pymysql.err.MySQLError) as err:
                cur.execute(forbidden)
            assert err.value.args[0] in (1142, 1143, 1044), forbidden  # privilege errors
    conn.close()


def test_small_payload_roundtrip(mysql_server, store):
    f = fields()
    donation_id = store.add(**f)
    assert isinstance(donation_id, int) and counts(mysql_server) == (1, 1)
    assert store.fetch_payload(SID) == f["payload"]
    with mysql_server["root"].cursor() as cur:
        cur.execute("SELECT platform, received_at, ip_hash, total_tables, total_rows, payload_bytes, chunk_count FROM datadonation_donations")
        platform, received, ip_hash, tt, tr, nbytes, nchunks = cur.fetchone()
    assert (platform, ip_hash, tt, tr, nbytes, nchunks) == ("googletakeout", "ab" * 16, 2, 7, len(f["payload"]), 1)
    assert str(received) == "2026-11-20 21:00:00.123456"  # stored as UTC


def test_large_payload_is_chunked_and_reassembles_identically(mysql_server, store):
    payload = sealed(int(storage.CHUNK_CHARS * 2.4))  # ~9.6 M chars: three chunks
    store.add(**fields(payload=payload))
    assert counts(mysql_server) == (1, 3)
    assert store.fetch_payload(SID) == payload


def test_duplicate_submission_is_refused_and_leaves_no_orphan_chunks(mysql_server, store):
    store.add(**fields())
    with pytest.raises(DuplicateSubmission):
        store.add(**fields(payload=sealed(5000)))
    assert counts(mysql_server) == (1, 1)


def test_unencrypted_payload_is_refused(mysql_server, store):
    with pytest.raises(StorageError, match="unencrypted"):
        store.add(**fields(payload='{"plain": "text"}'))
    assert counts(mysql_server) == (0, 0)


def test_a_failure_part_way_rolls_everything_back(mysql_server, store):
    # The chunk column is ASCII: a non-ASCII character in the SECOND chunk fails that insert,
    # after the metadata row and the first chunk already went in.
    payload = "enc:v1:" + "A" * storage.CHUNK_CHARS + "é" + "A" * 100
    with pytest.raises(StorageError, match="rolled back"):
        store.add(**fields(payload=payload))
    assert counts(mysql_server) == (0, 0)


def test_ping_ok_and_fails_for_a_wrong_password_or_an_unreachable_server(mysql_server, store):
    store.ping()
    with pytest.raises(StorageError):
        make_store(mysql_server, password=OTHER_PW).ping()
    with pytest.raises(StorageError):
        make_store(mysql_server, port=1).ping()


def test_unreachable_server_is_a_storage_error(mysql_server):
    with pytest.raises(StorageError, match="cannot connect"):
        make_store(mysql_server, port=1, user="x", password="y").add(**fields())


def test_tls_modes(mysql_server, store):
    make_store(mysql_server, ssl_mode="required").ping()                               # encrypted, unverified
    make_store(mysql_server, ssl_mode="verify-ca", ca_file=mysql_server["ca"]).ping()  # chain verified
    with pytest.raises(StorageError):                                                     # chain NOT trusted by the system store
        make_store(mysql_server, ssl_mode="verify-ca").ping()
    with pytest.raises(StorageError):                                                     # IP does not match the certificate
        make_store(mysql_server, ssl_mode="verify-full", ca_file=mysql_server["ca"]).ping()
    with pytest.raises(ValueError):
        make_store(mysql_server, ssl_mode="bogus")


def test_the_connection_really_is_encrypted(mysql_server):
    conn = make_store(mysql_server, ssl_mode="required")._open()
    with conn.cursor() as cur:
        cur.execute("SHOW STATUS LIKE 'Ssl_cipher'")
        assert cur.fetchone()[1], "no TLS cipher negotiated"
    conn.close()


def envelope(sid=SID):
    return {"platform": "googletakeout", "encrypted": {
        "v": 1, "submissionId": sid, "summary": {"tables": {"Google Fit - Raw Steps": 1}, "totalRows": 1}, "payload": sealed(3000)}}


@pytest.fixture
def api(mysql_server, store, monkeypatch):
    monkeypatch.setattr(appmod, "verify_turnstile", lambda token, ip: token == "ok")
    monkeypatch.setattr(appmod, "store", store)
    with sqlite3.connect(appmod.DONATION_DB) as c:
        c.execute("DELETE FROM rate_events")
    return appmod.app.test_client()


def post(client, body):
    return client.post("/datadonation/submit", data=json.dumps(body),
                       headers={"Content-Type": "application/json", "CF-Turnstile-Response": "ok"})


def test_api_stores_an_encrypted_envelope_in_mysql_and_not_in_sqlite(mysql_server, api):
    body = envelope()
    assert post(api, body).status_code == 200
    assert counts(mysql_server) == (1, 1)
    with sqlite3.connect(appmod.DONATION_DB) as c:
        assert c.execute("SELECT COUNT(*) FROM donations WHERE submission_id = ?", (SID,)).fetchone()[0] == 0


def test_api_server_encrypts_a_plaintext_donation_before_it_reaches_mysql(mysql_server, api):
    body = {"platform": "googletakeout", "donation": {
        "submissionId": SID, "platform": "googletakeout", "data": {"Google Fit - Raw Steps": [{"a": 1}]}}}
    assert post(api, body).status_code == 200
    payload = appmod.store.fetch_payload(SID)
    assert payload.startswith("enc:v1:") and '"a"' not in payload


def test_api_duplicate_is_409_and_mysql_outage_is_503(mysql_server, api, monkeypatch):
    assert post(api, envelope()).status_code == 200
    r = post(api, envelope())
    assert r.status_code == 409 and r.get_json()["error"] == "duplicate_submission"
    monkeypatch.setattr(appmod, "store", make_store(mysql_server, port=1))
    r = post(api, envelope(sid="2234567890123456"))
    assert r.status_code == 503 and r.get_json()["error"] == "storage_unavailable"


def test_health_follows_the_mysql_store(mysql_server, api, monkeypatch):
    assert api.get("/datadonation/submit").status_code == 200
    monkeypatch.setattr(appmod, "store", make_store(mysql_server, password=OTHER_PW))
    r = api.get("/datadonation/submit")
    assert r.status_code == 503 and r.get_json()["error"] == "storage_unavailable"


def source_db(rows):
    path = Path(tempfile.mkdtemp()) / "src.sqlite"
    with sqlite3.connect(path) as c:
        c.execute("CREATE TABLE donations (id INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT, platform TEXT, received_at TEXT,"
                  " ip_hash TEXT, user_agent TEXT, total_tables INTEGER, total_rows INTEGER, payload TEXT NOT NULL)")
        for sid, payload in rows:
            c.execute("INSERT INTO donations (submission_id, platform, received_at, ip_hash, user_agent, total_tables, total_rows, payload)"
                      " VALUES (?, 'googlefit', '2026-01-02T03:04:05+00:00', 'cd', 'UA', 1, 2, ?)", (sid, payload))
    return str(path)


def test_migration_copies_verifies_and_is_idempotent(mysql_server, store):
    rows = [("1000000000000001", sealed(2000)), ("1000000000000002", sealed(storage.CHUNK_CHARS + 10))]
    messages = []
    assert migrate.migrate(migrate.read_source(source_db(rows)), store, dry_run=True, out=messages.append) == 0
    assert counts(mysql_server) == (0, 0) and "would copy 2" in messages[-1]
    assert migrate.migrate(migrate.read_source(source_db(rows)), store, out=messages.append) == 0
    assert counts(mysql_server) == (2, 3) and "copied 2, already present (skipped) 0" in messages[-1]
    for sid, payload in rows:
        assert store.fetch_payload(sid) == payload
    assert migrate.migrate(migrate.read_source(source_db(rows)), store, out=messages.append) == 0
    assert counts(mysql_server) == (2, 3) and "copied 0, already present (skipped) 2" in messages[-1]


def test_migration_refuses_unencrypted_rows_and_copies_nothing(mysql_server, store):
    rows = [("1000000000000001", sealed(2000)), ("1000000000000009", '{"plaintext": true}')]
    messages = []
    assert migrate.migrate(migrate.read_source(source_db(rows)), store, out=messages.append) == 2
    assert "1000000000000009" in messages[0] and "plaintext" not in messages[0]  # ids named, content never
    assert counts(mysql_server) == (0, 0)


def test_env_parsing_and_app_requirements(tmp_path, monkeypatch):
    with pytest.raises(ValueError, match="MYSQL_HOST.*MYSQL_USER|MYSQL_HOST"):
        storage.mysql_store_from_env({"MYSQL_DATABASE": "d", "MYSQL_PASSWORD": "p"})
    with pytest.raises(ValueError, match="MYSQL_PASSWORD"):
        storage.mysql_store_from_env({"MYSQL_HOST": "h", "MYSQL_DATABASE": "d", "MYSQL_USER": "u"})
    pwfile = tmp_path / "pw"
    from_file, from_env = uuid.uuid4().hex, uuid.uuid4().hex
    pwfile.write_text(from_file + "\n")
    settings = {"MYSQL_HOST": "h", "MYSQL_DATABASE": "d", "MYSQL_USER": "u", "MYSQL_PASSWORD_FILE": str(pwfile)}
    settings[ENV_VALUE_KEY] = from_env  # both the env value and the file are set; the file must win
    s = storage.mysql_store_from_env(settings)
    assert s._params["password"] == from_file  # the file wins
    monkeypatch.setattr(appmod, "STORAGE_BACKEND", "mysql")
    monkeypatch.setattr(appmod, "REQUIRE_ENCRYPTION", False)
    with pytest.raises(SystemExit, match="ciphertext"):
        appmod.build_store()
    monkeypatch.setattr(appmod, "STORAGE_BACKEND", "oracle")
    with pytest.raises(SystemExit, match="sqlite or mysql"):
        appmod.build_store()

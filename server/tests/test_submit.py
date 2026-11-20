"""End-to-end tests of POST /datadonation/submit with the real Flask app (Turnstile faked)."""
import json
import sqlite3

import app as appmod
import pytest

SID = "1234567890123456"


@pytest.fixture(autouse=True)
def fresh_db(monkeypatch):
    monkeypatch.setattr(appmod, "verify_turnstile", lambda token, ip: token == "ok")
    with sqlite3.connect(appmod.DONATION_DB) as c:
        c.execute("DELETE FROM donations")
        c.execute("DELETE FROM rate_events")
    yield


@pytest.fixture
def client():
    return appmod.app.test_client()


def package(platform="googletakeout", sid=SID, data=None, **extra):
    data = {"Google Fit - Raw Heart Rate": [{"Start (UTC)": "2026-01-01 00:00:00", "Heart Rate (bpm)": "70"}] * 3} if data is None else data
    return {"platform": platform, "donation": {"submissionId": sid, "platform": platform, "data": data, **extra}}


def post(client, body, token="ok", raw=None):
    headers = {"Content-Type": "application/json"}
    if token is not None:
        headers["CF-Turnstile-Response"] = token
    return client.post("/datadonation/submit", data=raw if raw is not None else json.dumps(body), headers=headers)


def rows():
    with sqlite3.connect(appmod.DONATION_DB) as c:
        return c.execute("select submission_id, platform, total_tables, total_rows, substr(payload,1,7) from donations").fetchall()


def test_valid_donation_is_stored_encrypted_with_server_counted_totals(client):
    body = package(metadata={"totalTables": 99, "totalRemainingRows": 10**9})  # the client lies
    r = post(client, body)
    assert r.status_code == 200 and r.get_json()["submissionId"] == SID
    assert rows() == [(SID, "googletakeout", 1, 3, "enc:v1:")]


def test_missing_or_bad_turnstile_token_is_rejected(client):
    assert post(client, package(), token=None).status_code == 403
    assert post(client, package(), token="bogus").status_code == 403
    assert rows() == []


@pytest.mark.parametrize("platform", ["", "nope", "GOOGLETAKEOUT2"])
def test_platform_must_be_known(client, platform):
    body = package()
    body["platform"] = platform
    r = post(client, body)
    assert r.status_code == 400 and r.get_json()["error"] == "unknown_platform"
    assert rows() == []


def test_unknown_table_for_a_known_platform_is_rejected(client):
    r = post(client, package(data={"Injected Table": [{"a": 1}]}))
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_payload"
    assert rows() == []


def test_other_platforms_get_structural_checks_only(client):
    r = post(client, package(platform="garmin", data={"Any Table Name": [{"a": 1}]}))
    assert r.status_code == 200


def test_duplicate_submission_id_is_refused(client):
    assert post(client, package()).status_code == 200
    r = post(client, package())
    assert r.status_code == 409 and r.get_json()["error"] == "duplicate_submission"
    assert len(rows()) == 1


def test_nan_literal_is_rejected(client):
    raw = f'{{"platform":"garmin","donation":{{"submissionId":"{SID}","data":{{"T":[{{"x": NaN}}]}}}}}}'.encode()
    r = post(client, None, raw=raw)
    assert r.status_code == 400 and r.get_json()["error"] == "invalid_payload"
    assert rows() == []


@pytest.mark.parametrize("bad", [
    package(sid="123"),
    package(data={"Google Fit - Raw Steps": [{"a": {"nested": 1}}]}),
    package(unexpected_key=1),
])
def test_malformed_payloads_are_rejected(client, bad):
    assert post(client, bad).status_code == 400
    assert rows() == []


def test_donation_platform_must_match_request_platform(client):
    body = package()
    body["donation"]["platform"] = "garmin"
    assert post(client, body).status_code == 400


def test_low_storage_refuses_donations_and_turns_health_unhealthy(client, monkeypatch):
    assert client.get("/datadonation/submit").status_code == 200
    monkeypatch.setattr(appmod, "MIN_FREE_BYTES", 1 << 60)
    health = client.get("/datadonation/submit")
    assert health.status_code == 503 and health.get_json()["error"] == "storage_low"
    r = post(client, package())
    assert r.status_code == 503 and r.get_json()["error"] == "storage_low"
    assert rows() == []


def test_storage_check_counts_the_incoming_body(monkeypatch):
    free = appmod.shutil.disk_usage(".").free
    monkeypatch.setattr(appmod, "MIN_FREE_BYTES", free - 1000)
    assert appmod.storage_ok(0) is True
    assert appmod.storage_ok(10_000) is False  # twice the body would eat the reserve


def test_db_size_cap(monkeypatch):
    monkeypatch.setattr(appmod, "MAX_DB_BYTES", 1)
    assert appmod.storage_ok(0) is False


def test_storage_check_fails_closed(monkeypatch):
    def boom(_path):
        raise OSError("cannot stat")
    monkeypatch.setattr(appmod.shutil, "disk_usage", boom)
    assert appmod.storage_ok(0) is False

"""
Data-donation submission endpoint for the Universal Data Donor.

Receives donation packages POSTed by the frontend at /datadonation/submit,
gates them behind a server-verified Cloudflare Turnstile challenge + per-IP rate
limiting + a payload-size cap + basic shape validation, and stores accepted
donations in a SQLite database.

Config via environment (all optional; safe test defaults for local dev):
  DONATION_DB       Path to the SQLite file (default ./donations.sqlite)
  TURNSTILE_SECRET  Cloudflare Turnstile secret. Defaults to Cloudflare's
                    "always passes" TEST secret so the flow works before you
                    provision real keys. MUST be set to the real secret in prod.
  TURNSTILE_ACTION  Optional. If set, siteverify's echoed `action` must equal it
                    (the widget sends action="donate"). Unset = don't check.
  TURNSTILE_HOSTNAMES  Optional comma-separated allow-list. If set, siteverify's
                    `hostname` must be one of them (e.g. iemabot.surrey.ac.uk).
                    Unset = don't check.
  IP_SALT           Salt for hashing client IPs (we store a salted hash, never
                    the raw IP). Set to a long random string in prod.
  MAX_BYTES         Max request body size (default 25 MiB).
  RATE_MAX          Max accepted submissions per IP per window (default 5).
  RATE_WINDOW       Rate-limit window in seconds (default 3600).
"""

import os
import json
import time
import hmac
import hashlib
import sqlite3
import threading
import datetime
import urllib.parse
import urllib.request

from flask import Flask, request, jsonify

DONATION_DB = os.environ.get("DONATION_DB", os.path.join(os.path.dirname(__file__), "donations.sqlite"))
# Cloudflare's documented "always passes" test secret. Override in production.
TURNSTILE_SECRET = os.environ.get("TURNSTILE_SECRET", "1x0000000000000000000000000000000AA")
TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
# Optional extra siteverify assertions (recommended in prod). Empty = not enforced.
TURNSTILE_ACTION = os.environ.get("TURNSTILE_ACTION", "").strip()
TURNSTILE_HOSTNAMES = {
    h.strip().lower()
    for h in os.environ.get("TURNSTILE_HOSTNAMES", "").split(",")
    if h.strip()
}
IP_SALT = os.environ.get("IP_SALT", "dev-insecure-salt-change-me")
MAX_BYTES = int(os.environ.get("MAX_BYTES", 25 * 1024 * 1024))
RATE_MAX = int(os.environ.get("RATE_MAX", "5"))
RATE_WINDOW = int(os.environ.get("RATE_WINDOW", "3600"))
ALLOWED_PLATFORMS = {"playstation", "android", "activitywatch", "googlefit", "garmin"}

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_BYTES

_write_lock = threading.Lock()


def _connect():
    conn = sqlite3.connect(DONATION_DB, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def init_db():
    with _connect() as c:
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS donations (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                submission_id  TEXT,
                platform       TEXT,
                received_at    TEXT NOT NULL,
                ip_hash        TEXT,
                user_agent     TEXT,
                total_tables   INTEGER,
                total_rows     INTEGER,
                payload        TEXT NOT NULL
            )
            """
        )
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS rate_events (
                ip_hash TEXT NOT NULL,
                ts      INTEGER NOT NULL
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_rate_events ON rate_events (ip_hash, ts)")


def client_ip():
    # Behind Caddy's reverse_proxy, the real client IP is the first hop of
    # X-Forwarded-For (Caddy appends it). Fall back to the socket peer.
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.remote_addr or "unknown"


def hash_ip(ip):
    return hmac.new(IP_SALT.encode(), ip.encode(), hashlib.sha256).hexdigest()[:32]


def verify_turnstile(token, ip):
    """Server-side verification of a Turnstile token. Returns True on success."""
    if not token:
        return False
    data = urllib.parse.urlencode(
        {"secret": TURNSTILE_SECRET, "response": token, "remoteip": ip}
    ).encode()
    try:
        req = urllib.request.Request(TURNSTILE_VERIFY_URL, data=data)
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.load(resp)
    except Exception as exc:  # network / parse failure -> fail closed
        app.logger.warning("Turnstile verification error: %s", exc)
        return False

    if not result.get("success"):
        app.logger.info("Turnstile rejected token: %s", result.get("error-codes"))
        return False
    # Optional hardening (only enforced when the env vars are set).
    if TURNSTILE_ACTION and result.get("action") != TURNSTILE_ACTION:
        app.logger.warning("Turnstile action mismatch: %r != %r", result.get("action"), TURNSTILE_ACTION)
        return False
    if TURNSTILE_HOSTNAMES and str(result.get("hostname", "")).lower() not in TURNSTILE_HOSTNAMES:
        app.logger.warning("Turnstile hostname not allowed: %r", result.get("hostname"))
        return False
    return True


def rate_ok(ip_hash_value):
    """Sliding-window per-IP rate limit. Records the event when allowed."""
    now = int(time.time())
    with _write_lock, _connect() as c:
        c.execute("DELETE FROM rate_events WHERE ts < ?", (now - RATE_WINDOW,))
        count = c.execute(
            "SELECT COUNT(*) FROM rate_events WHERE ip_hash = ?", (ip_hash_value,)
        ).fetchone()[0]
        if count >= RATE_MAX:
            return False
        c.execute("INSERT INTO rate_events (ip_hash, ts) VALUES (?, ?)", (ip_hash_value, now))
        return True


@app.get("/datadonation/submit")
def health():
    return jsonify(ok=True, service="datadonation-submit")


@app.post("/datadonation/submit")
def submit():
    ip = client_ip()
    ip_hash_value = hash_ip(ip)

    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        return jsonify(ok=False, error="invalid_json"), 400

    # 1) Human check — server-verified Turnstile token. A bot POSTing directly
    #    without a valid token is rejected here.
    token = body.get("turnstileToken") or request.headers.get("CF-Turnstile-Response")
    if not verify_turnstile(token, ip):
        return jsonify(ok=False, error="captcha_failed"), 403

    # 2) Rate limit per IP (prevents flooding).
    if not rate_ok(ip_hash_value):
        return jsonify(ok=False, error="rate_limited"), 429

    # 3) Validate the donation payload shape.
    donation = body.get("donation")
    if not isinstance(donation, dict) or not isinstance(donation.get("data"), dict):
        return jsonify(ok=False, error="invalid_payload"), 400

    platform = str(body.get("platform") or "").lower()
    if platform and platform not in ALLOWED_PLATFORMS:
        return jsonify(ok=False, error="unknown_platform"), 400

    meta = donation.get("metadata") if isinstance(donation.get("metadata"), dict) else {}
    received_at = datetime.datetime.now(datetime.timezone.utc).isoformat()

    with _write_lock, _connect() as c:
        cur = c.execute(
            """
            INSERT INTO donations
                (submission_id, platform, received_at, ip_hash, user_agent,
                 total_tables, total_rows, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(donation.get("submissionId") or ""),
                platform,
                received_at,
                ip_hash_value,
                (request.headers.get("User-Agent") or "")[:300],
                meta.get("totalTables"),
                meta.get("totalRemainingRows"),
                json.dumps(donation, ensure_ascii=False),
            ),
        )
        row_id = cur.lastrowid

    return jsonify(ok=True, id=row_id, submissionId=donation.get("submissionId"))


init_db()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8083)

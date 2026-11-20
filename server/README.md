# Data-donation submission API

A tiny Flask + SQLite service that receives donation packages from the frontend
and stores them, gated by **server-verified Cloudflare Turnstile** + per-IP rate
limiting + a payload-size cap + shape validation.

- Endpoint: `POST /datadonation/submit`  (reverse-proxied by Caddy → `127.0.0.1:8083`)
- Storage: `/srv/datadonation-data/donations.sqlite` (bind-mounted volume)
- Health: `GET /datadonation/submit` → `{"ok": true}`

## Request body

```json
{
  "platform": "activitywatch",
  "turnstileToken": "<token from the Turnstile widget>",
  "donation": { "submissionId": "...", "data": { "...": [] }, "metadata": { } }
}
```

Responses: `200 {ok:true,id}` · `403 captcha_failed` · `429 rate_limited` ·
`400 invalid_payload|invalid_json|unknown_platform` · `409 duplicate_submission` ·
`503 server_busy|storage_low`.

The payload is validated strictly (`validation.py`): a known platform, a 16-digit
`submissionId` that has not been used before, only known top-level keys, at most
50 tables / 1.5M rows / 60 columns, finite scalar cells, and, for `googlefit` and
`googletakeout`, only that platform's table names. Row and table totals are
counted by the server, never taken from the client's `metadata`. A rejected
payload gets a generic `invalid_payload`; the reason is only logged.

`GET /datadonation/submit` is the health check and also the disk alert: it returns
`503 storage_low` (so the container turns unhealthy) when free space drops below
`MIN_FREE_BYTES`.

Tests: `uv run --with flask==3.0.3 --with pynacl==1.5.0 --with pytest python -m pytest server/tests`.

## Config (env, see `datadonation-api.env.example`)

`TURNSTILE_SECRET` (real secret in prod; defaults to Cloudflare's always-pass
TEST secret), `TURNSTILE_ACTION` (optional; require siteverify's echoed action
to equal it — the widget sends `donate`), `TURNSTILE_HOSTNAMES` (optional
comma-separated allow-list checked against siteverify's `hostname`), `IP_SALT`,
`RATE_MAX`, `RATE_WINDOW`, `MAX_BYTES`, `MIN_FREE_BYTES`, `MAX_DB_BYTES`,
`MAX_CONCURRENT_SUBMITS`, `XFF_TRUSTED_HOPS`.

Behind a gateway the rate limit only works per client once Caddy trusts the
gateway's `X-Forwarded-For` (`sudo bash deploy/host/trust-gateway-xff.sh`) and
`XFF_TRUSTED_HOPS=1` is set; until then all participants share one bucket.

## Deploy

This service runs as the `datadonation-api` container next to the frontend's
`datadonation-web` container, both defined in the repo-root `docker-compose.yml`.
Its config lives in `server/datadonation-api.env` (gitignored; copy the example).
See the root README's "Deployment" section: a signed push to `production`
(`deploy/promote.sh`) makes the VPS's self-hosted runner run
`../deploy-datadonation.sh`, which builds/starts both containers, creates the
data dir + env file, and points Caddy at them.

## Inspect donations

```bash
docker compose exec datadonation-api \
  python -c "import sqlite3,json; \
  [print(r) for r in sqlite3.connect('/data/donations.sqlite').execute( \
  'select id,received_at,platform,submission_id,total_rows from donations order by id desc limit 20')]"

# Export one donation's full payload:
sqlite3 /srv/datadonation-data/donations.sqlite \
  "select payload from donations where id=1;" > donation-1.json
```

## DB schema

`donations(id, submission_id, platform, received_at, ip_hash, user_agent,
total_tables, total_rows, payload)` — `payload` is the full donation JSON;
`ip_hash` is a salted SHA-256 (no raw IPs stored). Plus `rate_events(ip_hash, ts)`
for rate limiting.

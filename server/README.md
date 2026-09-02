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
`400 invalid_payload|invalid_json|unknown_platform`.

## Config (env, see `datadonation-api.env.example`)

`TURNSTILE_SECRET` (real secret in prod; defaults to Cloudflare's always-pass
TEST secret), `TURNSTILE_ACTION` (optional; require siteverify's echoed action
to equal it — the widget sends `donate`), `TURNSTILE_HOSTNAMES` (optional
comma-separated allow-list checked against siteverify's `hostname`), `IP_SALT`,
`RATE_MAX`, `RATE_WINDOW`, `MAX_BYTES`.

## Deploy

Handled by `../deploy-datadonation.sh` (run on the VPS as root): it builds/starts
this container via `docker compose`, creates the data dir + env file, and adds the
Caddy `/datadonation/submit` route.

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

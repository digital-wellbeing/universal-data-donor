#!/usr/bin/env bash
set -euo pipefail

# Harden the Universal Data Donor host. Run as root on surrey-vps:
#
#     sudo bash ~/harden-datadonation.sh
#
# Idempotent. Order matters: the new frontend (which sends the Turnstile token as
# a header) is published BEFORE the new API (which only accepts the header).
#   1. Backs up the donations DB (root-only, 0700 dir).
#   2. Locks down permissions: env file 0600, data dir 0700 owned by the
#      container's unprivileged uid (10001).
#   3. Publishes frontend + rebuilds the API (non-root, read-only container).
#   4. Adds security headers (CSP, HSTS, nosniff, ...) to the /datadonation
#      Caddy routes only, validates, reloads. ESMira routes are untouched.
#   5. Prints the proxy addresses Caddy sees, to set XFF_TRUSTED_HOPS correctly.

API_DIR="/home/tf0011/datadonation-api"
DATA_DIR=/srv/datadonation-data
BACKUP_DIR=/srv/datadonation-backups
CADDYFILE=/etc/caddy/Caddyfile
STAMP="20261016-131240"
ENV_FILE="/datadonation-api.env"

echo "=== [1/5] Backing up donations DB ==="
install -d -m 0700 -o root -g root ""
if [ -f "/donations.sqlite" ]; then
  # Checkpoint the WAL via sqlite's online backup API (python3 is always present).
  python3 - "/donations.sqlite" "/donations-.sqlite" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1]); dst = sqlite3.connect(sys.argv[2])
src.backup(dst); dst.close(); src.close()
PY
  chmod 0600 "/donations-.sqlite"
  echo "    backup: /donations-.sqlite"
fi

echo "=== [2/5] Locking down permissions ==="
chown tf0011:tf0011 "" 2>/dev/null || true
chmod 0600 ""
grep -q '^XFF_TRUSTED_HOPS=' "" || echo 'XFF_TRUSTED_HOPS=0' >> ""
chown -R 10001:10001 ""
chmod 0700 ""
chmod 0600 ""/donations.sqlite* 2>/dev/null || true
ls -ld "" ""

echo "=== [3/5] Publishing frontend and rebuilding API ==="
bash "/home/tf0011/deploy-datadonation.sh"

echo "=== [4/5] Security headers in Caddy ==="
if grep -q '(ddsec)' ""; then
  echo "    already present"
else
  cp -a "" ".bak."
  tmp="/var/folders/w8/7j6qskcn4bv07zpp2t7xn7x80000gp/T/tmp.8KcGc2p8B6"
  python3 - "" "" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
snippet = """(ddsec) {
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy no-referrer
		Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
		Content-Security-Policy "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline' https://stackpath.bootstrapcdn.com https://cdn.jsdelivr.net; font-src 'self' data: https://cdn.jsdelivr.net; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
		-Server
	}
}

"""
out = snippet + src
for opener in (r"(\thandle /datadonation/submit \{\n)", r"(\thandle_path /datadonation/\* \{\n)"):
    out, n = re.subn(opener, r"\1\t\timport ddsec\n", out, count=1)
    assert n == 1, opener
open(sys.argv[2], "w").write(out)
PY
  caddy validate --adapter caddyfile --config ""
  install -m 0644 "" ""; rm -f ""
  systemctl reload caddy
  echo "    applied (backup: .bak.)"
fi

echo "=== [5/5] Verifying ==="
sleep 1
curl -sI http://127.0.0.1/datadonation/ | grep -iE "^(HTTP|content-security|strict|x-content|x-frame|referrer)" | cut -c1-110
curl -s -o /dev/null -w "  API health -> %{http_code}\n" http://127.0.0.1/datadonation/submit
curl -s -X POST -H 'Content-Type: application/json' -d '{}' -w "  POST without token -> %{http_code} (expect 403)\n" -o /dev/null http://127.0.0.1/datadonation/submit
echo "  container user:  (expect 10001)"
echo ""
echo "--- Proxy addresses Caddy sees on /datadonation/submit (to set XFF_TRUSTED_HOPS) ---"
tail -n 400 /var/log/caddy/access.log | python3 -c '
import sys, json, collections
c = collections.Counter()
for l in sys.stdin:
    try: j = json.loads(l)
    except Exception: continue
    r = j.get("request", {})
    if "/datadonation" in r.get("uri", ""):
        c[(r.get("remote_ip"), r.get("headers", {}).get("X-Forwarded-For", [None])[0])] += 1
for (ip, xff), n in c.most_common(6): print("  remote_ip=%s  X-Forwarded-For=%s  (%d reqs)" % (ip, xff, n))
' || true
echo ""
echo "Done. Tell Claude the output above so XFF_TRUSTED_HOPS / Caddy trusted_proxies can be set."

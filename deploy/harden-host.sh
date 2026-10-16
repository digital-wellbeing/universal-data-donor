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

OWNER="${SUDO_USER:-tf0011}"
API_DIR="${API_DIR:-/home/$OWNER/datadonation-api}"
DATA_DIR=/srv/datadonation-data
BACKUP_DIR=/srv/datadonation-backups
CADDYFILE=/etc/caddy/Caddyfile
STAMP="$(date +%Y%m%d-%H%M%S)"
ENV_FILE="$API_DIR/datadonation-api.env"
CSP="default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

echo "=== [1/5] Backing up donations DB ==="
install -d -m 0700 -o root -g root "$BACKUP_DIR"
if [ -f "$DATA_DIR/donations.sqlite" ]; then
  # sqlite online-backup API (checkpoints the WAL); python3 is always present.
  python3 - "$DATA_DIR/donations.sqlite" "$BACKUP_DIR/donations-$STAMP.sqlite" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1]); dst = sqlite3.connect(sys.argv[2])
src.backup(dst); dst.close(); src.close()
PY
  chmod 0600 "$BACKUP_DIR/donations-$STAMP.sqlite"
  echo "    backup: $BACKUP_DIR/donations-$STAMP.sqlite"
fi

echo "=== [2/5] Locking down permissions ==="
chown "$OWNER:$OWNER" "$ENV_FILE"
chmod 0600 "$ENV_FILE"
grep -q '^XFF_TRUSTED_HOPS=' "$ENV_FILE" || echo 'XFF_TRUSTED_HOPS=0' >> "$ENV_FILE"
chown -R 10001:10001 "$DATA_DIR"
chmod 0700 "$DATA_DIR"
chmod 0600 "$DATA_DIR"/donations.sqlite* 2>/dev/null || true
ls -ld "$DATA_DIR" "$ENV_FILE"

echo "=== [3/5] Publishing frontend and rebuilding API ==="
bash "/home/$OWNER/deploy-datadonation.sh"

echo "=== [4/5] Security headers in Caddy ==="
if grep -q '(ddsec)' "$CADDYFILE"; then
  cp -a "$CADDYFILE" "${CADDYFILE}.bak.${STAMP}"
  tmp="$(mktemp)"
  python3 - "$CADDYFILE" "$tmp" "$CSP" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
out, n = re.subn(r'(Content-Security-Policy ")[^"]*(")', lambda m: m.group(1) + sys.argv[3] + m.group(2), src, count=1)
assert n == 1
open(sys.argv[2], "w").write(out)
PY
  caddy validate --adapter caddyfile --config "$tmp"
  install -m 0644 "$tmp" "$CADDYFILE"; rm -f "$tmp"
  systemctl reload caddy
  echo "    CSP refreshed (backup: ${CADDYFILE}.bak.${STAMP})"
else
  cp -a "$CADDYFILE" "${CADDYFILE}.bak.${STAMP}"
  tmp="$(mktemp)"
  python3 - "$CADDYFILE" "$tmp" <<'PY'
import re, sys
src = open(sys.argv[1]).read()
snippet = """(ddsec) {
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		X-Frame-Options DENY
		Referrer-Policy no-referrer
		Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()"
		Content-Security-Policy "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
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
  caddy validate --adapter caddyfile --config "$tmp"
  install -m 0644 "$tmp" "$CADDYFILE"; rm -f "$tmp"
  systemctl reload caddy
  echo "    applied (backup: ${CADDYFILE}.bak.${STAMP})"
fi

echo "=== [5/5] Verifying ==="
sleep 1
curl -sI http://127.0.0.1/datadonation/ | grep -iE "^(HTTP|content-security|strict|x-content|x-frame|referrer)" | cut -c1-110 || true
curl -s -o /dev/null -w "  API health -> %{http_code}\n" http://127.0.0.1/datadonation/submit
curl -s -X POST -H 'Content-Type: application/json' -d '{}' -w "  POST without token -> %{http_code} (expect 403)\n" -o /dev/null http://127.0.0.1/datadonation/submit
echo "  container user: $(docker exec datadonation-api id -u) (expect 10001)"
echo ""
echo "--- Proxy addresses Caddy sees on /datadonation (to set XFF_TRUSTED_HOPS) ---"
tail -n 400 /var/log/caddy/access.log | python3 -c '
import sys, json, collections
c = collections.Counter()
for l in sys.stdin:
    try: j = json.loads(l)
    except Exception: continue
    r = j.get("request", {})
    if "/datadonation" in r.get("uri", ""):
        c[(r.get("remote_ip"), (r.get("headers", {}).get("X-Forwarded-For") or [None])[0])] += 1
for (ip, xff), n in c.most_common(6): print("  remote_ip=%s  X-Forwarded-For=%s  (%d reqs)" % (ip, xff, n))
' || true
echo ""
echo "Done. Paste the output above to Claude so XFF_TRUSTED_HOPS / Caddy trusted_proxies can be set."

for flag in "$@"; do
  case "$flag" in
    --encrypt-existing)
      echo "--- Encrypting existing plaintext donations (backup taken in step 1) ---"
      docker exec datadonation-api python donation_crypto.py encrypt-existing ;;
    --export-latest)
      echo "--- Exporting latest donation (still encrypted) to /home/$OWNER/latest-donation.json ---"
      docker exec datadonation-api python -c "
import sqlite3, json
c = sqlite3.connect('file:/data/donations.sqlite?mode=ro', uri=True)
r = c.execute('select id, platform, received_at, total_tables, total_rows, payload from donations order by id desc limit 1').fetchone()
print(json.dumps(dict(id=r[0], platform=r[1], received_at=r[2], total_tables=r[3], total_rows=r[4], payload=r[5])))
" > "/home/$OWNER/latest-donation.json"
      chown "$OWNER:$OWNER" "/home/$OWNER/latest-donation.json"; chmod 0600 "/home/$OWNER/latest-donation.json"
      python3 -c "import json;d=json.load(open('/home/$OWNER/latest-donation.json'));print('  id=%s platform=%s total_rows=%s payload_prefix=%s' % (d['id'],d['platform'],d['total_rows'],d['payload'][:7]))" ;;
    --revoke)
      rm -f /etc/sudoers.d/90-datadonation-deploy
      echo "Revoked: /etc/sudoers.d/90-datadonation-deploy removed." ;;
  esac
done

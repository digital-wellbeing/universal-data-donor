#!/usr/bin/env bash
set -euo pipefail

# Publish the Universal Data Donor and wire it into the system Caddy. Run as root
# on surrey-vps:
#
#     sudo bash ~/deploy-datadonation.sh
#
# Does three things, all idempotent + reversible:
#   1. Publishes the static frontend to /srv/datadonation (Caddy serves it).
#   2. Builds/starts the submission API container (Flask + SQLite) on
#      127.0.0.1:8083, storing donations in /srv/datadonation-data.
#   3. Adds Caddy routes for the static site and the /datadonation/submit API.
# The ESMira container is never touched; the Caddyfile is backed up before edits.

STAGING="${STAGING:-$HOME/datadonation-staging}"
[ -d "$STAGING" ] || STAGING="/home/${SUDO_USER:-tf0011}/datadonation-staging"
API_DIR="${API_DIR:-$HOME/datadonation-api}"
[ -d "$API_DIR" ] || API_DIR="/home/${SUDO_USER:-tf0011}/datadonation-api"
DEST=/srv/datadonation
DATA_DIR=/srv/datadonation-data
CADDYFILE=/etc/caddy/Caddyfile
STAMP="$(date +%Y%m%d-%H%M%S)"

echo "=== Staging: $STAGING   API dir: $API_DIR ==="
[ -f "$STAGING/index.html" ] || { echo "ABORT: $STAGING/index.html not found (rsync the frontend build first)." >&2; exit 1; }

echo "=== [1/3] Publishing static frontend to $DEST ==="
mkdir -p "$DEST"
rsync -a --delete --exclude='aw-test.json' "$STAGING"/ "$DEST"/
chown -R caddy:caddy "$DEST"
chmod -R a+rX "$DEST"

echo "=== [2/3] Building + starting the submission API ==="
mkdir -p "$DATA_DIR"
ENV_FILE="$API_DIR/datadonation-api.env"
if [ ! -f "$ENV_FILE" ]; then
  SALT="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  cat > "$ENV_FILE" <<EOF
# Cloudflare Turnstile SECRET. Default = Cloudflare TEST secret (EVERY token passes).
# Replace with your real secret for production, then re-run this script.
TURNSTILE_SECRET=1x0000000000000000000000000000000AA
# Optional hardening (recommended for prod; blank = not enforced). The widget
# sends action="donate"; restrict tokens to your real hostname.
TURNSTILE_ACTION=
TURNSTILE_HOSTNAMES=
IP_SALT=$SALT
RATE_MAX=5
RATE_WINDOW=3600
MAX_BYTES=26214400
EOF
  echo "    created $ENV_FILE (TEST Turnstile secret + random IP_SALT — edit for prod)"
else
  echo "    keeping existing $ENV_FILE (your keys are preserved across redeploys)"
fi
( cd "$API_DIR" && docker compose up -d --build )
echo "    waiting for API health…"
for i in $(seq 1 15); do
  if curl -sf -o /dev/null http://127.0.0.1:8083/datadonation/submit; then echo "    API healthy on 127.0.0.1:8083"; break; fi
  sleep 1
  [ "$i" = "15" ] && { echo "ABORT: API did not become healthy; check 'cd $API_DIR && docker compose logs'." >&2; exit 1; }
done

echo "=== [3/3] Wiring Caddy routes ==="
need_reload=0
insert_block() {  # $1 = awk program that prints the new file
  cp -a "$CADDYFILE" "${CADDYFILE}.bak.${STAMP}"
  local tmp; tmp="$(mktemp)"
  awk "$1" "$CADDYFILE" > "$tmp"
  caddy validate --adapter caddyfile --config "$tmp"
  install -m 0644 "$tmp" "$CADDYFILE"
  rm -f "$tmp"
  need_reload=1
}

if grep -q '/datadonation/submit' "$CADDYFILE"; then
  echo "    submit route already present"
else
  echo "    adding /datadonation/submit -> 127.0.0.1:8083"
  insert_block '
    !done && $0 ~ /^:80[[:space:]]*\{/ {
      print
      print "\t# --- Universal Data Donor: submission API (bot-gated) ---"
      print "\thandle /datadonation/submit {"
      print "\t\treverse_proxy 127.0.0.1:8083"
      print "\t}"
      print ""
      done=1
      next
    }
    { print }
  '
fi

if ! grep -q '/datadonation/\*' "$CADDYFILE" && ! grep -q 'handle_path /datadonation' "$CADDYFILE"; then
  echo "    adding static /datadonation/* -> /srv/datadonation"
  insert_block '
    !done && $0 ~ /^:80[[:space:]]*\{/ {
      print
      print "\t# --- Universal Data Donor (static React SPA) at /datadonation/* ---"
      print "\thandle /datadonation {"
      print "\t\tredir * /datadonation/?{query} 308"
      print "\t}"
      print "\thandle_path /datadonation/* {"
      print "\t\troot * /srv/datadonation"
      print "\t\ttry_files {path} /index.html"
      print "\t\tfile_server"
      print "\t}"
      print ""
      done=1
      next
    }
    { print }
  '
else
  echo "    static route already present"
fi

if [ "$need_reload" = "1" ]; then
  echo "    reloading Caddy"
  systemctl reload caddy
else
  echo "    no Caddy change needed"
fi

echo ""
echo "=== Verifying ==="
sleep 1
curl -s  -o /dev/null -w "  GET  /datadonation/submit (health) -> %{http_code} (expect 200)\n" http://127.0.0.1/datadonation/submit
curl -sL -o /dev/null -w "  GET  /datadonation/            -> %{http_code} (expect 200)\n" http://127.0.0.1/datadonation/
echo ""
echo "Deploy complete. App: https://iemabot.surrey.ac.uk/datadonation"
echo "Donations DB: $DATA_DIR/donations.sqlite"
echo "NOTE: until you set a real TURNSTILE_SECRET in $ENV_FILE (and a real"
echo "      sitekey in the frontend configs), the TEST captcha accepts everyone."

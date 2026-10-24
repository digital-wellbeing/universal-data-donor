#!/usr/bin/env bash
set -euo pipefail

# Deploy the Universal Data Donor as two containers (docker-compose.yml):
#   datadonation-web  static React SPA  -> 127.0.0.1:8084
#   datadonation-api  submission API    -> 127.0.0.1:8083
# and point the system Caddy at them. Runs on surrey-vps from the checkout in
# ~/datadonation, normally via /usr/local/sbin/datadonation-deploy (which the
# self-hosted runner calls after a signed push to `production`):
#
#     sudo bash ~/datadonation/deploy-datadonation.sh     # first run / Caddy change
#
# Routine redeploys need no root: the tf0011 account runs docker. Root is only
# needed to create the data dir and to edit/reload Caddy, and the script says
# when that is the case. Idempotent; the Caddyfile is backed up before edits
# and the ESMira container is never touched.

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OWNER="${SUDO_USER:-$(id -un)}"
OWNER_HOME="$(getent passwd "$OWNER" | cut -d: -f6)"
ENV_FILE="$APP_DIR/server/datadonation-api.env"
LEGACY_API_DIR="$OWNER_HOME/datadonation-api"
DATA_DIR="${DATA_DIR:-/srv/datadonation-data}"
WEB_PORT="${WEB_PORT:-8084}"
API_PORT="${API_PORT:-8083}"
CADDYFILE=/etc/caddy/Caddyfile
STAMP="$(date +%Y%m%d-%H%M%S)"
IS_ROOT=0; [ "$(id -u)" = "0" ] && IS_ROOT=1
export DATA_DIR WEB_PORT API_PORT

echo "=== Source: $APP_DIR ($(cat "$APP_DIR/REVISION" 2>/dev/null || echo 'revision unknown')) ==="
[ -f "$APP_DIR/docker-compose.yml" ] || { echo "ABORT: $APP_DIR/docker-compose.yml not found." >&2; exit 1; }

echo "=== [1/4] Config + data dir ==="
if [ ! -f "$ENV_FILE" ] && [ -f "$LEGACY_API_DIR/datadonation-api.env" ]; then
  # One-time move from the pre-container layout (~/datadonation-api).
  cp -p "$LEGACY_API_DIR/datadonation-api.env" "$ENV_FILE"
  echo "    copied existing keys from $LEGACY_API_DIR/datadonation-api.env"
elif [ ! -f "$ENV_FILE" ]; then
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
XFF_TRUSTED_HOPS=0
EOF
  echo "    created $ENV_FILE (TEST Turnstile secret + random IP_SALT — edit for prod)"
else
  echo "    keeping existing $ENV_FILE"
fi
chmod 0600 "$ENV_FILE"
[ "$IS_ROOT" = "1" ] && chown "$OWNER:$OWNER" "$ENV_FILE"

if [ ! -d "$DATA_DIR" ]; then
  [ "$IS_ROOT" = "1" ] || { echo "ABORT: $DATA_DIR does not exist; re-run with sudo to create it." >&2; exit 1; }
  install -d -m 0700 -o 10001 -g 10001 "$DATA_DIR"
  echo "    created $DATA_DIR (owned by the container uid 10001)"
fi

echo "=== [2/4] Building + starting containers ==="
cd "$APP_DIR"
# Build first so the old API keeps serving while images compile.
docker compose build
# The pre-container layout ran the API from a different compose project under
# the same container name; remove it so this project can take the name over.
legacy_project="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.project" }}' datadonation-api 2>/dev/null || true)"
if [ -n "$legacy_project" ] && [ "$legacy_project" != "datadonation" ]; then
  echo "    replacing legacy API container (compose project '$legacy_project')"
  docker rm -f datadonation-api >/dev/null
fi
docker compose up -d --remove-orphans
echo "    waiting for health…"
for i in $(seq 1 30); do
  if curl -sf -o /dev/null "http://127.0.0.1:$API_PORT/datadonation/submit" \
     && curl -sf -o /dev/null "http://127.0.0.1:$WEB_PORT/"; then
    echo "    web on 127.0.0.1:$WEB_PORT and API on 127.0.0.1:$API_PORT are healthy"; break
  fi
  sleep 2
  [ "$i" = "30" ] && { echo "ABORT: containers did not become healthy; check 'docker compose logs' in $APP_DIR." >&2; exit 1; }
done

echo "=== [3/4] Caddy routes ==="
# Prints the Caddyfile as it should be, or nothing if it is already correct.
desired_caddyfile() {
  python3 - "$CADDYFILE" "$WEB_PORT" "$API_PORT" <<'PY'
import re, sys
path, web, api = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
out = src
if not re.search(r"^:80[ \t]*\{\n", out, re.M):
    sys.exit("no ':80 {' site block in " + path)

def insert(block):
    global out
    m = re.search(r"^:80[ \t]*\{\n", out, re.M)
    out = out[:m.end()] + block + out[m.end():]

if "/datadonation/submit" not in out:
    insert("\t# --- Universal Data Donor: submission API (bot-gated) ---\n"
           "\thandle /datadonation/submit {\n"
           f"\t\treverse_proxy 127.0.0.1:{api}\n"
           "\t}\n\n")

m = re.search(r"(\thandle_path /datadonation/\* \{\n)(.*?)(\n\t\})", out, re.S)
if m:
    # Swap static file serving for the web container; keep everything else in
    # the block (e.g. "import ddsec" added by deploy/harden-host.sh).
    serving = re.compile(r"\s*(root \* /srv/datadonation|try_files \{path\} /index\.html|file_server|reverse_proxy \S+)\s*$")
    lines = [l for l in m.group(2).split("\n") if not serving.match(l)]
    lines.append(f"\t\treverse_proxy 127.0.0.1:{web}")
    out = out[:m.start(2)] + "\n".join(lines) + out[m.end(2):]
else:
    insert("\t# --- Universal Data Donor (React SPA container) at /datadonation/* ---\n"
           "\thandle /datadonation {\n"
           "\t\tredir * /datadonation/?{query} 308\n"
           "\t}\n"
           "\thandle_path /datadonation/* {\n"
           f"\t\treverse_proxy 127.0.0.1:{web}\n"
           "\t}\n\n")

if out != src:
    sys.stdout.write(out)
PY
}

new_caddyfile="$(desired_caddyfile)"
if [ -z "$new_caddyfile" ]; then
  echo "    Caddy already routes /datadonation to the containers"
elif [ "$IS_ROOT" != "1" ]; then
  echo "    Caddy still needs to be pointed at the containers (until then it keeps"
  echo "    serving the old static copy in /srv/datadonation). Run once as root:"
  echo "        sudo bash $APP_DIR/deploy-datadonation.sh"
  exit 2
else
  tmp="$(mktemp)"
  printf '%s\n' "$new_caddyfile" > "$tmp"
  caddy validate --adapter caddyfile --config "$tmp" >/dev/null
  cp -a "$CADDYFILE" "${CADDYFILE}.bak.${STAMP}"
  install -m 0644 "$tmp" "$CADDYFILE"
  rm -f "$tmp"
  systemctl reload caddy
  echo "    updated + reloaded Caddy (backup: ${CADDYFILE}.bak.${STAMP})"
fi

# Old copies of the deploy/harden scripts in the home dir act on the
# pre-container layout; turn them into wrappers around this tree's versions.
if [ "$IS_ROOT" = "1" ]; then
  for pair in "deploy-datadonation.sh:deploy-datadonation.sh" "harden-datadonation.sh:deploy/harden-host.sh"; do
    old="$OWNER_HOME/${pair%%:*}"; new="$APP_DIR/${pair#*:}"
    [ "$old" = "$new" ] && continue
    if [ -f "$old" ] && ! grep -q 'datadonation-wrapper' "$old"; then
      mv "$old" "$old.legacy-$STAMP"
      printf '#!/usr/bin/env bash\n# datadonation-wrapper: the real script lives in the synced source tree.\nexec bash %q "$@"\n' "$new" > "$old"
      chown "$OWNER:$OWNER" "$old" "$old.legacy-$STAMP"
      echo "    $old now runs $new (old copy kept as $old.legacy-$STAMP)"
    fi
  done
fi

echo "=== [4/4] Verifying ==="
sleep 1
curl -s  -o /dev/null -w "  GET /datadonation/submit (health) -> %{http_code} (expect 200)\n" http://127.0.0.1/datadonation/submit
curl -sL -o /dev/null -w "  GET /datadonation/                -> %{http_code} (expect 200)\n" http://127.0.0.1/datadonation/
docker compose ps --format '  {{.Name}}: {{.Status}}'
echo ""
echo "Deploy complete. App: https://iemabot.surrey.ac.uk/datadonation"
echo "Donations DB: $DATA_DIR/donations.sqlite"
echo "Rollback to static serving: restore the newest ${CADDYFILE}.bak.* and 'systemctl reload caddy'."

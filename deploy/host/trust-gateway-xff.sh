#!/usr/bin/env bash
set -euo pipefail

# Let the donation API see REAL client IPs (needed for per-client rate limiting).
#
# Problem: the host sits behind a gateway, so Caddy's socket peer is always the
# gateway's internal address. Caddy then overwrites X-Forwarded-For with that
# address, the API keys its rate limit on it, and every participant shares one
# bucket (verified: the stored rate-limit hash equals the hash of the gateway
# address, not of any client).
#
# Fix: tell Caddy to trust X-Forwarded-For from the gateway's subnet only. Caddy
# then keeps the gateway's header and appends the gateway address, so the API
# receives "<client>[:port], <gateway>" and, with XFF_TRUSTED_HOPS=1, picks the
# entry just left of the gateway: the address the gateway itself recorded, which
# a client cannot forge. (Anything a client puts in its own X-Forwarded-For sits
# further left and is ignored.)
#
#     sudo bash deploy/host/trust-gateway-xff.sh
#
# Then, in the API env file (host-only): XFF_TRUSTED_HOPS=1 and a real RATE_MAX
# (5-10), and redeploy. Safe to re-run: it does nothing once configured.
#
# Overrides (for testing): CADDYFILE, GATEWAY_CIDR, CADDY_BIN, RELOAD_CMD.

CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
GATEWAY_CIDR="${GATEWAY_CIDR:-172.22.1.0/24}"
CADDY_BIN="${CADDY_BIN:-caddy}"
RELOAD_CMD="${RELOAD_CMD:-systemctl reload caddy}"
die() { echo "trust-gateway-xff: $*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || [ -n "${ALLOW_NON_ROOT:-}" ] || die "run as root (sudo)."
[ -f "$CADDYFILE" ] || die "$CADDYFILE not found."

if grep -Eq '^[[:space:]]*trusted_proxies[[:space:]]' "$CADDYFILE"; then
  echo "Already configured: $CADDYFILE contains trusted_proxies. Nothing to do."
  exit 0
fi

# A global options block must be the FIRST block of a Caddyfile. If one already
# exists, merging into it is a manual decision.
first="$(grep -Ev '^[[:space:]]*(#.*)?$' "$CADDYFILE" | head -1)"
case "$first" in
  "{"*) die "$CADDYFILE already starts with a global options block. Add this inside it instead:
    servers {
        trusted_proxies static $GATEWAY_CIDR
    }" ;;
esac

backup="$CADDYFILE.bak.$(date +%Y%m%d-%H%M%S)"
new="$(mktemp)"
trap 'rm -f "$new"' EXIT
{
  printf '# Trust X-Forwarded-For only from the gateway so the API sees real client IPs\n'
  printf '# (added by deploy/host/trust-gateway-xff.sh).\n'
  printf '{\n\tservers {\n\t\ttrusted_proxies static %s\n\t}\n}\n\n' "$GATEWAY_CIDR"
  cat "$CADDYFILE"
} > "$new"

"$CADDY_BIN" validate --config "$new" --adapter caddyfile >/dev/null 2>&1 \
  || die "the new config does not validate; nothing was changed."

cp -p "$CADDYFILE" "$backup"
install -m 0644 "$new" "$CADDYFILE"
if ! $RELOAD_CMD; then
  cp -p "$backup" "$CADDYFILE"
  die "reload failed; the previous Caddyfile was restored from $backup."
fi

echo "Done. Caddy now trusts X-Forwarded-For from $GATEWAY_CIDR. Backup: $backup"
echo "Roll back with:  sudo cp -p $backup $CADDYFILE && sudo $RELOAD_CMD"
echo "Verify: make one request, then  sudo tail -n 1 /var/log/caddy/access.log  and check that"
echo "request.headers[\"X-Forwarded-For\"] now holds the client address followed by the gateway's."

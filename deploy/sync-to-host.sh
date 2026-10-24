#!/usr/bin/env bash
set -euo pipefail

# Ship the committed tree (HEAD) to the host and redeploy the containers.
# Run from a checkout on your machine:
#
#     deploy/sync-to-host.sh [ssh-host]        # default host: iema-ts
#
# Only committed files are sent (git archive), so local builds, node_modules and
# secrets never leave this machine. The host keeps its own
# server/datadonation-api.env, which the sync never overwrites or deletes.

HOST="${1:-iema-ts}"
REMOTE_DIR="${REMOTE_DIR:-datadonation}"   # relative to the remote home dir

cd "$(git rev-parse --show-toplevel)"
if ! git diff --quiet HEAD; then
  echo "WARNING: uncommitted changes are NOT shipped; deploying HEAD ($(git rev-parse --short HEAD))." >&2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git archive HEAD | tar -x -C "$TMP"
git rev-parse --short HEAD > "$TMP/REVISION"

ssh "$HOST" "mkdir -p ~/$REMOTE_DIR"
rsync -az --delete --exclude /server/datadonation-api.env "$TMP"/ "$HOST:$REMOTE_DIR/"
echo "Synced $(cat "$TMP/REVISION") to $HOST:~/$REMOTE_DIR — redeploying…"

# Exit code 2 means the containers are up but Caddy still needs a one-time
# root change; the remote script prints the sudo command to run.
ssh -t "$HOST" "bash ~/$REMOTE_DIR/deploy-datadonation.sh"

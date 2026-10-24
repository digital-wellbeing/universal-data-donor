#!/usr/bin/env bash
set -euo pipefail

# One-time setup of the self-hosted GitHub Actions runner that deploys the
# data-donation app on surrey-vps. Run as root from a checkout of this repo:
#
#     sudo bash deploy/host/install-runner.sh
#
# You will be asked for a runner registration token. Create one at
#   GitHub -> digital-wellbeing/universal-data-donor -> Settings -> Actions
#   -> Runners -> New self-hosted runner   (valid for 1 hour, used once)
#
# Security model (see README "Deployment"):
#   * The runner runs as a dedicated, unprivileged user (ghrunner): no docker
#     group, no login shell, no sudo except ONE rule.
#   * That rule lets ghrunner run /usr/local/sbin/datadonation-deploy, a
#     root-owned copy of deploy/host/datadonation-deploy, as the deploy user,
#     never as root. The wrapper fetches the public repo itself and only
#     deploys the current tip of `production`, and only if that commit is
#     signed by a key in /etc/datadonation/allowed_signers (root-owned, set
#     here). GitHub permissions alone can't get code onto this host.
#   * The runner has a single custom label and no default labels, so only
#     workflows that ask for exactly `datadonation-deploy` are routed to it.
# Re-running is safe; to change the wrapper, re-run this script (a human with
# sudo is the only way the privileged entry point can change).

RUNNER_VERSION="2.338.1"
RUNNER_SHA256="08e9ccb3604d2462c24b5e33604dc30810296ca15cc65f23cffd4317eb144c37"  # linux-x64
REPO_URL="https://github.com/digital-wellbeing/universal-data-donor"
RUNNER_USER="ghrunner"
RUNNER_DIR="/opt/actions-runner"
RUNNER_NAME="${RUNNER_NAME:-iemabot-datadonation}"
RUNNER_LABEL="datadonation-deploy"
DEPLOY_USER="${DEPLOY_USER:-${SUDO_USER:-tf0011}}"
APP_DIR="${APP_DIR:-$(getent passwd "$DEPLOY_USER" | cut -d: -f6)/datadonation}"
WRAPPER=/usr/local/sbin/datadonation-deploy
ALLOWED_SIGNERS=/etc/datadonation/allowed_signers
SUDOERS=/etc/sudoers.d/datadonation-runner
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

[ "$(id -u)" = "0" ] || { echo "Run as root (sudo)." >&2; exit 1; }
[ "$(uname -m)" = "x86_64" ] || { echo "This script pins the linux-x64 runner; got $(uname -m)." >&2; exit 1; }
id "$DEPLOY_USER" >/dev/null 2>&1 || { echo "Deploy user $DEPLOY_USER does not exist." >&2; exit 1; }
id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker || { echo "$DEPLOY_USER must be in the docker group." >&2; exit 1; }
command -v git >/dev/null || { echo "git is required." >&2; exit 1; }

echo "=== [1/5] Runner user ($RUNNER_USER) ==="
if ! id "$RUNNER_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "/var/lib/$RUNNER_USER" --shell /usr/sbin/nologin "$RUNNER_USER"
fi
# Must not be able to talk to dockerd (root-equivalent) or use sudo broadly.
if id -nG "$RUNNER_USER" | tr ' ' '\n' | grep -qxE 'docker|sudo|adm|wheel'; then
  echo "ABORT: $RUNNER_USER is in a privileged group ($(id -nG "$RUNNER_USER")); remove it first." >&2; exit 1
fi

echo "=== [2/5] Deploy wrapper ($WRAPPER) + allowed signer ==="
# The public half of the owner's commit-signing key (e.g. ~/.ssh/id_ed25519.pub
# on the machine you run deploy/promote.sh from). Paste it, or pass
# SIGNER_PUBKEY="ssh-ed25519 AAAA... comment". Re-running keeps the existing file.
if [ ! -s "$ALLOWED_SIGNERS" ] || [ -n "${SIGNER_PUBKEY:-}" ]; then
  if [ -z "${SIGNER_PUBKEY:-}" ]; then
    read -r -p "    Paste your SSH signing PUBLIC key (ssh-ed25519 AAAA...): " SIGNER_PUBKEY
  fi
  [[ "$SIGNER_PUBKEY" =~ ^(ssh-ed25519|sk-ssh-ed25519@openssh.com|ecdsa-sha2-nistp256|ssh-rsa)\ [A-Za-z0-9+/=]+ ]] \
    || { echo "ABORT: that does not look like an SSH public key." >&2; exit 1; }
  install -d -o root -g root -m 0755 "$(dirname "$ALLOWED_SIGNERS")"
  printf 'owner namespaces="git" %s\n' "$SIGNER_PUBKEY" > "$ALLOWED_SIGNERS.tmp"
  install -o root -g root -m 0644 "$ALLOWED_SIGNERS.tmp" "$ALLOWED_SIGNERS"
  rm -f "$ALLOWED_SIGNERS.tmp"
fi
echo "    allowed signer: $(ssh-keygen -lf <(cut -d' ' -f3- "$ALLOWED_SIGNERS"))"
tmp="$(mktemp)"
sed -e "s|@DEPLOY_USER@|$DEPLOY_USER|" -e "s|@APP_DIR@|$APP_DIR|" "$SRC_DIR/datadonation-deploy" > "$tmp"
install -o root -g root -m 0755 "$tmp" "$WRAPPER"
rm -f "$tmp"
printf '# Managed by deploy/host/install-runner.sh\n%s ALL=(%s) NOPASSWD: %s\n' \
  "$RUNNER_USER" "$DEPLOY_USER" "$WRAPPER" > "$SUDOERS.tmp"
visudo -cf "$SUDOERS.tmp" >/dev/null
install -o root -g root -m 0440 "$SUDOERS.tmp" "$SUDOERS"
rm -f "$SUDOERS.tmp"
echo "    $RUNNER_USER may run only: sudo -u $DEPLOY_USER $WRAPPER [<sha>]"

echo "=== [3/5] Runner $RUNNER_VERSION in $RUNNER_DIR ==="
if [ ! -x "$RUNNER_DIR/config.sh" ] || ! grep -q "$RUNNER_VERSION" "$RUNNER_DIR/.runner-version" 2>/dev/null; then
  install -d -o "$RUNNER_USER" -g "$RUNNER_USER" -m 0750 "$RUNNER_DIR"
  tarball="$(mktemp)"
  curl -fsSL -o "$tarball" "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"
  echo "$RUNNER_SHA256  $tarball" | sha256sum -c --quiet - || { echo "ABORT: runner checksum mismatch." >&2; exit 1; }
  # Extract as root (mktemp made the tarball root-only), then hand it over.
  tar -xzf "$tarball" -C "$RUNNER_DIR"
  chown -R "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"
  chmod 0750 "$RUNNER_DIR"   # the tarball's "./" entry resets it to 0755
  rm -f "$tarball"
  echo "$RUNNER_VERSION" | sudo -u "$RUNNER_USER" tee "$RUNNER_DIR/.runner-version" >/dev/null
  "$RUNNER_DIR/bin/installdependencies.sh" >/dev/null
fi

echo "=== [4/5] Register with GitHub ==="
if [ -f "$RUNNER_DIR/.runner" ]; then
  echo "    already registered ($(grep -o '"agentName": *"[^"]*"' "$RUNNER_DIR/.runner" | cut -d'"' -f4))"
else
  read -r -s -p "    Runner registration token (input hidden): " TOKEN; echo
  [ -n "$TOKEN" ] || { echo "ABORT: no token." >&2; exit 1; }
  ( cd "$RUNNER_DIR" && sudo -u "$RUNNER_USER" ./config.sh --unattended \
      --url "$REPO_URL" --token "$TOKEN" --name "$RUNNER_NAME" \
      --labels "$RUNNER_LABEL" --no-default-labels --work _work --replace )
  unset TOKEN
fi

echo "=== [5/5] systemd service ==="
cd "$RUNNER_DIR"
unit="$(cat .service 2>/dev/null || true)"
if [ -z "$unit" ]; then
  ./svc.sh install "$RUNNER_USER" >/dev/null
  unit="$(cat .service)"
fi
# Hardening that stays compatible with the one sudo hop the job needs.
mkdir -p "/etc/systemd/system/$unit.d"
cat > "/etc/systemd/system/$unit.d/hardening.conf" <<'EOF'
[Service]
PrivateTmp=yes
ProtectSystem=full
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictNamespaces=yes
RestrictRealtime=yes
LockPersonality=yes
UMask=0027
EOF
systemctl daemon-reload
systemctl enable --now "$unit" >/dev/null
systemctl restart "$unit"
sleep 3
systemctl is-active --quiet "$unit" && echo "    $unit is running" || { echo "ABORT: $unit failed; see journalctl -u $unit" >&2; exit 1; }

cat <<EOF

Runner installed. Remaining one-time GitHub settings (repo Settings):
  * Branches: protect `production` (restrict pushes to you, no force
    pushes, no deletion).
  * Environments -> iemabot-production: deployment branches = `production`.
  * Actions -> General -> "Fork pull request workflows from outside
    collaborators": Require approval for all outside collaborators.
Deploy: run deploy/promote.sh on your machine (signed push to production).
Manual deploy on this host (rollback allowed): sudo -u $DEPLOY_USER $WRAPPER [<sha>]
EOF

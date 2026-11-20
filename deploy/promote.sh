#!/usr/bin/env bash
set -euo pipefail

# Promote a commit of main to the `production` branch and push it, which makes
# the self-hosted runner deploy it to iemabot.surrey.ac.uk/datadonation.
#
#     deploy/promote.sh               # promote the current origin/main
#     deploy/promote.sh <commit>      # promote (or roll back to) a main commit
#
# The new production commit has exactly the tree of the chosen main commit,
# the previous production tip as parent, and YOUR SSH signature. The host
# refuses to deploy anything not signed by the key in its allowed-signers file,
# so only this script, run by you, can deploy. Your working tree is untouched.
#
# One-time setup (SSH commit signing; git >= 2.34):
#     git config --global gpg.format ssh
#     git config --global user.signingkey ~/.ssh/id_ed25519.pub

REMOTE="${REMOTE:-origin}"
SRC="${1:-$REMOTE/main}"
die() { echo "promote: $*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"
[ "$(git config --get gpg.format || true)" = "ssh" ] || die "SSH signing is not set up (see the header of this script)."
signingkey="$(git config --get user.signingkey || true)"
[ -n "$signingkey" ] || die "user.signingkey is not set (see the header of this script)."

# Fetch into explicit remote-tracking refs. A plain `git fetch origin production`
# only updates refs/remotes/origin/production when the clone's fetch refspec
# covers it, and a single-branch clone (main only) never does: the ref then goes
# stale after each promote, the next deploy commit is built on an old parent and
# the push is rejected as a non-fast-forward. (See deploy/promote.test.sh.)
git fetch --quiet "$REMOTE" "+refs/heads/main:refs/remotes/$REMOTE/main"
if git ls-remote --exit-code --heads "$REMOTE" production >/dev/null 2>&1; then
  git fetch --quiet "$REMOTE" "+refs/heads/production:refs/remotes/$REMOTE/production" \
    || die "could not fetch $REMOTE/production"
fi
src="$(git rev-parse --verify --quiet "$SRC^{commit}")" || die "unknown commit: $SRC"
git merge-base --is-ancestor "$src" "$REMOTE/main" || die "$SRC is not on $REMOTE/main"

parents=()
if prod="$(git rev-parse --verify --quiet "refs/remotes/$REMOTE/production")"; then
  [ "$(git rev-parse "$prod^{tree}")" != "$(git rev-parse "$src^{tree}")" ] \
    || die "production already has exactly main@${src:0:12}'s tree; nothing to deploy"
  parents+=(-p "$prod")
fi
parents+=(-p "$src")

msg="deploy: main@${src:0:12}

$(git log -1 --format='%s' "$src")"
new="$(git commit-tree -S "${parents[@]}" -m "$msg" "$src^{tree}")"

# Check the signature locally the same way the host does before pushing.
case "$signingkey" in
  key::*) pub="${signingkey#key::}" ;;
  ssh-*)  pub="$signingkey" ;;
  *)      pub="$(cat "${signingkey/#\~/$HOME}")" ;;
esac
signers="$(mktemp)"; trap 'rm -f "$signers"' EXIT
printf 'owner namespaces="git" %s\n' "$pub" > "$signers"
git -c gpg.ssh.allowedSignersFile="$signers" verify-commit "$new" 2>&1 \
  | grep -q '^Good "git" signature for ' || die "local signature check failed for $new"

echo "Promoting main@${src:0:12} -> production@${new:0:12} (signed)…"
git push "$REMOTE" "$new:refs/heads/production"
# A push does not update refs/remotes/$REMOTE/production when no fetch refspec maps it.
git update-ref "refs/remotes/$REMOTE/production" "$new"
echo "Pushed. The 'Deploy to iemabot' workflow is running now:"
echo "  gh run watch --repo digital-wellbeing/universal-data-donor \$(gh run list --repo digital-wellbeing/universal-data-donor --workflow deploy-vps.yml --limit 1 --json databaseId --jq '.[0].databaseId')"

#!/usr/bin/env bash
set -euo pipefail

# Regression test for deploy/promote.sh, run entirely in a throwaway sandbox
# (local bare remote, temporary SSH key; nothing touches GitHub or your keys):
#
#     bash deploy/promote.test.sh
#
# It reproduces the failure seen in a single-branch clone, whose fetch refspec
# only covers `main`: `refs/remotes/origin/production` is never updated, so the
# second promote built its deploy commit on a missing/stale parent and the push
# was rejected as a non-fast-forward.

here="$(cd "$(dirname "$0")" && pwd)"
promote="$here/promote.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Ignore the caller's git config (signing keys, hooks, aliases).
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com

fail() { echo "FAIL: $*" >&2; exit 1; }

ssh-keygen -q -t ed25519 -N '' -C test -f "$tmp/key"

git init -q --bare "$tmp/remote.git"
git init -q -b main "$tmp/seed"
commit() { (cd "$tmp/seed" && echo "$1" >> file && git add file && git commit -q -m "$1" && git push -q origin main); }
git -C "$tmp/seed" remote add origin "$tmp/remote.git"
commit one

# The maintainer's situation: a single-branch clone (fetch refspec = main only).
git clone -q --single-branch -b main "$tmp/remote.git" "$tmp/work"
[ "$(git -C "$tmp/work" config --get-all remote.origin.fetch)" = "+refs/heads/main:refs/remotes/origin/main" ] \
  || fail "sandbox clone is not single-branch"
git -C "$tmp/work" config gpg.format ssh
git -C "$tmp/work" config user.signingkey "$tmp/key.pub"

run_promote() { (cd "$tmp/work" && bash "$promote" "$@" >"$tmp/out" 2>&1) || { cat "$tmp/out" >&2; fail "promote.sh $* exited non-zero"; }; }

# 1. First ever promote: no production branch exists yet.
run_promote
first="$(git -C "$tmp/remote.git" rev-parse production)"
[ "$(git -C "$tmp/remote.git" rev-parse "$first^{tree}")" = "$(git -C "$tmp/remote.git" rev-parse main^{tree})" ] \
  || fail "first production commit does not have main's tree"

# 2. main moves on; promote again. This is the step that used to be rejected.
commit two
run_promote
second="$(git -C "$tmp/remote.git" rev-parse production)"
[ "$second" != "$first" ] || fail "production did not advance"
[ "$(git -C "$tmp/remote.git" rev-parse "$second^1")" = "$first" ] \
  || fail "second deploy commit is not built on the previous production tip"
[ "$(git -C "$tmp/remote.git" rev-parse "$second^{tree}")" = "$(git -C "$tmp/remote.git" rev-parse main^{tree})" ] \
  || fail "second production commit does not have main's tree"

# 3. The local bookkeeping ref follows the remote.
[ "$(git -C "$tmp/work" rev-parse refs/remotes/origin/production)" = "$second" ] \
  || fail "refs/remotes/origin/production is stale after promote"

# 4. Nothing new on main: promote must refuse rather than push an empty deploy.
if (cd "$tmp/work" && bash "$promote" >"$tmp/out" 2>&1); then fail "promote of an unchanged tree should refuse"; fi
grep -q "nothing to deploy" "$tmp/out" || { cat "$tmp/out" >&2; fail "unexpected refusal message"; }

echo "PASS: promote.sh survives a single-branch clone across consecutive promotes"

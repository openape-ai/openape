#!/usr/bin/env bash
# Restore proof (plan M7): pull the latest off-site snapshot onto THIS machine
# and clone a repo out of it. Uses nothing but the restic repo + password —
# no access to the forge VM — which is exactly the situation it must survive.
#
#   RESTIC_REPOSITORY=... RESTIC_PASSWORD_FILE=... ops/restore-probe.sh patrick/m6proof
set -euo pipefail

target=${1:?usage: restore-probe.sh <owner>/<name>}
owner=${target%%/*}
name=${target##*/}
dest=$(mktemp -d)

echo "== restoring latest snapshot into $dest"
restic restore latest --target "$dest"

bare=$(find "$dest" -type d -path "*/$owner/$name.git" | head -1)
[ -n "$bare" ] || { echo "FAIL: $target not found in the snapshot"; exit 1; }

echo "== registry from the backup"
sqlite3 "$(find "$dest" -name registry.db | head -1)" 'select owner, name, visibility from repos'

echo "== cloning $bare"
git clone "$bare" "$dest/clone"
git -C "$dest/clone" log --oneline -5
ls -la "$dest/clone"
echo "== restore probe OK ($dest)"

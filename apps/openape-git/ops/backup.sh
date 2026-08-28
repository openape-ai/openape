#!/usr/bin/env bash
# Daily off-site backup of the ape-git data volume (plan M7).
#
# Runs on the forge VM as the `ubuntu` user (it owns everything it touches —
# no root needed) from cron, and writes its outcome to backup-status.json,
# which /api/health/backup serves to monitor.openape.ai.
#
# Config comes from an env file sourced by cron, see ops/README.md:
#   RESTIC_REPOSITORY, RESTIC_PASSWORD_FILE, and whatever the backend needs.
set -euEo pipefail

DATA_DIR=${APE_GIT_DATA_DIR:-/srv/ape-git}
PROD_DIR=${APE_GIT_PROD_DIR:-/home/ubuntu/prod}
STATUS_FILE="$DATA_DIR/backup-status.json"
STAGE_DIR="$DATA_DIR/backup"

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY is not set}"

# $1 = true|false, $2 = snapshot id, $3 = error message (empty when ok)
write_status() {
  local err=null
  [ -n "${3:-}" ] && err="\"${3//\"/}\""
  printf '{"ok":%s,"finishedAt":"%s","snapshotId":"%s","error":%s}\n' \
    "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$2" "$err" > "$STATUS_FILE"
}

trap 'write_status false "" "backup.sh failed at line $LINENO"; exit 1' ERR

mkdir -p "$STAGE_DIR"

# A live SQLite file must not be copied byte-wise: .backup takes a consistent
# snapshot including the WAL, so the restored registry is never half-written.
sqlite3 "$DATA_DIR/registry.db" ".backup '$STAGE_DIR/registry.db'"

restic snapshots >/dev/null 2>&1 || restic init

# The prod env files ride along: without ci.env the restored forge would hold
# every repo but reject every webhook delivery. They are small and the restic
# repository is encrypted.
out=$(restic backup --host ape-git --tag ape-git \
  "$DATA_DIR/repos" "$STAGE_DIR/registry.db" "$PROD_DIR")
printf '%s\n' "$out"
snapshot=$(printf '%s' "$out" | sed -n 's/^snapshot \([0-9a-f]*\) saved$/\1/p' | tail -1)

restic forget --host ape-git --tag ape-git --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

write_status true "$snapshot" ""
echo "ape-git backup ok: snapshot ${snapshot:-unknown}"

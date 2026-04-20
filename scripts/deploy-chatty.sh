#!/usr/bin/env bash
#
# Deploy apps/openape-free-idp to chatty.delta-mind.at (id.openape.ai).
#
# Usage: ./scripts/deploy-chatty.sh
#
# Requires:
#   - SSH access to chatty.delta-mind.at (ssh alias in ~/.ssh/config)
#   - sudo on chatty for systemctl restart
#   - Local node/pnpm, run from the monorepo root
#
# Release layout on chatty:
#   ~/projects/openape-free-idp/
#     ├─ releases/<TS>/        timestamped, kept for rollback
#     ├─ current -> releases/<TS>/
#     └─ shared/.env           chmod 600, persistent across deploys
#
# Native-binding pin: @libsql/linux-x64-gnu must match libsql wrapper version.
# See the chatty deploy plan for the 0.4.7 pin rationale.

set -euo pipefail

HOST="${CHATTY_HOST:-chatty.delta-mind.at}"
BASE="${CHATTY_BASE:-/home/ubuntu/projects/openape-free-idp}"
TS=$(date -u +%Y-%m-%dT%H-%M-%S)

echo "→ Build .output locally"
pnpm turbo run build --filter openape-free-idp

echo "→ Rsync release to ${HOST}:${BASE}/releases/${TS}/"
rsync -az --delete \
  apps/openape-free-idp/.output/ \
  "${HOST}:${BASE}/releases/${TS}/"

echo "→ Pin matching linux-x64-gnu native binding (0.4.7)"
ssh "${HOST}" bash -s <<REMOTE
set -euo pipefail
cd /tmp
rm -rf libsql-pkg && mkdir libsql-pkg && cd libsql-pkg
npm pack @libsql/linux-x64-gnu@0.4.7 >/dev/null 2>&1
tar -xzf libsql-linux-x64-gnu-0.4.7.tgz
mkdir -p ${BASE}/releases/${TS}/server/node_modules/@libsql/linux-x64-gnu
cp package/* ${BASE}/releases/${TS}/server/node_modules/@libsql/linux-x64-gnu/
REMOTE

echo "→ Swap current symlink"
ssh "${HOST}" "ln -sfn ${BASE}/releases/${TS} ${BASE}/current"

echo "→ Restart systemd service"
ssh "${HOST}" "sudo systemctl restart openape-free-idp.service"

echo "→ Wait for socket + health"
ssh "${HOST}" "
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -o /dev/null http://127.0.0.1:3003/api/shapes; then echo 'up after '\$i's'; exit 0; fi
    sleep 1
  done
  echo 'health check failed after 10s'
  sudo journalctl -u openape-free-idp -n 30 --no-pager
  exit 1
"

echo "→ Prune old releases (keep last 3)"
ssh "${HOST}" "ls -1t ${BASE}/releases/ | tail -n +4 | xargs -r -I{} rm -rf ${BASE}/releases/{}"

echo
echo "✓ Deployed ${TS} to https://id.openape.ai"

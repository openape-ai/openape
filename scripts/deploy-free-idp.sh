#!/usr/bin/env bash
#
# Deploy apps/openape-free-idp to chatty.delta-mind.at (id.openape.ai).
#
# Usage: ./scripts/deploy-free-idp.sh
#
# Requires:
#   - SSH access to chatty.delta-mind.at as the service user (default: openape).
#     Configure via ~/.ssh/config "Host chatty" with "User openape", or override
#     via CHATTY_HOST. The GitHub Actions deploy-free-idp workflow sets that up
#     from repo secrets.
#   - Passwordless sudo on the host for `systemctl restart openape-free-idp.service`
#     (installed in /etc/sudoers.d/openape-free-idp, scoped to user openape).
#   - Local node/pnpm, run from the monorepo root.
#
# Release layout on the host:
#   /home/openape/projects/openape-free-idp/
#     ├─ releases/<TS>/        timestamped, kept for rollback (last 3)
#     ├─ current -> releases/<TS>/
#     └─ shared/.env           chmod 600, persistent across deploys
#
# Native-binding pin: @libsql/linux-x64-gnu must match libsql wrapper version.
# See the deploy plan for the 0.4.7 pin rationale.

set -euo pipefail

HOST="${CHATTY_HOST:-chatty.delta-mind.at}"
BASE="${CHATTY_BASE:-/home/openape/projects/openape-free-idp}"
TS=$(date -u +%Y-%m-%dT%H-%M-%S)

echo "→ Build .output locally"
pnpm turbo run build --filter openape-free-idp

echo "→ Rsync release to ${HOST}:${BASE}/releases/${TS}/"
rsync -az --delete \
  apps/openape-free-idp/.output/ \
  "${CHATTY_USER:-openape}@${HOST}:${BASE}/releases/${TS}/"

echo "→ Pin matching linux-x64-gnu native binding (0.4.7)"
ssh -l "${CHATTY_USER:-openape}" "${HOST}" bash -s <<REMOTE
set -euo pipefail
cd /tmp
rm -rf libsql-pkg && mkdir libsql-pkg && cd libsql-pkg
npm pack @libsql/linux-x64-gnu@0.4.7 >/dev/null 2>&1
tar -xzf libsql-linux-x64-gnu-0.4.7.tgz
mkdir -p ${BASE}/releases/${TS}/server/node_modules/@libsql/linux-x64-gnu
cp package/* ${BASE}/releases/${TS}/server/node_modules/@libsql/linux-x64-gnu/
REMOTE

echo "→ Swap current symlink"
ssh -l "${CHATTY_USER:-openape}" "${HOST}" "ln -sfn ${BASE}/releases/${TS} ${BASE}/current"

echo "→ Restart systemd service"
ssh -l "${CHATTY_USER:-openape}" "${HOST}" "sudo systemctl restart openape-free-idp.service"

echo "→ Wait for socket + health"
ssh -l "${CHATTY_USER:-openape}" "${HOST}" "
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fsS -o /dev/null http://127.0.0.1:3003/api/shapes; then echo 'up after '\$i's'; exit 0; fi
    sleep 1
  done
  echo 'health check failed after 10s'
  sudo journalctl -u openape-free-idp -n 30 --no-pager
  exit 1
"

echo "→ Prune old releases (keep last 3)"
ssh -l "${CHATTY_USER:-openape}" "${HOST}" "ls -1t ${BASE}/releases/ | tail -n +4 | xargs -r -I{} rm -rf ${BASE}/releases/{}"

echo
echo "✓ Deployed ${TS} to https://id.openape.ai"

#!/usr/bin/env bash
#
# Deploy apps/openape-tribe to the deploy host.delta-mind.at (tribe.openape.ai).
#
# Usage: ./scripts/deploy-tribe.sh
#
# Requires:
#   - SSH access to the deploy host.delta-mind.at as the service user (default: openape).
#     Configure via ~/.ssh/config "Host chatty" with "User openape", or override
#     via CHATTY_HOST.
#   - Passwordless sudo on the host for `systemctl restart openape-tribe.service`
#     (drop a /etc/sudoers.d/openape-tribe fragment scoped to user openape).
#   - Local node/pnpm, run from the monorepo root.
#   - Pre-existing systemd unit + nginx vhost on the host (one-time bootstrap;
#     see apps/openape-tribe/DEPLOY.md).
#
# Release layout on the host (mirrors the other deploy scripts):
#   /home/openape/projects/openape-tribe/
#     ├─ releases/<TS>/        timestamped, kept for rollback (last 3)
#     ├─ current -> releases/<TS>/
#     └─ shared/.env           chmod 600, persistent across deploys
#
# Native-binding pin: @libsql/linux-x64-gnu must match the libsql wrapper
# version we ship — same constraint as deploy-free-idp.sh, same pin (0.4.7).

set -euo pipefail

HOST="${CHATTY_HOST:-chatty.delta-mind.at}"
USER_="${CHATTY_USER:-openape}"
BASE="${CHATTY_BASE:-/home/openape/projects/openape-tribe}"
PORT="${CHATTY_TRIBE_PORT:-3010}"
TS=$(date -u +%Y-%m-%dT%H-%M-%S)

echo "→ Build .output locally"
pnpm turbo run build --filter @openape/tribe

echo "→ Rsync release to ${USER_}@${HOST}:${BASE}/releases/${TS}/"
rsync -az --delete \
  apps/openape-tribe/.output/ \
  "${USER_}@${HOST}:${BASE}/releases/${TS}/"

echo "→ Pin matching @libsql/linux-x64-gnu native binding (0.4.7)"
ssh -l "${USER_}" "${HOST}" bash -s <<REMOTE
set -euo pipefail
cd /tmp
rm -rf libsql-pkg-tribe && mkdir libsql-pkg-tribe && cd libsql-pkg-tribe
npm pack @libsql/linux-x64-gnu@0.4.7 >/dev/null 2>&1
tar -xzf libsql-linux-x64-gnu-0.4.7.tgz
mkdir -p ${BASE}/releases/${TS}/server/node_modules/@libsql/linux-x64-gnu
cp package/* ${BASE}/releases/${TS}/server/node_modules/@libsql/linux-x64-gnu/
REMOTE

echo "→ Swap current symlink"
ssh -l "${USER_}" "${HOST}" "ln -sfn ${BASE}/releases/${TS} ${BASE}/current"

echo "→ Restart openape-tribe.service"
ssh -l "${USER_}" "${HOST}" "sudo systemctl restart openape-tribe.service"

echo "→ Wait for local health"
ssh -l "${USER_}" "${HOST}" "
  for i in 1 2 3 4 5 6 7 8 9 10; do
    status=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}/ || echo 000)
    case \$status in 200|301|302|401|403) echo 'up after '\$i's (HTTP '\$status')'; exit 0 ;; esac
    sleep 1
  done
  echo 'health check failed after 10s'
  sudo journalctl -u openape-tribe -n 30 --no-pager
  exit 1
"

echo "→ Prune old releases (keep last 3)"
ssh -l "${USER_}" "${HOST}" "ls -1t ${BASE}/releases/ | tail -n +4 | xargs -r -I{} rm -rf ${BASE}/releases/{}"

echo
echo "✓ Deployed ${TS} to https://tribe.openape.ai"

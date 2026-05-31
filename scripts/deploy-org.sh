#!/usr/bin/env bash
#
# Deploy apps/openape-org to the deploy host.delta-mind.at (org.openape.ai).
#
# Usage: ./scripts/deploy-org.sh
#
# Same pattern as deploy-troop.sh — see that script's header for the full
# layout expectations. Bootstrap (systemd unit, nginx vhost, shared/.env)
# needs to land before the first run: see apps/openape-org/DEPLOY.md.

set -euo pipefail

HOST="${CHATTY_HOST:-chatty.delta-mind.at}"
USER_="${CHATTY_USER:-openape}"
BASE="${CHATTY_BASE:-/home/openape/projects/openape-org}"
PORT="${CHATTY_ORG_PORT:-3020}"
TS=$(date -u +%Y-%m-%dT%H-%M-%S)

echo "→ Build .output locally"
pnpm turbo run build --filter @openape/org

echo "→ Rsync release to ${USER_}@${HOST}:${BASE}/releases/${TS}/"
rsync -az --delete \
  apps/openape-org/.output/ \
  "${USER_}@${HOST}:${BASE}/releases/${TS}/"

echo "→ Pin matching @libsql/linux-x64-gnu native binding (0.4.7)"
ssh -l "${USER_}" "${HOST}" bash -s <<REMOTE
set -euo pipefail
cd /tmp
rm -rf libsql-pkg-org && mkdir libsql-pkg-org && cd libsql-pkg-org
npm pack @libsql/linux-x64-gnu@0.4.7 >/dev/null 2>&1
tar -xzf libsql-linux-x64-gnu-0.4.7.tgz
mkdir -p ${BASE}/releases/${TS}/server/node_modules/@libsql/linux-x64-gnu
cp package/* ${BASE}/releases/${TS}/server/node_modules/@libsql/linux-x64-gnu/
REMOTE

echo "→ Swap current symlink"
ssh -l "${USER_}" "${HOST}" "ln -sfn ${BASE}/releases/${TS} ${BASE}/current"

echo "→ Restart openape-org.service"
ssh -l "${USER_}" "${HOST}" "sudo systemctl restart openape-org.service"

echo "→ Wait for local health"
ssh -l "${USER_}" "${HOST}" "
  for i in 1 2 3 4 5 6 7 8 9 10; do
    status=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${PORT}/ || echo 000)
    case \$status in 200|301|302|401|403) echo 'up after '\$i's (HTTP '\$status')'; exit 0 ;; esac
    sleep 1
  done
  echo 'health check failed after 10s'
  sudo journalctl -u openape-org -n 30 --no-pager
  exit 1
"

echo "→ Prune old releases (keep last 3)"
ssh -l "${USER_}" "${HOST}" "ls -1t ${BASE}/releases/ | tail -n +4 | xargs -r -I{} rm -rf ${BASE}/releases/{}"

echo
echo "✓ Deployed ${TS} to https://org.openape.ai"

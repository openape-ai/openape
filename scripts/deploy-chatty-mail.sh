#!/usr/bin/env bash
#
# Deploy apps/openape-agent-mail to chatty (mail.openape.ai).
# Shape mirrors scripts/deploy-chatty.sh (id). Includes libsql native pin
# because mail uses @libsql/client for its drizzle DB.

set -euo pipefail

HOST="${CHATTY_HOST:-chatty.delta-mind.at}"
USER_="${CHATTY_USER:-openape}"
BASE="${CHATTY_BASE:-/home/openape/projects/openape-agent-mail}"
TS=$(date -u +%Y-%m-%dT%H-%M-%S)

echo "→ Build .output locally"
pnpm turbo run build --filter openape-agent-mail

echo "→ Rsync release to ${USER_}@${HOST}:${BASE}/releases/${TS}/"
rsync -az --delete apps/openape-agent-mail/.output/ "${USER_}@${HOST}:${BASE}/releases/${TS}/"

echo "→ Pin libsql native binding (0.4.7)"
ssh -l "${USER_}" "${HOST}" bash -s <<REMOTE
set -euo pipefail
cd /tmp
rm -rf libsql-pkg && mkdir libsql-pkg && cd libsql-pkg
npm pack @libsql/linux-x64-gnu@0.4.7 >/dev/null 2>&1
tar -xzf libsql-linux-x64-gnu-0.4.7.tgz
mkdir -p ${BASE}/releases/${TS}/server/node_modules/@libsql/linux-x64-gnu
cp package/* ${BASE}/releases/${TS}/server/node_modules/@libsql/linux-x64-gnu/
REMOTE

echo "→ Swap current symlink"
ssh -l "${USER_}" "${HOST}" "ln -sfn ${BASE}/releases/${TS} ${BASE}/current"

echo "→ Restart openape-agent-mail.service"
ssh -l "${USER_}" "${HOST}" "sudo systemctl restart openape-agent-mail.service"

echo "→ Wait for local health"
ssh -l "${USER_}" "${HOST}" "
  for i in 1 2 3 4 5 6 7 8 9 10; do
    status=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3005/ || echo 000)
    case \$status in 200|301|302|401|403) echo 'up after '\$i's (HTTP '\$status')'; exit 0 ;; esac
    sleep 1
  done
  echo 'health check failed after 10s'
  sudo journalctl -u openape-agent-mail -n 30 --no-pager
  exit 1
"

echo "→ Prune old releases (keep last 3)"
ssh -l "${USER_}" "${HOST}" "ls -1t ${BASE}/releases/ | tail -n +4 | xargs -r -I{} rm -rf ${BASE}/releases/{}"

echo
echo "✓ Deployed ${TS} to https://mail.openape.ai"

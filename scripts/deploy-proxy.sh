#!/usr/bin/env bash
#
# Deploy apps/openape-agent-proxy to proxy.openape.ai.
# No DB → no libsql native pin, otherwise identical to the mail deploy.

set -euo pipefail

HOST="${CHATTY_HOST:-chatty.delta-mind.at}"
USER_="${CHATTY_USER:-openape}"
BASE="${CHATTY_BASE:-/home/openape/projects/openape-agent-proxy}"
TS=$(date -u +%Y-%m-%dT%H-%M-%S)

echo "→ Build .output locally"
pnpm turbo run build --filter openape-agent-proxy

echo "→ Rsync release to ${USER_}@${HOST}:${BASE}/releases/${TS}/"
rsync -az --delete apps/openape-agent-proxy/.output/ "${USER_}@${HOST}:${BASE}/releases/${TS}/"

echo "→ Swap current symlink"
ssh -l "${USER_}" "${HOST}" "ln -sfn ${BASE}/releases/${TS} ${BASE}/current"

echo "→ Restart openape-agent-proxy.service"
ssh -l "${USER_}" "${HOST}" "sudo systemctl restart openape-agent-proxy.service"

echo "→ Wait for local health"
ssh -l "${USER_}" "${HOST}" "
  for i in 1 2 3 4 5 6 7 8 9 10; do
    status=\$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3006/ || echo 000)
    case \$status in 200|301|302|401|403) echo 'up after '\$i's (HTTP '\$status')'; exit 0 ;; esac
    sleep 1
  done
  echo 'health check failed after 10s'
  sudo journalctl -u openape-agent-proxy -n 30 --no-pager
  exit 1
"

echo "→ Prune old releases (keep last 3)"
ssh -l "${USER_}" "${HOST}" "ls -1t ${BASE}/releases/ | tail -n +4 | xargs -r -I{} rm -rf ${BASE}/releases/{}"

echo
echo "✓ Deployed ${TS} to https://proxy.openape.ai"

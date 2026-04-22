#!/usr/bin/env bash
#
# Deploy apps/docs (static HTML from Nuxt prerender) to chatty.
# Mirror of scripts/deploy-chatty.sh minus the systemd restart + libsql pin —
# docs has no runtime server, so nginx serves .output/public/ directly.
#
# Usage: ./scripts/deploy-chatty-docs.sh
# Env:
#   CHATTY_HOST  SSH target (default: openape@chatty.delta-mind.at). GitHub
#                Actions sets this to the alias "chatty" with the User openape
#                already wired up in ~/.ssh/config; locally we target the
#                openape user explicitly so it works without a host alias.
#   CHATTY_BASE  Target dir on chatty (default: /home/openape/projects/docs)

set -euo pipefail

HOST="${CHATTY_HOST:-openape@chatty.delta-mind.at}"
BASE="${CHATTY_BASE:-/home/openape/projects/docs}"
TS=$(date -u +%Y-%m-%dT%H-%M-%S)

echo "→ Build apps/docs (prerender via nuxt build)"
pnpm turbo run build --filter docs

echo "→ Rsync .output/public/ to ${HOST}:${BASE}/releases/${TS}/"
rsync -az --delete \
  apps/docs/.output/public/ \
  "${HOST}:${BASE}/releases/${TS}/"

echo "→ Swap current symlink"
ssh "${HOST}" "ln -sfn ${BASE}/releases/${TS} ${BASE}/current"

echo "→ Reload nginx"
ssh "${HOST}" "sudo systemctl reload nginx"

echo "→ Wait for public health"
for i in 1 2 3 4 5; do
  status=$(curl -s -o /dev/null -w '%{http_code}' https://docs.openape.ai/ || echo 000)
  if [ "$status" = "200" ]; then
    echo "  up (HTTP 200) after ${i}s"
    break
  fi
  sleep 1
done

echo "→ Prune old releases (keep last 3)"
ssh "${HOST}" "ls -1t ${BASE}/releases/ | tail -n +4 | xargs -r -I{} rm -rf ${BASE}/releases/{}"

echo
echo "✓ Deployed ${TS} to https://docs.openape.ai"

#!/usr/bin/env bash
# Reproducible recreate of the LIVE openape-nest container, captured 2026-06-17
# from the running container (its config diverged from docker-compose.yml:
# external gateway https://llms.openape.ai, troop target, recipe-dev mount).
# Blue-green: current → -prev (rollback), then run the new image.
#
#   IMAGE=openape-nest:openclaw bash compose/nest-prod.run.sh
#
# Secrets live in ~/.config/openape/nest.env (600), NOT in the repo.
set -euo pipefail
IMAGE="${IMAGE:-openape-nest:latest}"
ENVFILE="${ENVFILE:-$HOME/.config/openape/nest.env}"
SVC_AGENT="${SVC_AGENT:-$HOME/Companies/private/repos/openape/agent-catalog/service-agent}"

test -f "$ENVFILE" || { echo "missing env-file $ENVFILE"; exit 1; }
# Docker creates a missing bind source as an EMPTY directory, so a wrong path
# yields a healthy-looking container whose agent runs all die with
# "Cannot find module /opt/recipe-dev/tools/serve.mjs". Fail here instead.
test -d "$SVC_AGENT/tools" || { echo "missing recipe dir $SVC_AGENT (set SVC_AGENT=)"; exit 1; }

# Blue-green rename for rollback (drop any stale -prev first).
if docker inspect openape-nest >/dev/null 2>&1; then
  docker rm -f openape-nest-prev 2>/dev/null || true
  docker stop openape-nest
  docker rename openape-nest openape-nest-prev
fi

docker run -d \
  --name openape-nest \
  --hostname openape-nest \
  --restart unless-stopped \
  --network compose_openape-pod --network-alias openape-nest \
  --env-file "$ENVFILE" \
  -v compose_openape-nest-data:/var/lib/openape/nest \
  -v compose_openape-homes:/var/lib/openape/homes \
  -v "$SVC_AGENT":/opt/recipe-dev:ro \
  --expose 9091 \
  "$IMAGE"

echo "started openape-nest from $IMAGE"
echo "rollback: docker rm -f openape-nest && docker rename openape-nest-prev openape-nest && docker start openape-nest"

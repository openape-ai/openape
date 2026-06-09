#!/usr/bin/env bash
# Full clean slate for the local stack: stop + remove ALL containers and their
# volumes, then a fresh `up`/run regenerates the local CA, the IdP DB, the nest
# registry and all passkeys from scratch.
#
# Why not a plain `docker compose down -v`: it only targets services in the
# active profile set, so the profile-gated containers (nest, mock-llm,
# playwright) keep running and hold the caddy-data/nest-data volumes — `-v`
# then can't remove them and the CA/registry survive. Naming every profile
# here makes the teardown actually complete.
#
#   ./compose/reset.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # monorepo root

docker compose -f compose/local-stack.yml \
  --profile demo --profile agent-lifecycle \
  down -v --remove-orphans

echo "✓ local stack torn down — containers + volumes removed (CA/DBs will be fresh)"

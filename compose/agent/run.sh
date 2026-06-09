#!/usr/bin/env bash
# Agent lifecycle test on the local stack: bind a nest to the local troop as
# demo@openape.test, then spawn → run → destroy an agent through troop. The
# agent's LLM is the mock (no ChatGPT subscription touched).
#
#   ./compose/agent/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
COMPOSE=(docker compose -f compose/local-stack.yml)
EMAIL=demo@openape.test
OUTDIR=compose/agent/.out
mkdir -p "$OUTDIR"
rm -f "$OUTDIR"/*.json 2>/dev/null || true

# `--fresh` (or FRESH=1) → full clean slate first. This script already resets
# the IdP DB + nest volume per run; --fresh additionally drops the caddy-data
# (local CA) volume a plain `down -v` can't, via reset.sh (profile-aware).
if [ "${1:-}" = "--fresh" ] || [ "${FRESH:-}" = "1" ]; then
  echo "→ Fresh reset (down -v, all profiles)…"
  "$(dirname "$0")/../reset.sh"
fi

pw() { # run a script in the playwright image, on the network, with the agent mounts
  # Mount under /demo so the script resolves `playwright` from /demo/node_modules.
  "${COMPOSE[@]}" run --rm --entrypoint node --workdir /demo \
    -e "REG_TOKEN=${REG_TOKEN:-}" \
    -e "HOST_ID=${HOST_ID:-}" \
    -e "KEEP=${KEEP:-}" \
    -v "$(pwd)/compose/agent:/demo/agent:ro" \
    -v "$(pwd)/$OUTDIR:/out" \
    -v "$(pwd)/docs/local-stack/screenshots:/demo/out" \
    playwright "/demo/agent/$1"
}

echo "→ Resetting the IdP + nest, bringing the stack up…"
"${COMPOSE[@]}" up -d >/dev/null
# The rate-limiter sees every request as coming from the Caddy proxy (all
# hostnames resolve to it), so the per-IP auth cap becomes a global 10/min and
# the test's auth burst (register + SSO + apes-cli PKCE, then enrol + challenge
# on spawn) trips it. Trust the proxy's (dynamic) IP so the limiter keys on the
# real client from X-Forwarded-For — the nest's 2 spawn calls then sit alone.
PROXY_ID=$("${COMPOSE[@]}" ps -q proxy)
PROXY_IP=$(docker inspect "$PROXY_ID" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)
[ -n "$PROXY_IP" ] || { echo "✗ could not resolve proxy IP for rate-limit trust"; exit 1; }
export OPENAPE_RATE_LIMIT_TRUSTED_PROXIES="$PROXY_IP"
echo "  (trusting proxy $PROXY_IP for X-Forwarded-For rate-limit keying)"
"${COMPOSE[@]}" up -d --force-recreate idp >/dev/null
# Fresh nest each run: the IdP DB is recreated (wiping the agent's identity),
# so the nest's volume-persisted registry + OS users must be wiped too or a
# re-run's `apes agents spawn testbot` refuses ("OS user already exists").
"${COMPOSE[@]}" rm -sf nest >/dev/null 2>&1 || true
docker volume rm openape-test_nest-data >/dev/null 2>&1 || true
for _ in $(seq 1 30); do [ "$("${COMPOSE[@]}" ps idp --format '{{.Health}}' 2>/dev/null)" = healthy ] && break; sleep 2; done

echo "→ Building + starting mock-llm…"
"${COMPOSE[@]}" build mock-llm >/dev/null
"${COMPOSE[@]}" up -d mock-llm >/dev/null

echo "→ Minting a registration token for ${EMAIL}…"
"${COMPOSE[@]}" exec -T troop curl -k -s -o /dev/null -X POST https://id.openape.test/api/register \
  -H 'content-type: application/json' -d "{\"email\":\"${EMAIL}\"}" || true
REG_TOKEN=$("${COMPOSE[@]}" exec -T idp node -e '
const D=require("/app/.output/server/node_modules/libsql");const db=new D("/app/idp.db");
const r=db.prepare("SELECT token FROM registration_urls WHERE email=? AND consumed=0 ORDER BY created_at DESC LIMIT 1").get(process.argv[1]);
process.stdout.write(r?r.token:"");' "$EMAIL" | tr -d '\r\n')
[ -n "$REG_TOKEN" ] || { echo "✗ no registration token"; exit 1; }
export REG_TOKEN

echo "→ Login as owner + bind a nest…"
pw bind.mjs
HOST_ID=$(node -e "process.stdout.write(require('./$OUTDIR/creds.json').host_id)")
SECRET=$(node -e "process.stdout.write(require('./$OUTDIR/creds.json').device_secret||'')")
[ -n "$SECRET" ] || { echo "✗ bind returned no device_secret"; exit 1; }
echo "→ Bound: host_id=$HOST_ID"

echo "→ Starting the nest (bound to wss://troop.openape.test)…"
OPENAPE_NEST_HOST_ID="$HOST_ID" OPENAPE_NEST_DEVICE_SECRET="$SECRET" "${COMPOSE[@]}" up -d nest >/dev/null

echo "→ Waiting for the nest to connect to troop…"
connected=
for i in $(seq 1 40); do
  if "${COMPOSE[@]}" logs nest 2>&1 | grep -qiE "connected to wss|troop-ws.*connected|reconciled with registry"; then
    connected=1; echo "✓ nest connected after ~$((i*2))s"; break
  fi
  sleep 2
done
"${COMPOSE[@]}" logs nest 2>&1 | tail -6
[ -n "$connected" ] || { echo "✗ nest did not connect — see logs above"; exit 1; }

echo "✓ Nest is bound + connected to the local troop."

# Provision the owner `apes login` into the nest so `apes agents spawn` can
# enrol agents at the IdP — same auth.json a real Mac nest gets from `apes
# login`. bind.mjs minted it via the apes-cli PKCE flow.
echo "→ Provisioning owner apes-login into the nest…"
[ -s "$OUTDIR/apes-auth.json" ] || { echo "✗ bind produced no apes-auth.json"; exit 1; }
"${COMPOSE[@]}" exec -T nest sh -c 'umask 077; mkdir -p /var/lib/openape/nest/.config/apes && cat > /var/lib/openape/nest/.config/apes/auth.json' < "$OUTDIR/apes-auth.json"
echo "✓ owner login provisioned ($("${COMPOSE[@]}" exec -T nest node -e 'const a=require("/var/lib/openape/nest/.config/apes/auth.json");process.stdout.write(a.email+" act="+JSON.parse(Buffer.from(a.access_token.split(".")[1],"base64").toString()).act)'))"

echo "→ Spawn → run → destroy an agent through troop…"
HOST_ID="$HOST_ID" pw lifecycle.mjs

echo "✓ Agent lifecycle test complete. Screenshots in docs/local-stack/screenshots/."

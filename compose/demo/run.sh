#!/usr/bin/env bash
# Capture the local-stack demo flows as screenshots.
#
# Brings up the stack (if needed), mints a self-service registration token for
# the demo user — read straight from the IdP DB, standing in for the email link
# a real user would click — and runs the Playwright flow capture. Screenshots
# land in docs/local-stack/screenshots/.
#
#   ./compose/demo/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."   # monorepo root
COMPOSE=(docker compose -f compose/local-stack.yml)
EMAIL=demo@openape.test

# `--fresh` (or FRESH=1) → full clean slate first: a plain `down -v` leaves the
# profile-gated containers holding the volumes, so the CA/DBs survive. reset.sh
# tears everything down so the CA + IdP DB are regenerated from scratch.
if [ "${1:-}" = "--fresh" ] || [ "${FRESH:-}" = "1" ]; then
  echo "→ Fresh reset (down -v, all profiles)…"
  "$(dirname "$0")/../reset.sh"
fi

echo "→ Clearing old captures…"
rm -rf docs/local-stack/screenshots
rm -f docs/local-stack/manifest-demo.json

echo "→ Ensuring the stack is up…"
"${COMPOSE[@]}" up -d >/dev/null

# Every browser request reaches the IdP through the Caddy proxy, so the
# rate-limiter keys all four SSO flows on the proxy's single IP — with four
# flows the auth burst trips the 10/min cap (flow 4 got a 429 screenshot).
# Trust the proxy so the limiter walks X-Forwarded-For (same as agent/run.sh).
PROXY_ID=$("${COMPOSE[@]}" ps -q proxy)
PROXY_IP=$(docker inspect "$PROXY_ID" --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)
[ -n "$PROXY_IP" ] || { echo "✗ could not resolve proxy IP for rate-limit trust"; exit 1; }
export OPENAPE_RATE_LIMIT_TRUSTED_PROXIES="$PROXY_IP"
echo "  (trusting proxy $PROXY_IP for X-Forwarded-For rate-limit keying)"

# Reset the IdP AND the org app to a clean slate (their file DBs are
# ephemeral; recreating the containers wipes them) — reproducible stories: a
# real first-time passkey sign-up, first-time consent, and a genuinely empty
# org list for the create-org story.
echo "→ Resetting idp + org + coder to a clean slate…"
"${COMPOSE[@]}" up -d --force-recreate idp org coder >/dev/null
printf "  waiting for idp…"
for _ in $(seq 1 30); do
  [ "$("${COMPOSE[@]}" ps idp --format '{{.Health}}' 2>/dev/null)" = "healthy" ] && break
  sleep 2
done
echo " ok"

echo "→ Minting a registration token for ${EMAIL}…"
# Self-service signup. The email send errors locally (no Resend key), but the
# token is persisted to registration_urls *before* the send, so it's usable.
"${COMPOSE[@]}" exec -T troop curl -k -s -o /dev/null -X POST https://id.openape.test/api/register \
  -H 'content-type: application/json' -d "{\"email\":\"${EMAIL}\"}" || true

TOKEN=$("${COMPOSE[@]}" exec -T idp node -e '
const Database = require("/app/.output/server/node_modules/libsql");
const db = new Database("/app/idp.db");
const row = db.prepare("SELECT token FROM registration_urls WHERE email = ? AND consumed = 0 ORDER BY created_at DESC LIMIT 1").get(process.argv[1]);
process.stdout.write(row ? row.token : "");
' "${EMAIL}" | tr -d '\r\n')

if [ -z "${TOKEN}" ]; then echo "✗ no registration token found"; exit 1; fi
echo "→ Registration token: ${TOKEN}"

echo "→ Running the stories…"
"${COMPOSE[@]}" run --rm -e REG_TOKEN="${TOKEN}" playwright node /demo/src/run-stories.mjs

echo "→ Distributing docs to each app…"
node compose/distribute-docs.mjs

echo "✓ Screenshots in docs/local-stack/screenshots/ — each app serves its own flows at https://<app>.openape.test/docs"

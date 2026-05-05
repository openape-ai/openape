#!/usr/bin/env bash
#
# Generate a VAPID keypair for the openape-chat Web Push integration and
# print the env block to copy into the host .env file.
#
# Run once before the first deploy. The keys must remain stable across
# deploys — clients re-subscribe under the same public key, and rotating
# the private key while subscriptions exist will cause those pushes to
# fail server-side until the next browser-side subscribe.
#
# Usage:
#   ./scripts/generate-chat-vapid.sh > /tmp/chat-vapid.env
#   scp /tmp/chat-vapid.env openape@chatty.delta-mind.at:/home/openape/projects/openape-chat/shared/.env
#   # then on the host: chmod 600 …/shared/.env
#
# Or echo to stdout and inspect first.

set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "npx not found — install Node.js 20+ first" >&2
  exit 1
fi

SUBJECT="${VAPID_SUBJECT:-mailto:patrick@hofmann.eco}"

# `npx web-push generate-vapid-keys --json` emits a JSON object with
# publicKey + privateKey. Pull both with jq if available, fall back to a
# small node parser otherwise.
KEYS_JSON=$(npx --yes -p web-push@^3 web-push generate-vapid-keys --json 2>/dev/null)

if command -v jq >/dev/null 2>&1; then
  PUB=$(printf '%s' "$KEYS_JSON" | jq -r '.publicKey')
  PRIV=$(printf '%s' "$KEYS_JSON" | jq -r '.privateKey')
else
  PUB=$(printf '%s' "$KEYS_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).publicKey))')
  PRIV=$(printf '%s' "$KEYS_JSON" | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>console.log(JSON.parse(s).privateKey))')
fi

if [ -z "${PUB:-}" ] || [ -z "${PRIV:-}" ]; then
  echo "Failed to parse VAPID keypair from web-push output" >&2
  echo "$KEYS_JSON" >&2
  exit 1
fi

cat <<EOF
# Web Push VAPID keys for chat.openape.ai. Append (or merge) to:
#   /home/openape/projects/openape-chat/shared/.env  (chmod 600)
# Generated $(date -u +%Y-%m-%dT%H:%M:%SZ).

NUXT_PUBLIC_VAPID_PUBLIC_KEY=${PUB}
NUXT_VAPID_PRIVATE_KEY=${PRIV}
NUXT_VAPID_SUBJECT=${SUBJECT}
EOF

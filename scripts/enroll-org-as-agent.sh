#!/usr/bin/env bash
#
# One-time bootstrap: enroll org.openape.ai as a DDISA agent at
# id.openape.ai so it can act as a delegate for owners (RFC 8693
# token-exchange in M4).
#
# Runs INTERACTIVELY on chatty as the openape user. Opens a browser
# URL Patrick needs to approve in his iPhone DDISA app. After
# approval, persists the agent's access token into org's shared/.env
# so future deploys pick it up automatically.
#
# Re-run safe: if the agent identity already exists at the IdP, the
# existing access_token is just re-extracted from the local auth file.
#
# Usage: ssh openape@chatty.delta-mind.at "bash -s" < scripts/enroll-org-as-agent.sh

set -euo pipefail

# apes CLI must be on PATH. Install per-user if missing — keeps the
# enroll script truly one-shot.
if ! command -v apes >/dev/null 2>&1; then
  echo "→ Installing @openape/apes (per-user, ~/.npm-global)"
  export NPM_CONFIG_PREFIX="$HOME/.npm-global"
  export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
  npm install --silent -g @openape/apes
  if [ -f "$HOME/.bashrc" ] && ! grep -q 'npm-global/bin' "$HOME/.bashrc"; then
    echo 'export PATH="$HOME/.npm-global/bin:$PATH"' >> "$HOME/.bashrc"
  fi
fi

ORG_BASE=/home/openape/projects/openape-org
SHARED=$ORG_BASE/shared
AGENT_NAME=openape-org
IDP=https://id.openape.ai
KEY_PATH=$SHARED/.ddisa/agent-ed25519
AUTH_PATH=$SHARED/.ddisa/auth.json

mkdir -p "$SHARED/.ddisa"
chmod 700 "$SHARED/.ddisa"

if [ ! -f "$AUTH_PATH" ]; then
  echo "→ Running apes enroll for $AGENT_NAME at $IDP"
  echo "  (You'll get an iPhone DDISA approval prompt — approve to continue.)"
  apes enroll --idp "$IDP" --name "$AGENT_NAME" --key "$KEY_PATH"
  # apes writes auth.json to ~/.openape/<idp-slug>/auth.json by default.
  # Move it to our org-scoped location so it doesn't leak into other apes
  # invocations as the openape user.
  IDP_SLUG=$(echo "$IDP" | sed 's|https\?://||; s|/.*||; s|\.|-|g')
  DEFAULT_AUTH="$HOME/.openape/$IDP_SLUG/auth.json"
  if [ -f "$DEFAULT_AUTH" ]; then
    cp "$DEFAULT_AUTH" "$AUTH_PATH"
    chmod 600 "$AUTH_PATH"
    echo "  ✓ auth.json copied to $AUTH_PATH"
  else
    echo "  ✗ apes enroll didn't produce $DEFAULT_AUTH — check the apes output"
    exit 1
  fi
fi

ACCESS_TOKEN=$(jq -r '.token // .access_token // empty' "$AUTH_PATH")
AGENT_EMAIL=$(jq -r '.email // .agent_email // empty' "$AUTH_PATH")
if [ -z "$ACCESS_TOKEN" ] || [ -z "$AGENT_EMAIL" ]; then
  echo "✗ Could not extract token/email from $AUTH_PATH"
  exit 1
fi

ENV_FILE=$SHARED/.env

# Replace (or append) NUXT_ORG_IDP_ACCESS_TOKEN + NUXT_ORG_IDP_AGENT_EMAIL.
# sed -i variants differ across BSD/GNU; use a temp file for portability.
{
  grep -vE '^NUXT_ORG_IDP_(ACCESS_TOKEN|AGENT_EMAIL)=' "$ENV_FILE" 2>/dev/null || true
  echo "NUXT_ORG_IDP_ACCESS_TOKEN=$ACCESS_TOKEN"
  echo "NUXT_ORG_IDP_AGENT_EMAIL=$AGENT_EMAIL"
} > "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"

echo
echo "✓ org enrolled as $AGENT_EMAIL"
echo "✓ $ENV_FILE updated with NUXT_ORG_IDP_ACCESS_TOKEN + NUXT_ORG_IDP_AGENT_EMAIL"
echo
echo "Next steps:"
echo "  1. Restart the service: sudo systemctl restart openape-org.service"
echo "  2. Owner side: 'apes grants delegate --to $AGENT_EMAIL --at apes-cli --approval always'"
echo "     Paste the resulting grant_id in /orgs/<id>/settings → Delegation grants"

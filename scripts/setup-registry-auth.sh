#!/usr/bin/env bash
# One-time per machine: copy the registry.openape.ai push credential out of the
# macOS login keychain into an isolated docker config, so `pnpm run deploy:image`
# can push from ANY session.
#
# Why: the default ~/.docker/config.json uses `credsStore: osxkeychain`. That
# helper only works inside an interactive GUI (Aqua) login where the login
# keychain is unlocked — a detached/headless/SSH deploy session hits
# "keychain cannot be accessed because the current session does not allow user
# interaction" and the push fails. This writes the same credential inline into
# ~/.config/openape/docker/config.json (chmod 600); deploy-image.mjs points
# DOCKER_CONFIG at it. Your global ~/.docker/config.json is left untouched.
#
# Run this once from an interactive Terminal in your GUI session (the keychain
# must be unlocked). Re-run after the registry password rotates.
set -euo pipefail

DIR="$HOME/.config/openape/docker"
mkdir -p "$DIR"
chmod 700 "$DIR"

if ! command -v docker-credential-osxkeychain >/dev/null 2>&1; then
  echo "✗ docker-credential-osxkeychain not found — this setup is macOS-only." >&2
  exit 1
fi

CRED=$(echo "registry.openape.ai" | docker-credential-osxkeychain get) || {
  echo "✗ Could not read registry.openape.ai from the login keychain." >&2
  echo "  Unlock it first (interactive GUI session):" >&2
  echo "    security -v unlock-keychain ~/Library/Keychains/login.keychain-db" >&2
  exit 1
}

USERNAME=$(echo "$CRED" | node -pe "JSON.parse(require('fs').readFileSync(0)).Username")
SECRET=$(echo "$CRED" | node -pe "JSON.parse(require('fs').readFileSync(0)).Secret")
export AUTH=$(printf '%s:%s' "$USERNAME" "$SECRET" | base64)

node -e "
const fs = require('fs')
const cfg = { auths: { 'registry.openape.ai': { auth: process.env.AUTH } } }
fs.writeFileSync('$DIR/config.json', JSON.stringify(cfg, null, 2) + '\n', { mode: 0o600 })
"
chmod 600 "$DIR/config.json"

echo "✓ Wrote $DIR/config.json (registry auth for user '$USERNAME', chmod 600)."
echo "  pnpm run deploy:image now pushes from any session."

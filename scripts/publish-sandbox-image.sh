#!/usr/bin/env bash
# Build and push the public agent sandbox image to GHCR.
#
#   scripts/publish-sandbox-image.sh 1.0.0
#
# Multi-arch: agents run on Apple Silicon (arm64) and on the Linux hosts
# (amd64), and both pull the same tag.
#
# Auth: pass the GHCR push token on stdin (it is never written to disk outside
# an isolated, chmod-700 docker config, and never echoed). The token lives on
# chatty; fetch it there and pipe it straight in, e.g.
#
#   ssh ubuntu@chatty.delta-mind.at 'cat <path-to-token>' | scripts/publish-sandbox-image.sh 1.0.0
#
# Without stdin the script uses whatever `docker login ghcr.io` state exists.
set -euo pipefail

IMAGE="ghcr.io/openape-ai/apes-sandbox"
PLATFORMS="linux/amd64,linux/arm64"
TAG="${1:-}"

if [ -z "$TAG" ]; then
  echo "usage: $0 <tag>   (e.g. 1.0.0)" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

# Same isolation the registry.openape.ai push uses: keep the credential out of
# the developer's global docker config and out of the macOS keychain path,
# which is unusable from a headless session.
if [ ! -t 0 ]; then
  DOCKER_CONFIG="$(mktemp -d)"
  export DOCKER_CONFIG
  chmod 700 "$DOCKER_CONFIG"
  trap 'rm -rf "$DOCKER_CONFIG"' EXIT
  docker login ghcr.io --username openape-ai --password-stdin >/dev/null
  # The isolated config has no cli-plugins directory, and `docker buildx` is a
  # plugin — without this the build fails with a bare "unknown flag: --file".
  python3 - "$DOCKER_CONFIG/config.json" "$HOME/.docker/cli-plugins" <<'PYEOF'
import json, sys
path, plugins = sys.argv[1], sys.argv[2]
with open(path) as fh:
    config = json.load(fh)
config["cliPluginsExtraDirs"] = [plugins]
with open(path, "w") as fh:
    json.dump(config, fh)
PYEOF
  echo "✓ authenticated to ghcr.io"
fi

docker buildx build \
  --file compose/apes-sandbox.Dockerfile \
  --platform "$PLATFORMS" \
  --tag "$IMAGE:$TAG" \
  --tag "$IMAGE:latest" \
  --push \
  .

echo "✓ pushed $IMAGE:$TAG ($PLATFORMS)"
echo "  pin it for an agent:  apes openclaw add <id> --image $IMAGE:$TAG"

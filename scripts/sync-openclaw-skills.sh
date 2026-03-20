#!/usr/bin/env bash
set -euo pipefail

# Sync OpenAPE SKILL.md files to a target directory.
# Sources: packages, modules, and the sudo repo (sibling directory).
#
# Usage: sync-openclaw-skills.sh <target-dir>

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <target-dir>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MONOREPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SUDO_DIR="$(cd "$MONOREPO_DIR/../sudo" 2>/dev/null && pwd)" || SUDO_DIR=""

TARGET_BASE="$1"

mkdir -p "$TARGET_BASE"

synced=0
skipped=0

sync_skill() {
  local src="$1"
  local name="$2"
  local target="$TARGET_BASE/$name"

  if [[ ! -f "$src/SKILL.md" ]]; then
    echo "SKIP  $name — source not found: $src/SKILL.md"
    skipped=$((skipped + 1))
    return
  fi

  mkdir -p "$target"
  cp "$src/SKILL.md" "$target/SKILL.md"
  echo "SYNC  $name <- $src"
  synced=$((synced + 1))
}

# Monorepo skills
sync_skill "$MONOREPO_DIR/packages/grapes/skills/openape-grapes" "openape-grapes"
sync_skill "$MONOREPO_DIR/packages/shapes/skills/openape-shapes" "openape-shapes"
sync_skill "$MONOREPO_DIR/modules/nuxt-auth-idp/skills/openape-idp" "openape-idp"
sync_skill "$MONOREPO_DIR/modules/nuxt-auth-sp/skills/openape-sp" "openape-sp"

# Sudo repo (sibling)
if [[ -n "$SUDO_DIR" ]]; then
  sync_skill "$SUDO_DIR/skills/openape-sudo" "openape-sudo"
fi

echo ""
echo "Done: $synced synced, $skipped skipped"
echo "Target: $TARGET_BASE"

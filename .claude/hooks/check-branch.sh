#!/bin/bash
# Claude Code PreToolUse hook: Block source edits on main branch
# Exit 0 = allow, Exit 2 = block

MONOREPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

# Tool input via stdin — extract file_path from tool_input
INPUT=$(cat)

# Extract file_path value from the JSON
# Format: "tool_input":{"file_path":"/absolute/path/to/file",...}
FILE_PATH=$(echo "$INPUT" | sed -n 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

# Determine the branch of the WORKTREE that actually contains the target file
# — NOT the primary monorepo checkout. The repo uses git worktrees (see
# CLAUDE.md); checking $MONOREPO_DIR's HEAD would wrongly judge every
# worktree edit against the primary tree's branch (usually main).
if [ -n "$FILE_PATH" ]; then
  FILE_DIR=$(dirname "$FILE_PATH")
  BRANCH=$(git -C "$FILE_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
fi
# Fallbacks: file path unknown or not resolvable → judge by primary tree.
if [ -z "$BRANCH" ]; then
  BRANCH=$(git -C "$MONOREPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null)
fi

# Not on main → allow everything
if [ "$BRANCH" != "main" ]; then
  exit 0
fi

# On main and file unknown → block (safe default)
if [ -z "$FILE_PATH" ]; then
  echo "BLOCKED: Du bist auf 'main' und die Zieldatei konnte nicht ermittelt werden." >&2
  echo "Starte mit:  /issue-start <nr>" >&2
  exit 2
fi

# Allow infrastructure files (match against file_path only)
ALLOWED_PATTERNS=(
  "/.claude/"
  "/.github/"
  "/.githooks/"
  "/.changeset/"
  "/scripts/"
  "/.gitignore"
  "/.npmrc"
  "/eslint.config"
  "/turbo.json"
  "/pnpm-workspace.yaml"
  "/LICENSE"
  "/README.md"
  "/CHANGELOG.md"
  "/CONTRIBUTING.md"
)

for pattern in "${ALLOWED_PATTERNS[@]}"; do
  if echo "$FILE_PATH" | grep -q "$pattern"; then
    exit 0
  fi
done

# Allow root-level package.json (not nested in packages/)
if echo "$FILE_PATH" | grep -qE '/openape-monorepo/package\.json$'; then
  exit 0
fi

# Block
echo "BLOCKED: Du bist auf 'main'. Source-Änderungen müssen auf einem Feature-Branch passieren." >&2
echo "  Datei: $FILE_PATH" >&2
echo "" >&2
echo "Starte mit:  /issue-start <nr>" >&2
echo "Oder manuell: git checkout -b <type>/issue-<nr>-<beschreibung> origin/main" >&2
exit 2
